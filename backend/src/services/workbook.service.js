const { Op } = require('sequelize');
const env = require('../config/env');
const Workbook = require('../models/Workbook');
const AccessRule = require('../models/AccessRule');
const HiddenRow = require('../models/HiddenRow');
const { getAppGraphClient } = require('./graph.service');
const { explainGraphError } = require('./excel.service');
const logger = require('../utils/logger');
const { sequelize } = require('../config/database');
const { audit } = require('./audit.service');

/**
 * Excel files in the SharePoint scorecard folder (the folder that holds EXCEL_ITEM_ID, or
 * EXCEL_FOLDER_ID when set). The folder is checked at most every 20 seconds; files that appear are
 * added as drafts (admins only) until an admin publishes them on the Workbooks page.
 * The file in EXCEL_ITEM_ID becomes the published default the first time.
 */
const SYNC_INTERVAL_MS = 20 * 1000;
const STATUSES = ['draft', 'published', 'hidden'];

let lastSync = 0;
let syncing = null;
let folderId = env.excel.folderId || null;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// What excel/format services need to reach a file
const toWb = (row) => ({ id: row.id, driveId: row.driveId, itemId: row.itemId, name: row.name });

async function findFolderId(client) {
  if (folderId) return folderId;
  const item = await client.api(`/drives/${env.excel.driveId}/items/${env.excel.itemId}`).select('id,parentReference').get();
  folderId = item.parentReference.id;
  return folderId;
}

async function listFolderFiles() {
  const client = await getAppGraphClient();
  const folder = await findFolderId(client);
  const files = [];
  let page = await client.api(`/drives/${env.excel.driveId}/items/${folder}/children`)
    .select('id,name,file,webUrl,lastModifiedDateTime').top(200).get();
  for (;;) {
    files.push(...page.value.filter((f) => f.file && /\.xlsx$/i.test(f.name) && !f.name.startsWith('~$')));
    if (!page['@odata.nextLink']) break;
    page = await client.api(page['@odata.nextLink']).get();
  }
  return files;
}

async function runSync() {
  let files;
  try {
    files = await listFolderFiles();
  } catch (err) {
    throw explainGraphError(err);
  }

  const known = new Map((await Workbook.findAll()).map((w) => [w.itemId, w]));
  const hasDefault = [...known.values()].some((w) => w.isDefault && !w.missing);
  const seen = new Set();

  for (const f of files) {
    seen.add(f.id);
    const fields = { name: f.name, webUrl: f.webUrl, lastModifiedAt: f.lastModifiedDateTime, missing: false };
    const existing = known.get(f.id);
    if (existing) {
      await existing.update(fields);
    } else {
      const isConfigured = f.id === env.excel.itemId && !hasDefault;
      await Workbook.create({
        ...fields,
        driveId: env.excel.driveId,
        itemId: f.id,
        status: isConfigured ? 'published' : 'draft',
        isDefault: isConfigured,
      });
      logger.info(`Found Excel file "${f.name}" in the scorecard folder (${isConfigured ? 'published as default' : 'draft'})`);
    }
  }

  for (const w of known.values()) {
    if (!seen.has(w.itemId) && !w.missing) {
      await w.update({ missing: true });
      logger.warn(`Excel file "${w.name}" is no longer in the scorecard folder`);
    }
  }
  await ensureDefault('the default file is no longer in the scorecard folder');
  lastSync = Date.now();
}

/**
 * Keeps a default file: when the default was deleted or moved out of the folder (or unpublished /
 * hidden), the most recently modified published file becomes the default, so nobody has to fix it
 * by hand. Recorded in the audit log as a system change. Returns the new default's name, or null.
 */
async function ensureDefault(reason) {
  const all = await Workbook.findAll();
  const current = all.find((w) => w.isDefault);
  if (current && !current.missing && current.status === 'published') return null;
  const next = all
    .filter((w) => !w.missing && w.status === 'published')
    .sort((a, b) => new Date(b.lastModifiedAt || 0) - new Date(a.lastModifiedAt || 0))[0];
  if (!next && !current) return null;
  await Workbook.update({ isDefault: false }, { where: { isDefault: true } });
  if (!next) {
    logger.warn(`"${current.name}" is no longer the default file and no other file is published`);
    return null;
  }
  await next.update({ isDefault: true });
  logger.info(`Default file moved to "${next.name}" (${reason})`);
  await audit(null, 'workbook.default', {
    target: next.name,
    actor: { id: null, email: 'System' },
    details: { automatic: true, reason, previous: current?.name || null },
  });
  return next.name;
}

// Re-reads the folder if the last check is older than SYNC_INTERVAL_MS (or `force`)
async function syncWorkbooks({ force = false } = {}) {
  if (!force && Date.now() - lastSync < SYNC_INTERVAL_MS) return;
  if (!syncing) syncing = runSync().finally(() => { syncing = null; });
  return syncing;
}

// Like syncWorkbooks, but a failed folder read only logs: the list already in the database is used
async function syncQuietly() {
  try {
    await syncWorkbooks();
  } catch (err) {
    lastSync = Date.now(); // don't retry on every request
    logger.warn(`Could not check the scorecard folder: ${err.message}`);
  }
}

const isAdmin = (user) => user?.role === 'admin';
// Hidden files are out of the system for everyone; admins also see drafts (to check them before publishing)
const visibleTo = (user, w) => !w.missing && w.status !== 'hidden' && (isAdmin(user) || w.status === 'published');

// Files for the picker: published files, plus drafts for admins (hidden and missing files never)
async function listForUser(user) {
  await syncQuietly();
  const all = await Workbook.findAll({ order: [['isDefault', 'DESC'], ['lastModifiedAt', 'DESC']] });
  return all.filter((w) => visibleTo(user, w)).map((w) => ({
    id: w.id, name: w.name, status: w.status, isDefault: w.isDefault, lastModifiedAt: w.lastModifiedAt,
  }));
}

