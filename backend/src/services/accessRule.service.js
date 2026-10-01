const AccessRule = require('../models/AccessRule');
const User = require('../models/User');
const Department = require('../models/Department');
const { listScorecardSheets } = require('./scorecard.service');
const { listRows } = require('./rowid.service');
const { canonicalCode } = require('../config/departments');

const MATCH_TYPES = ['lead', 'support', 'perspective', 'objective', 'kra', 'rowId'];
const MAX_VALUES = 500;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// For Row ID rules: { "SC-0128": { row: 129, name: "Project …" } } per sheet, from the cached sheet
async function rowLabels(rules) {
  const sheets = [...new Set(rules.filter((r) => r.matchType === 'rowId' && r.sheet).map((r) => r.sheet))];
  const labels = {};
  for (const sheet of sheets) {
    try {
      const rows = await listRows(sheet, { refresh: false });
      labels[sheet] = Object.fromEntries(rows.map((x) => [x.rowId.toUpperCase(), { row: x.row, name: x.name }]));
    } catch {
      labels[sheet] = {}; // sheet unreadable or renamed: the IDs are still shown
    }
  }
  return labels;
}

/**
 * Who is managing rules: admins manage every rule; a Department Head ("manager" role) manages
 * rules limited to their own department's rows. `user` comes from userService.getUserForAccess.
 */
function actorFrom(user) {
  return {
    id: user.id,
    isAdmin: user.role === 'admin',
    codes: (user.departments || []).map((d) => canonicalCode(d.code || d.name)).filter(Boolean),
  };
}

const overlaps = (a = [], b = []) => a.some((x) => b.includes(x));
// An admin manages every rule; a head only rules limited to (one of) their department(s)
const canManage = (actor, rule) => actor.isAdmin || overlaps((rule.scopeCodes || []).map(canonicalCode), actor.codes);

// Rules the actor may see, with the subject's name (and row names for Row ID rules), newest first
async function listRules(actor) {
  const all = await AccessRule.findAll({ order: [['createdAt', 'DESC']], raw: true });
  const rules = all.filter((r) => canManage(actor, r));
  const users = await User.findAll({ attributes: ['id', 'email', 'displayName'], raw: true });
  const byId = new Map(users.map((u) => [u.id, u]));
  const labels = await rowLabels(rules);
  return rules.map((r) => ({
    ...(r.matchType === 'rowId' && {
      rows: r.matchValues.map((id) => ({ rowId: id, ...(labels[r.sheet]?.[String(id).toUpperCase()] || { row: null, name: '(not found in the sheet)' }) })),
    }),
    ...r,
    subjectLabel: r.subjectType === 'user'
      ? (byId.get(r.userId)?.displayName || byId.get(r.userId)?.email || `User #${r.userId}`)
      : r.departmentCode,
    subjectEmail: r.subjectType === 'user' ? byId.get(r.userId)?.email || null : null,
    createdByEmail: byId.get(r.createdBy)?.email || null,
  }));
}

// Extra checks for a Department Head: the rule is limited to their department's rows, Row IDs must
// be rows their department leads, and Lead/Support values must be their own department codes
async function checkHeadRule(rule, actor) {
  if (!actor.codes.length) throw httpError(403, 'Your account is not linked to a department, so you cannot create access rules.');
  if (['lead', 'support'].includes(rule.matchType) && rule.matchValues.some((c) => !actor.codes.includes(c))) {
    throw httpError(403, `You can only use your own department code (${actor.codes.join(', ')}).`);
  }
  if (rule.matchType === 'rowId') {
    const ownRows = new Set((await listRows(rule.sheet, { refresh: false }))
      .filter((x) => overlaps(x.lead, actor.codes))
      .map((x) => x.rowId.toUpperCase()));
    const outside = rule.matchValues.filter((id) => !ownRows.has(id));
    if (outside.length) throw httpError(403, `${outside.join(', ')} ${outside.length === 1 ? 'is not a row' : 'are not rows'} your department leads.`);
  }
}

async function validate(input, actor) {
  const subjectType = input.subjectType;
  if (!['user', 'department'].includes(subjectType)) throw httpError(422, 'Choose who the rule is for: a user or a department.');

  let userId = null;
  let departmentCode = null;
  if (subjectType === 'user') {
    userId = Number(input.userId);
    if (!userId || !(await User.findByPk(userId))) throw httpError(422, 'That user was not found.');
  } else {
    departmentCode = canonicalCode(input.departmentCode);
    if (!departmentCode || !(await Department.findOne({ where: { code: departmentCode } }))) {
      throw httpError(422, 'That department was not found.');
    }
  }

  const sheet = input.sheet ? String(input.sheet) : null;
  if (sheet && !(await listScorecardSheets()).some((s) => s.name === sheet)) throw httpError(422, `Sheet "${sheet}" was not found.`);

  const matchType = input.matchType;
  if (!MATCH_TYPES.includes(matchType)) throw httpError(422, 'Unknown rule type.');
  // Row IDs are only unique within one sheet
  if (matchType === 'rowId' && !sheet) throw httpError(422, 'Rules for specific rows must be for one sheet.');

  const clean = (v) => String(v).trim();
  let matchValues = [...new Set((Array.isArray(input.matchValues) ? input.matchValues : []).map(clean).filter(Boolean))];
  if (['lead', 'support'].includes(matchType)) matchValues = [...new Set(matchValues.map(canonicalCode))];
  if (matchType === 'rowId') matchValues = matchValues.map((v) => v.toUpperCase());
  if (!matchValues.length) throw httpError(422, 'Choose at least one value for the rule.');
  if (matchValues.length > MAX_VALUES) throw httpError(422, `A rule can have at most ${MAX_VALUES} values.`);

  const permission = ['edit', 'hide'].includes(input.permission) ? input.permission : 'view';
  const note = String(input.note || '').trim().slice(0, 255) || null;
  const rule = { subjectType, userId, departmentCode, sheet, matchType, matchValues, permission, note };

  if (actor.isAdmin) return { ...rule, scopeCodes: null };
  await checkHeadRule(rule, actor);
  return { ...rule, scopeCodes: actor.codes };
}

async function findManageable(id, actor) {
  const rule = await AccessRule.findByPk(id);
  if (!rule || !canManage(actor, rule)) throw httpError(404, 'Access rule not found.');
  return rule;
}

async function createRule(input, actor) {
  return AccessRule.create({ ...(await validate(input, actor)), createdBy: actor.id });
}

async function updateRule(id, input, actor) {
  const rule = await findManageable(id, actor);
  const before = rule.toJSON();
  await rule.update(await validate(input, actor));
  return { rule, before };
}

async function deleteRule(id, actor) {
  const rule = await findManageable(id, actor);
  const before = rule.toJSON();
  await rule.destroy();
  return before;
}

module.exports = { MATCH_TYPES, actorFrom, listRules, createRule, updateRule, deleteRule, validateRule: validate };
