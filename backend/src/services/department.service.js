const { fn, col, Op } = require('sequelize');
const Department = require('../models/Department');
const UserDepartment = require('../models/UserDepartment');
const User = require('../models/User');
const { DEFAULT_DEPARTMENTS, setDepartments, findDepartment, normalizeName } = require('../config/departments');
const { invalidateAllScorecards } = require('./scorecard.service');
const logger = require('../utils/logger');

const CODE = /^[A-Z0-9]{2,12}$/;
const MAX_LIST = 20;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Reloads the in-memory registry (config/departments.js) from MySQL
async function loadDepartments() {
  const rows = await Department.findAll({ order: [['code', 'ASC']], raw: true });
  setDepartments(rows);
  invalidateAllScorecards();
  return rows;
}

const defaultFields = (d) => ({
  name: d.name,
  description: d.description || null,
  aliases: d.aliases || [],
  otherNames: d.otherNames || [],
  viewAll: !!d.viewAll,
  leadCodes: d.leadCodes || [],
});

/**
 * Fills the departments table from DEFAULT_DEPARTMENTS the first time only, then loads it:
 *  - empty table: creates every default department
 *  - rows never filled in (aliases is NULL, i.e. created before these columns existed): fills
 *    them from the defaults, or with empty lists for departments that aren't in the defaults
 * Departments added or edited on the Departments page always have their lists set, so they are
 * never overwritten, and deleted (soft-deleted) departments don't come back.
 */
async function seedDepartments() {
  if ((await Department.count({ paranoid: false })) === 0) {
    for (const d of DEFAULT_DEPARTMENTS) await Department.create({ code: d.code, ...defaultFields(d) });
    logger.info(`Filled departments table with ${DEFAULT_DEPARTMENTS.length} default departments`);
  } else {
    const unfilled = await Department.findAll({ where: { aliases: null }, paranoid: false });
    for (const row of unfilled) {
      const d = DEFAULT_DEPARTMENTS.find((x) => x.code === row.code);
      await row.update(d ? defaultFields(d) : { aliases: [], otherNames: [], leadCodes: [], viewAll: false });
    }
    if (unfilled.length) logger.info(`Filled in ${unfilled.length} departments created before the department settings existed`);
  }
  await loadDepartments();
}

async function listDepartments() {
  const counts = await UserDepartment.findAll({
    attributes: ['departmentId', [fn('COUNT', col('user_id')), 'users']],
    group: ['departmentId'],
    raw: true,
  });
  const usersByDept = new Map(counts.map((c) => [c.departmentId, Number(c.users)]));
  // Includes deleted departments (deletedAt set) so the page can offer Restore
  const rows = await Department.findAll({ order: [['code', 'ASC']], paranoid: false });
  return rows.map((d) => ({ ...d.toJSON(), users: usersByDept.get(d.id) || 0 }));
}

