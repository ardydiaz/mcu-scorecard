const departmentService = require('../services/department.service');
const { audit } = require('../services/audit.service');

const AUDITED_FIELDS = ['code', 'name', 'description', 'aliases', 'otherNames', 'viewAll', 'leadCodes'];

const settings = (d) => Object.fromEntries(AUDITED_FIELDS.map((f) => [f, d[f] ?? null]));

// { field: { from, to } } for the settings that changed
function diff(before, after) {
  const changes = {};
  for (const field of AUDITED_FIELDS) {
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
      changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
  }
  return changes;
}

async function list(req, res) {
  res.json(await departmentService.listDepartments());
}

async function create(req, res) {
  const department = await departmentService.createDepartment(req.body);
  await audit(req, 'department.create', { target: department.code, details: settings(department.toJSON()) });
  res.status(201).json(department);
}

async function update(req, res) {
  const before = (await departmentService.getDepartment(Number(req.params.id))).toJSON();
  const department = await departmentService.updateDepartment(Number(req.params.id), req.body);
  const changes = diff(before, department.toJSON());
  if (Object.keys(changes).length) {
    await audit(req, 'department.update', { target: department.code, details: { changes } });
  }
  res.json(department);
}

async function remove(req, res) {
  const result = await departmentService.deleteDepartment(Number(req.params.id));
  await audit(req, 'department.delete', { target: result.deleted, details: { affectedUsers: result.affectedUsers } });
  res.json(result);
}

async function restore(req, res) {
  const department = await departmentService.restoreDepartment(Number(req.params.id));
  await audit(req, 'department.restore', { target: department.code });
  res.json(department);
}

module.exports = { list, create, update, remove, restore };
