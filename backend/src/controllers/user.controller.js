const userService = require('../services/user.service');
const photoService = require('../services/photo.service');
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
  if (updated.viewAll !== before.viewAll) {
    await audit(req, updated.viewAll ? 'user.view_all_grant' : 'user.view_all_remove', { target: updated.email });
  }
  res.json(updated);
}

async function setDepartments(req, res) {
  res.json(await userService.setUserDepartments(req.params.id, req.body.departmentIds));
}

// A user's M365 profile photo (any signed-in user may see colleagues' photos, as in Microsoft 365).
// The URL carries ?v=<photoUpdatedAt>, so the browser may keep it for a day.
async function photo(req, res) {
  const saved = await photoService.getPhoto(Number(req.params.id));
  if (!saved) return res.status(404).json({ message: 'No photo' });
  res.set({ 'Content-Type': saved.contentType, 'Cache-Control': 'private, max-age=86400' });
  res.send(saved.data);
}

module.exports = { list, getById, update, setDepartments, photo };
