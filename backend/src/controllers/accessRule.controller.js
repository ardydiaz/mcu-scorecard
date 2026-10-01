const ruleService = require('../services/accessRule.service');
const rowIdService = require('../services/rowid.service');
const userService = require('../services/user.service');
const workbookService = require('../services/workbook.service');
const { audit } = require('../services/audit.service');

// What the audit log shows about a rule
const summary = (r) => ({
  who: r.subjectType === 'user' ? `user #${r.userId}` : r.departmentCode,
  file: r.workbookId ? `file #${r.workbookId}` : 'All files',
  sheet: r.sheet || 'All sheets',
  match: r.matchType,
  values: r.matchValues,
  permission: r.permission,
  ...(r.scopeCodes?.length && { limitedTo: r.scopeCodes }),
});

// Admin, or a Department Head limited to their own department's rows
async function actor(req) {
  return ruleService.actorFrom(await userService.getUserForAccess(req.user.id));
}

async function list(req, res) {
  res.json(await ruleService.listRules(await actor(req)));
}

async function create(req, res) {
  const rule = await ruleService.createRule(req.body, await actor(req));
  await audit(req, 'access_rule.create', { target: `Rule #${rule.id}`, details: summary(rule.toJSON()) });
  res.status(201).json(rule);
}

async function update(req, res) {
  const { rule, before } = await ruleService.updateRule(Number(req.params.id), req.body, await actor(req));
  await audit(req, 'access_rule.update', { target: `Rule #${rule.id}`, details: { from: summary(before), to: summary(rule.toJSON()) } });
  res.json(rule);
}

async function remove(req, res) {
  const before = await ruleService.deleteRule(Number(req.params.id), await actor(req));
  await audit(req, 'access_rule.delete', { target: `Rule #${before.id}`, details: summary(before) });
  res.status(204).end();
}

// The file the Row ID tools and pickers work on (?workbook= / body.workbook; default file when absent)
const workbookFor = (req) => workbookService.resolveWorkbook(req.query.workbook ?? req.body?.workbook, req.user);

async function rowIdStatus(req, res) {
  res.json(await rowIdService.getRowIdStatus(await workbookFor(req), req.query.sheet));
}

// Writes Row IDs into the Excel file (only when an admin clicks "Assign Row IDs")
async function assignRowIds(req, res) {
  const wb = await workbookFor(req);
  const result = await rowIdService.assignRowIds(wb, req.body.sheet);
  await audit(req, 'sheet.row_ids_assign', { target: result.sheet, details: { workbook: wb.name, ...result } });
  res.json(result);
}

// Rows for the picker; a Department Head only gets rows their department leads
async function rows(req, res) {
  const who = await actor(req);
  const all = await rowIdService.listRows(await workbookFor(req), req.query.sheet);
  res.json(who.isAdmin ? all : all.filter((x) => x.lead.some((c) => who.codes.includes(c))));
}

// Values for the rule form; a Department Head only gets their own codes for Lead / Support
async function options(req, res) {
  const who = await actor(req);
  const opts = await rowIdService.listMatchOptions(await workbookFor(req), req.query.sheet);
  if (!who.isAdmin) {
    opts.lead = who.codes;
    opts.support = who.codes;
  }
  res.json({ ...opts, scope: who.isAdmin ? null : who.codes });
}

module.exports = { list, create, update, remove, rowIdStatus, assignRowIds, rows, options };