// Every file for the admin Workbooks page, including missing ones (with how many access rules and
// personal hidden rows are tied to each, shown before removing a file that is no longer in the folder)
async function listAll({ refresh = false } = {}) {
  if (refresh) await syncWorkbooks({ force: true });
  else await syncQuietly();
  const count = async (Model) => new Map((await Model.findAll({
    attributes: ['workbookId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['workbookId'], raw: true,
  })).map((r) => [r.workbookId, Number(r.n)]));
  const [rules, hidden] = await Promise.all([count(AccessRule), count(HiddenRow)]);
  const rows = await Workbook.findAll({ order: [['missing', 'ASC'], ['isDefault', 'DESC'], ['lastModifiedAt', 'DESC']] });
  // not raw: booleans come back as true/false, not 1/0
  return rows.map((w) => ({ ...w.toJSON(), ruleCount: rules.get(w.id) || 0, hiddenRowCount: hidden.get(w.id) || 0 }));
}

/**
 * The file a request works on: `id` when given (and the user may open it), otherwise the default,
 * otherwise the newest published file. Returns { id, driveId, itemId, name }.
 */
async function resolveWorkbook(id, user) {
  await syncQuietly();
  if (id !== undefined && id !== null && id !== '') {
    const row = await Workbook.findByPk(Number(id));
    if (!row || !visibleTo(user, row)) throw httpError(404, 'That scorecard file was not found or is not published.');
    return toWb(row);
  }
  const candidates = (await Workbook.findAll({ order: [['isDefault', 'DESC'], ['lastModifiedAt', 'DESC']] }))
    .filter((w) => !w.missing && w.status === 'published');
  if (candidates.length) return toWb(candidates[0]);
  if (isAdmin(user)) {
    const any = await Workbook.findOne({ where: { missing: false }, order: [['lastModifiedAt', 'DESC']] });
    if (any) return toWb(any);
  }
  throw httpError(503, 'No scorecard file has been published yet.');
}

// A file by id for admin tools and rule checks (any status); throws 404 when unknown
async function getWorkbook(id) {
  const row = await Workbook.findByPk(Number(id));
  if (!row) throw httpError(404, 'That scorecard file was not found.');
  return toWb(row);
}

// Publish / back to draft / hide. A file that stops being published can't stay the default.
async function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw httpError(422, 'Unknown status.');
  const row = await Workbook.findByPk(Number(id));
  if (!row) throw httpError(404, 'That scorecard file was not found.');
  const before = row.toJSON();
  await row.update({ status, isDefault: status === 'published' ? row.isDefault : false });
  // Unpublishing or hiding the default file hands "default" to the newest published file
  const newDefault = before.isDefault && status !== 'published' ? await ensureDefault(`"${row.name}" was ${status === 'hidden' ? 'hidden' : 'unpublished'}`) : null;
  return { workbook: row.toJSON(), before, newDefault };
}

/**
 * Removes a file that is no longer in the scorecard folder from the system, with the access rules
 * made for that file and users' hidden rows in it. (Rules for "All files" are kept.) If the file
 * comes back to the folder later, it is found again as a new Draft.
 */
async function removeMissing(id) {
  const row = await Workbook.findByPk(Number(id));
  if (!row) throw httpError(404, 'That scorecard file was not found.');
  if (!row.missing) throw httpError(409, `"${row.name}" is still in the scorecard folder. Hide it instead; only files no longer in the folder can be removed.`);
  const removed = await sequelize.transaction(async (transaction) => {
    const rules = await AccessRule.destroy({ where: { workbookId: row.id }, transaction });
    const hiddenRows = await HiddenRow.destroy({ where: { workbookId: row.id }, transaction });
    await row.destroy({ transaction });
    return { rules, hiddenRows };
  });
  logger.info(`Removed "${row.name}" from the system (${removed.rules} access rule(s), ${removed.hiddenRows} hidden row(s))`);
  return { name: row.name, ...removed };
}

// Makes a published file the one that opens first
async function setDefault(id) {
  const row = await Workbook.findByPk(Number(id));
  if (!row) throw httpError(404, 'That scorecard file was not found.');
  if (row.status !== 'published' || row.missing) throw httpError(422, 'Only a published file can be the default.');
  await Workbook.update({ isDefault: false }, { where: { id: { [Op.ne]: row.id } } });
  await row.update({ isDefault: true });
  return row.toJSON();
}

/**
 * Startup: reads the folder, then gives rows saved before multi-file support (Row ID rules and
 * personal hidden rows without a file) to the default file, which they were made for.
 * Returns the default workbook, or null.
 */
async function initWorkbooks() {
  try {
    await syncWorkbooks({ force: true });
  } catch (err) {
    logger.warn(`Could not read the scorecard folder at startup: ${err.message}`);
  }
  const def = await Workbook.findOne({ where: { isDefault: true, missing: false } });
  if (!def) return null;

  const [rules] = await AccessRule.update({ workbookId: def.id }, { where: { matchType: 'rowId', workbookId: null } });
  const [hidden] = await HiddenRow.update({ workbookId: def.id }, { where: { workbookId: null } });
  if (rules || hidden) logger.info(`Linked ${rules} Row ID rule(s) and ${hidden} hidden row(s) to "${def.name}"`);
  return toWb(def);
}

module.exports = {
  STATUSES,
  syncWorkbooks,
  listForUser,
  listAll,
  resolveWorkbook,
  getWorkbook,
  setStatus,
  setDefault,
  removeMissing,
  initWorkbooks,
};
