const userService = require('../services/user.service');
const syncService = require('../services/sync.service');
const { audit } = require('../services/audit.service');

async function list(req, res) {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const { q, role, status } = req.query;
  res.json(await userService.listUsers({ page, limit, q, role, status }));
}

async function getById(req, res) {
  const isSelf = String(req.user.id) === req.params.id;
  if (!isSelf && !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  res.json(await userService.getUserById(req.params.id));
}

async function update(req, res) {
  const before = await userService.getUserById(req.params.id);
  const updated = await userService.updateUser(req.params.id, req.body, req.user);

  if (updated.role !== before.role) {
    await audit(req, 'user.role_change', { target: updated.email, details: { from: before.role, to: updated.role } });
  }
  if (updated.isActive !== before.isActive) {
    await audit(req, updated.isActive ? 'user.reactivate' : 'user.deactivate', { target: updated.email });
  }
  res.json(updated);
}

async function setDepartments(req, res) {
  res.json(await userService.setUserDepartments(req.params.id, req.body.departmentIds));
}

async function syncFromAzure(req, res) {
  const result = await syncService.syncUsersFromAzure();
  await audit(req, 'user.sync', { details: result });
  res.json(result);
}

module.exports = { list, getById, update, setDepartments, syncFromAzure };
