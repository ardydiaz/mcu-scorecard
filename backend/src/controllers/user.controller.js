const userService = require('../services/user.service');
const syncService = require('../services/sync.service');

async function list(req, res) {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(await userService.listUsers({ page, limit }));
}

async function getById(req, res) {
  const isSelf = String(req.user.id) === req.params.id;
  if (!isSelf && !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  res.json(await userService.getUserById(req.params.id));
}

async function update(req, res) {
  res.json(await userService.updateUser(req.params.id, req.body));
}

async function setDepartments(req, res) {
  res.json(await userService.setUserDepartments(req.params.id, req.body.departmentIds));
}

async function syncFromAzure(req, res) {
  res.json(await syncService.syncUsersFromAzure());
}

module.exports = { list, getById, update, setDepartments, syncFromAzure };
