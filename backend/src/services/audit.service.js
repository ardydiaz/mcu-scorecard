const { Op } = require('sequelize');
const AuditLog = require('../models/AuditLog');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');

// Every action that is recorded, with the label shown on the Audit Logs page
const ACTIONS = {
  'auth.login': 'Signed in',
  'auth.login_denied': 'Sign-in refused',
  'auth.login_failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'page.view': 'Viewed page',
  'sheet.view': 'Viewed sheet',
  'excel.open': 'Opened in Excel',
  'sheet.cell_edit': 'Edited cell',
  'sheet.cell_format': 'Formatted cell',
  'sheet.merge': 'Merged cells',
  'sheet.unmerge': 'Unmerged cells',
  'sheet.column_insert': 'Inserted column',
  'sheet.column_delete': 'Deleted column',
  'sheet.edit_denied': 'Edit refused',
  'audit.export': 'Exported audit log',
  'user.role_change': 'Changed role',
  'user.deactivate': 'Deactivated user',
  'user.reactivate': 'Reactivated user',
  'user.sync': 'Synced users from M365',
  'department.create': 'Created department',
  'department.update': 'Edited department',
  'department.delete': 'Deleted department',
  'department.restore': 'Restored department',
  'access_rule.create': 'Created access rule',
  'access_rule.update': 'Edited access rule',
  'access_rule.delete': 'Deleted access rule',
  'sheet.row_ids_assign': 'Assigned Row IDs',
  'workbook.status': 'Changed file status',
  'workbook.default': 'Set default file',
  'workbook.refresh': 'Checked scorecard folder',
  'workbook.remove': 'Removed file from the list',
};

// The only actions the browser may report itself (everything else is recorded by the server)
const CLIENT_ACTIONS = ['page.view', 'excel.open'];

// Who and where from, taken from the request (req.user is set by the auth middleware)
function requestContext(req) {
  return {
    userId: req?.user?.id ?? null,
    userEmail: req?.user?.email ?? null,
    ip: (req?.ip || '').replace(/^::ffff:/, '').slice(0, 64) || null,
    userAgent: (req?.headers?.['user-agent'] || '').slice(0, 255) || null,
  };
}

/**
 * Records an action. `req` supplies the user, IP and browser; `actor` overrides the user
 * (e.g. at sign-in, before req.user exists). Never throws: a failed audit write is logged
 * but doesn't break the action itself.
 */
async function audit(req, action, { target = null, details = null, actor = null } = {}) {
  try {
    const context = requestContext(req);
    if (actor) {
      context.userId = actor.id ?? null;
      context.userEmail = actor.email ?? null;
    }
    await AuditLog.create({ ...context, action, target: target ? String(target).slice(0, 255) : null, details });
  } catch (err) {
    logger.error(`Audit log write failed (${action}): ${err.message}`);
  }
}

function buildWhere({ q, action, userId, from, to } = {}) {
  const where = {};
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(`${from}T00:00:00`);
    if (to) where.createdAt[Op.lte] = new Date(`${to}T23:59:59.999`);
  }
  if (q) {
    where[Op.or] = [
      { userEmail: { [Op.like]: `%${q}%` } },
      { target: { [Op.like]: `%${q}%` } },
      sequelize.where(sequelize.cast(sequelize.col('details'), 'CHAR'), { [Op.like]: `%${q}%` }),
    ];
  }
  return where;
}

// Newest first; filters: q (user/target/details text), action, userId, from/to (YYYY-MM-DD)
async function listAuditLogs({ page = 1, limit = 50, ...filters } = {}) {
  const { rows, count } = await AuditLog.findAndCountAll({
    where: buildWhere(filters),
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows, total: count, page, limit, actions: ACTIONS };
}

const EXPORT_LIMIT = 10000;

function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// CSV of the filtered log (newest first, up to EXPORT_LIMIT rows)
async function exportAuditLogsCsv(filters = {}) {
  const rows = await AuditLog.findAll({
    where: buildWhere(filters),
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: EXPORT_LIMIT,
    raw: true,
  });
  const header = ['Time', 'User', 'Action', 'Target', 'Details', 'IP', 'Browser'];
  const lines = rows.map((r) => [
    new Date(r.createdAt).toISOString(), r.userEmail, ACTIONS[r.action] || r.action, r.target, r.details, r.ip, r.userAgent,
  ].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\r\n');
}

/**
 * One-time copy of the older edit_logs table (cell edits/formats recorded before the audit log
 * existed), so their history shows on the Audit Logs page. Runs only while audit_logs is empty.
 */
async function importEditLogs() {
  if ((await AuditLog.count()) > 0) return;
  const [tables] = await sequelize.query("SHOW TABLES LIKE 'edit_logs'");
  if (!tables.length) return;
  const [rows] = await sequelize.query('SELECT * FROM edit_logs ORDER BY id');
  for (const r of rows) {
    const isFormat = / \(format\)$/.test(r.column || '');
    await AuditLog.create({
      userId: r.user_id,
      userEmail: r.user_email,
      action: isFormat ? 'sheet.cell_format' : 'sheet.cell_edit',
      target: `${r.sheet}!${r.cell}`,
      details: isFormat
        ? { column: r.column.replace(/ \(format\)$/, ''), format: safeJson(r.new_value) }
        : { column: r.column, oldValue: r.old_value, newValue: r.new_value },
      createdAt: r.created_at,
    });
  }
  if (rows.length) logger.info(`Copied ${rows.length} entries from edit_logs into the audit log`);
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

module.exports = { ACTIONS, CLIENT_ACTIONS, audit, listAuditLogs, exportAuditLogsCsv, importEditLogs };
