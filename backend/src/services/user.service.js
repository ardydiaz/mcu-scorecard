const User = require('../models/User');
const Department = require('../models/Department');
require('../models/UserDepartment');

const withDepartments = {
  model: Department,
  as: 'departments',
  through: { attributes: ['isHead'] },
};

function notFound() {
  return Object.assign(new Error('User not found'), { status: 404 });
}

async function listUsers({ page = 1, limit = 50 } = {}) {
  const { rows, count } = await User.findAndCountAll({
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

async function updateUser(id, { role, isActive }) {
  const user = await User.findByPk(id);
  if (!user) throw notFound();
  await user.update({ ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) });
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

module.exports = { listUsers, getUserById, updateUser, setUserDepartments, upsertByAzureOid };
