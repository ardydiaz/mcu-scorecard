const ruleService = require('../services/accessRule.service');
const rowIdService = require('../services/rowid.service');
const { audit } = require('../services/audit.service');

// What the audit log shows about a rule
const summary = (r) => ({
  who: r.subjectType === 'user' ? `user #${r.userId}` : r.departmentCode,
  sheet: r.sheet || 'All sheets',
  match: r.matchType,
  values: r.matchValues,
  permission: r.permission,
});

async function list(req, res) {
  res.json(await ruleService.listRules());
}

async function create(req, res) {
  const rule = await ruleService.createRule(req.body, req.user);
  await audit(req, 'access_rule.create', { target: `Rule #${rule.id}`, details: summary(rule.toJSON()) });
  res.status(201).json(rule);
}

async function update(req, res) {
  const { rule, before } = await ruleService.updateRule(Number(req.params.id), req.body);
  await audit(req, 'access_rule.update', { target: `Rule #${rule.id}`, details: { from: summary(before), to: summary(rule.toJSON()) } });
  res.json(rule);
}

async function remove(req, res) {
  const before = await ruleService.deleteRule(Number(req.params.id));
  await audit(req, 'access_rule.delete', { target: `Rule #${before.id}`, details: summary(before) });
  res.status(204).end();
}

async function rowIdStatus(req, res) {
  res.json(await rowIdService.getRowIdStatus(req.query.sheet));
}

// Writes Row IDs into the Excel file (only when an admin clicks "Assign Row IDs")
async function assignRowIds(req, res) {
  const result = await rowIdService.assignRowIds(req.body.sheet);
  await audit(req, 'sheet.row_ids_assign', { target: result.sheet, details: result });
  res.json(result);
}

async function rows(req, res) {
  res.json(await rowIdService.listRows(req.query.sheet));
}

async function options(req, res) {
  res.json(await rowIdService.listMatchOptions(req.query.sheet));
}

module.exports = { list, create, update, remove, rowIdStatus, assignRowIds, rows, options };
