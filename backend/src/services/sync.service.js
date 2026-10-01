const { sequelize } = require('../config/database');
const { listAllUsers } = require('./graph.service');
const { upsertByAzureOid } = require('./user.service');
const { linkUserToM365Department } = require('./department.service');
const { departmentValue } = require('../config/departments');
const { refreshAllPhotos } = require('./photo.service');
const logger = require('../utils/logger');

// Pulls all Entra ID users into the local DB and links them to departments based on the
// "department" field in their Microsoft 365 profile (matched against the Departments page).
async function syncUsersFromAzure() {
  const azureUsers = await listAllUsers();
  let synced = 0;
  let linked = 0;
  const unmatched = new Set(); // M365 department values that match no department

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
  // Profile photos take a while for many users, so they're copied in the background
  refreshAllPhotos().catch((err) => logger.warn(`Photo refresh after sync failed: ${err.message}`));
  return { synced, total: azureUsers.length, linked, unmatchedDepartments: [...unmatched].sort() };
}

module.exports = { syncUsersFromAzure };
