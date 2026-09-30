const { canonicalCode, departmentAccess } = require('../config/departments');

/**
 * What a user may see and change in the scorecard:
 *   canViewAll  admins and view-all departments (EXECOM) see every row; others only rows they lead
 *   canEditAll  admins may edit any row
 *   editCodes   Lead codes whose rows the user may edit (their department codes, plus EVP/BOT/OP for EXECOM)
 *   viewing     Lead codes the rows are filtered to, or null for no filter. View-all users may
 *               narrow it with `department`; everyone else is always filtered to their own codes.
 */
function accessFor(user, department) {
  const userCodes = (user.departments || []).map((d) => canonicalCode(d.code || d.name));
  const { viewAll, editCodes } = departmentAccess(userCodes);
  const canEditAll = user.role === 'admin';
  const canViewAll = canEditAll || viewAll;
  const viewing = canViewAll ? (department ? [canonicalCode(department)] : null) : userCodes;
  return { canViewAll, canEditAll, userCodes, editCodes, viewing };
}

// Whether a row whose Lead cell has `leadCodes` may be edited by the user
function canEditRow(access, leadCodes) {
  return access.canEditAll || leadCodes.some((c) => access.editCodes.includes(c));
}

module.exports = { accessFor, canEditRow };
