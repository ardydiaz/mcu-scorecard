const { Op } = require('sequelize');
const User = require('../models/User');
const Department = require('../models/Department');
const AccessRule = require('../models/AccessRule');
require('../models/UserDepartment');

const withDepartments = {
  model: Department,
  as: 'departments',
  through: { attributes: ['isHead'] },
};

function notFound() {
  return Object.assign(new Error('User not found'), { status: 404 });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// q searches name and email; role / status ('active' | 'inactive') filter the list
async function listUsers({ page = 1, limit = 50, q, role, status } = {}) {
  const where = {};
  if (q) where[Op.or] = [{ displayName: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }];
  if (role) where.role = role;
  if (status) where.isActive = status === 'active';

  const { rows, count } = await User.findAndCountAll({
    where,
    include: [withDepartments],
    order: [['displayName', 'ASC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { data: rows, total: count, page, limit };
}

async function getUserById(id) {
  const user = await User.findByPk(id, { include: [withDepartments] });
  if (!user) throw notFound();
  return user;
}

/**
 * The user as a plain object for access checks: departments plus `accessRules`, the access
 * rules given to this user or to any of their departments.
 */
async function getUserForAccess(id) {
  const user = (await getUserById(id)).toJSON();
  const codes = (user.departments || []).map((d) => d.code).filter(Boolean);
  const accessRules = await AccessRule.findAll({
    where: {
      [Op.or]: [
        { subjectType: 'user', userId: user.id },
        ...(codes.length ? [{ subjectType: 'department', departmentCode: { [Op.in]: codes } }] : []),
      ],
    },
    raw: true,
  });
  return { ...user, accessRules };
}

/**
 * Changes a user's role, active status and/or "View all departments". Admins can't change their own
 * role or deactivate themselves, and the last active admin can't be demoted or deactivated (nobody
 * could manage users).
 */
async function updateUser(id, { role, isActive, viewAll }, actingUser) {
  const user = await User.findByPk(id);
  if (!user) throw notFound();

  const changesRole = role !== undefined && role !== user.role;
  const deactivates = isActive === false && user.isActive;
  if (actingUser && Number(actingUser.id) === user.id && (changesRole || deactivates)) {
    throw httpError(400, "You can't change your own role or deactivate your own account.");
  }
  const losesAdmin = user.role === 'admin' && user.isActive && ((changesRole && role !== 'admin') || deactivates);
  if (losesAdmin && (await User.count({ where: { role: 'admin', isActive: true } })) <= 1) {
    throw httpError(400, `${user.displayName || user.email} is the only active admin. Make someone else an admin first.`);
  }

  await user.update({
    ...(role !== undefined && { role }),
    ...(isActive !== undefined && { isActive }),
    ...(viewAll !== undefined && { viewAll }),
  });
  return getUserById(id);
}

async function setUserDepartments(id, departmentIds) {
  const user = await User.findByPk(id);
  if (!user) throw notFound();
  await user.setDepartments(departmentIds);
  return getUserById(id);
}

// Creates or updates a user keyed by their Entra ID object id
async function upsertByAzureOid(azureOid, fields, { transaction } = {}) {
  const user = await User.findOne({ where: { azureOid }, transaction });
  if (user) return user.update(fields, { transaction });
  return User.create({ azureOid, ...fields }, { transaction });
}

module.exports = { listUsers, getUserById, getUserForAccess, updateUser, setUserDepartments, upsertByAzureOid };