const codeList = (list) => [...new Set((Array.isArray(list) ? list : []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
const nameList = (list) => [...new Set((Array.isArray(list) ? list : []).map((n) => String(n).trim()).filter(Boolean))];

// Cleans and checks a department, including that no other department already uses
// the same code/alias or M365 name (matching would be ambiguous otherwise)
async function validate(input, id = null) {
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!CODE.test(code)) throw httpError(422, 'Code must be 2–12 letters or digits, e.g. ITD.');
  if (name.length < 2 || name.length > 100) throw httpError(422, 'Name must be 2–100 characters.');

  const aliases = codeList(input.aliases).filter((c) => c !== code);
  const leadCodes = codeList(input.leadCodes).filter((c) => c !== code);
  const otherNames = nameList(input.otherNames);
  for (const c of [...aliases, ...leadCodes]) {
    if (!CODE.test(c)) throw httpError(422, `"${c}" is not a valid code (2–12 letters or digits).`);
  }
  if (aliases.length > MAX_LIST || leadCodes.length > MAX_LIST || otherNames.length > MAX_LIST) {
    throw httpError(422, `Each list can have at most ${MAX_LIST} entries.`);
  }
  if (otherNames.some((n) => n.length > 100)) throw httpError(422, 'M365 names must be at most 100 characters.');

  // A deleted department still owns its code and name in the database (unique), so point to Restore
  const deleted = (await Department.findAll({ paranoid: false, raw: true }))
    .find((d) => d.deletedAt && d.id !== id && (d.code === code || normalizeName(d.name) === normalizeName(name)));
  if (deleted) {
    throw httpError(409, `A deleted department already uses ${deleted.code === code ? `the code "${code}"` : `the name "${name}"`} (${deleted.code} – ${deleted.name}). Restore it instead.`);
  }

  const others = (await Department.findAll({ raw: true })).filter((d) => d.id !== id);
  const ourCodes = [code, ...aliases];
  for (const d of others) {
    const theirCodes = [d.code, ...(d.aliases || [])].map((c) => String(c).toUpperCase());
    const clash = ourCodes.find((c) => theirCodes.includes(c));
    if (clash) throw httpError(409, `"${clash}" is already used by ${d.code} (${d.name}).`);

    const theirNames = [d.name, ...(d.otherNames || [])].map(normalizeName);
    const nameClash = [name, ...otherNames].find((n) => theirNames.includes(normalizeName(n)));
    if (nameClash) throw httpError(409, `The name "${nameClash}" is already used by ${d.code} (${d.name}).`);
  }

  return {
    code,
    name,
    description: String(input.description || '').trim() || null,
    aliases,
    otherNames,
    viewAll: !!input.viewAll,
    leadCodes,
  };
}

async function getDepartment(id) {
  const department = await Department.findByPk(id, { paranoid: false });
  if (!department) throw httpError(404, 'Department not found.');
  return department;
}

/**
 * Links users who are waiting for a department: their M365 value matched nothing when they signed in
 * (users.department holds that value as-is) and they have no department. Called after departments
 * change, so adding the M365 name to a department takes effect without the user signing in again.
 */
async function linkWaitingUsers() {
  const users = await User.findAll({ where: { department: { [Op.ne]: null } } });
  const linked = new Set((await UserDepartment.findAll({ attributes: ['userId'], raw: true })).map((r) => r.userId));
  let count = 0;
  for (const user of users) {
    if (linked.has(user.id)) continue;
    const known = findDepartment(user.department);
    const department = known && await Department.findOne({ where: { code: known.code } });
    if (!department) continue;
    await UserDepartment.create({ userId: user.id, departmentId: department.id });
    await user.update({ department: department.code });
    logger.info(`Linked ${user.email} to ${department.code} (M365 department "${user.department}")`);
    count++;
  }
  return count;
}

async function createDepartment(input) {
  const department = await Department.create(await validate(input));
  await loadDepartments();
  await linkWaitingUsers();
  return department;
}

async function updateDepartment(id, input) {
  const department = await Department.findByPk(id);
  if (!department) throw httpError(404, 'Department not found.');
  const fields = await validate(input, department.id);
  const oldCode = department.code;
  await department.update(fields);
  // users.department stores the code, so follow a renamed code
  if (oldCode && oldCode !== fields.code) {
    await User.update({ department: fields.code }, { where: { department: oldCode } });
  }
  await loadDepartments();
  await linkWaitingUsers();
  return department;
}

/**
 * Soft delete: marks the department deleted (deleted_at) so it stops matching Lead codes and
 * M365 names right away, and its members see no scorecard rows. The row, its settings and the
 * user links are kept, so restoreDepartment() brings everything back.
 */
async function deleteDepartment(id) {
  const department = await Department.findByPk(id);
  if (!department) throw httpError(404, 'Department not found.');
  const users = await UserDepartment.count({ where: { departmentId: id } });
  await department.destroy();
  await loadDepartments();
  return { deleted: department.code, affectedUsers: users };
}

// Brings a soft-deleted department back, after checking nothing active took its code/aliases/names
async function restoreDepartment(id) {
  const department = await Department.findByPk(id, { paranoid: false });
  if (!department) throw httpError(404, 'Department not found.');
  if (!department.deletedAt) throw httpError(409, `${department.code} is not deleted.`);
  await validate(department.toJSON(), department.id);
  await department.restore();
  await loadDepartments();
  await linkWaitingUsers();
  return department;
}

/**
 * Sets the user's department to the one in their M365 profile ("INFORMATION TECHNOLOGY" -> ITD).
 * Entra ID is the source of truth: previous links are always replaced, and when the M365 value is
 * empty or matches no department the user is left with none (so they don't keep seeing an old
 * department's rows). Callers must only call this with a Department value actually read from Graph.
 * Returns the department, or null when there's no match.
 */
async function linkUserToM365Department(user, m365Department, { transaction } = {}) {
  const known = m365Department ? findDepartment(m365Department) : null;
  const department = known && await Department.findOne({ where: { code: known.code }, transaction });

  await UserDepartment.destroy({ where: { userId: user.id }, transaction });
  if (!department) {
    if (m365Department) {
      logger.warn(`M365 department "${m365Department}" for ${user.email} does not match any department (add it on the Departments page)`);
    }
    return null;
  }
  await UserDepartment.create({ userId: user.id, departmentId: department.id }, { transaction });
  return department;
}

module.exports = {
  seedDepartments,
  loadDepartments,
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  restoreDepartment,
  linkUserToM365Department,
};
