const Department = require('../models/Department');
const UserDepartment = require('../models/UserDepartment');
const { DEPARTMENTS, findDepartment } = require('../config/departments');
const logger = require('../utils/logger');

// Makes sure every department in config/departments.js exists in MySQL with its code
async function seedDepartments() {
  for (const { code, name } of DEPARTMENTS) {
    const existing = await Department.findOne({ where: { code } });
    if (existing) {
      if (existing.name !== name) await existing.update({ name });
    } else {
      await Department.create({ code, name });
    }
  }
}

// Sets the user's department to the one in their M365 profile ("INFORMATION TECHNOLOGY" -> ITD).
// Entra ID is the source of truth, so any previous department links are replaced.
// Returns the department, or null (links left unchanged) when the M365 value is empty or unknown.
async function linkUserToM365Department(user, m365Department, { transaction } = {}) {
  if (!m365Department) return null;
  const known = findDepartment(m365Department);
  if (!known) {
    logger.warn(`M365 department "${m365Department}" for ${user.email} does not match any department in config/departments.js`);
    return null;
  }
  const department = await Department.findOne({ where: { code: known.code }, transaction });
  if (!department) return null;
  await UserDepartment.destroy({ where: { userId: user.id }, transaction });
  await UserDepartment.create({ userId: user.id, departmentId: department.id }, { transaction });
  return department;
}

module.exports = { seedDepartments, linkUserToM365Department };
