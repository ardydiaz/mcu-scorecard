const { sequelize } = require('../config/database');
const { listAllUsers } = require('./graph.service');
const { upsertByAzureOid } = require('./user.service');
const { linkUserToM365Department } = require('./department.service');
const { departmentValue } = require('../config/departments');
const logger = require('../utils/logger');

// Pulls all Entra ID users into the local DB and links them to departments based on
// the "department" field in their Microsoft 365 profile (mapped via config/departments.js).
async function syncUsersFromAzure() {
  const azureUsers = await listAllUsers();
  let synced = 0;
  let linked = 0;
  const unmatched = new Set(); // M365 department values not in config/departments.js

  await sequelize.transaction(async (transaction) => {
    for (const au of azureUsers) {
      const email = (au.mail || au.userPrincipalName || '').toLowerCase();
      if (!email) continue;

      const user = await upsertByAzureOid(au.id, {
        email,
        displayName: au.displayName,
        jobTitle: au.jobTitle,
        department: departmentValue(au.department),
        isActive: au.accountEnabled !== false,
      }, { transaction });

      if (await linkUserToM365Department(user, au.department, { transaction })) linked++;
      else if (au.department) unmatched.add(au.department.trim());
      synced++;
    }
  });

  logger.info(`Synced ${synced} users from Azure AD (${linked} linked to a department)`);
  return { synced, total: azureUsers.length, linked, unmatchedDepartments: [...unmatched].sort() };
}

module.exports = { syncUsersFromAzure };
