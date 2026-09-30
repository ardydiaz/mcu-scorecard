const { createRemoteJWKSet, jwtVerify } = require('jose');
const env = require('../config/env');
const logger = require('../utils/logger');
const { getUserProfile } = require('./graph.service');
const { upsertByAzureOid } = require('./user.service');
const { signToken } = require('../utils/jwt');
const { linkUserToM365Department } = require('./department.service');
const { departmentValue } = require('../config/departments');

const issuer = `https://login.microsoftonline.com/${env.azure.tenantId}/v2.0`;

// Microsoft's public signing keys for the tenant; jose caches and rotates them
const microsoftKeys = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${env.azure.tenantId}/discovery/v2.0/keys`)
);

function unauthorized(message) {
  return Object.assign(new Error(message), { status: 401 });
}

// Checks the ID token's signature, issuer (our tenant only), audience (our app) and expiry
async function verifyMicrosoftToken(idToken) {
  try {
    const { payload } = await jwtVerify(idToken, microsoftKeys, {
      issuer,
      audience: env.azure.clientId,
    });
    return payload;
  } catch (err) {
    logger.warn(`Rejected Microsoft token: ${err.code || err.message}`);
    throw unauthorized('Invalid Microsoft token');
  }
}

async function loginWithMicrosoft(idToken) {
  const claims = await verifyMicrosoftToken(idToken);

  // Department and job title aren't in the ID token, so read them from Graph.
  // Sign-in still works if Graph is unavailable; the department is just skipped.
  let profile = {};
  try {
    profile = await getUserProfile(claims.oid);
  } catch (err) {
    logger.warn(`Could not read Graph profile for ${claims.oid}: ${err.message}`);
  }

  const email = (profile.mail || claims.email || claims.preferred_username || '').toLowerCase();
  if (!email) throw unauthorized('Microsoft account has no email address');

  const user = await upsertByAzureOid(claims.oid, {
    email,
    displayName: profile.displayName || claims.name,
    jobTitle: profile.jobTitle,
    // Only overwrite the saved department when Graph was actually read
    ...(profile.id && { department: departmentValue(profile.department) }),
    lastLoginAt: new Date(),
  });

  if (!user.isActive) {
    // `actor` lets the controller record who was refused in the audit log
    throw Object.assign(new Error('Your account is disabled. Please contact the ICT office.'), {
      status: 403,
      actor: { id: user.id, email: user.email },
    });
  }

  // Only when Graph was read: an unreachable Graph must not change the user's department
  if (profile.id) await linkUserToM365Department(user, profile.department);
  const departments = await user.getDepartments();
  const primary = departments.find((d) => d.UserDepartment?.isHead) || departments[0];

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.displayName,
      department: primary ? primary.code || primary.name : null,
      role: user.role,
    },
    token: signToken({ id: user.id, email: user.email, role: user.role }),
  };
}

module.exports = { loginWithMicrosoft };
