const { canonicalCode, departmentAccess } = require('../config/departments');

/**
 * What a user may see and change in the scorecard:
 *   canViewAll  admins and view-all departments (EXECOM) see every row; others see the rows
 *               they lead plus rows their access rules allow
 *   canEditAll  admins may edit any row
 *   editCodes   Lead codes whose rows the user may edit (their department codes, plus EVP/BOT/OP for EXECOM)
 *   rules       access rules for this user and their departments (user.accessRules, loaded by
 *               userService.getUserForAccess)
 *   viewing     Lead codes a view-all user narrowed the view to (the Lead dropdown), or null
 */
function accessFor(user, department) {
  const userCodes = (user.departments || []).map((d) => canonicalCode(d.code || d.name));
  const { viewAll, editCodes } = departmentAccess(userCodes);
  const canEditAll = user.role === 'admin';
  const canViewAll = canEditAll || viewAll;
  const viewing = canViewAll ? (department ? [canonicalCode(department)] : null) : userCodes;
  return { canViewAll, canEditAll, userCodes, editCodes, viewing, rules: user.accessRules || [] };
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Whether an access rule applies to a row. `facts` describes the row:
 * { sheet, lead: [codes], support: [codes], perspective, objective, kra, rowId }
 */
function ruleMatches(rule, facts) {
  if (rule.sheet && rule.sheet !== facts.sheet) return false;
  // A Department Head's rule never reaches beyond rows their department leads
  if (Array.isArray(rule.scopeCodes) && rule.scopeCodes.length
    && !rule.scopeCodes.map(canonicalCode).some((c) => facts.lead.includes(c))) return false;
  const values = Array.isArray(rule.matchValues) ? rule.matchValues : [];
  switch (rule.matchType) {
    case 'lead': return values.map(canonicalCode).some((c) => facts.lead.includes(c));
    case 'support': return values.map(canonicalCode).some((c) => facts.support.includes(c));
    case 'perspective': return values.some((v) => sameName(v, facts.perspective));
    case 'objective': return values.some((v) => sameName(v, facts.objective));
    case 'kra': return values.some((v) => sameName(v, facts.kra));
    case 'rowId': return !!facts.rowId && values.some((v) => String(v).trim().toUpperCase() === facts.rowId.toUpperCase());
    default: return false;
  }
}

// A "hide" rule matches this row: it's taken out of the user's view (admins excepted)
const isHidden = (access, facts) => !access.canEditAll
  && access.rules.some((rule) => rule.permission === 'hide' && ruleMatches(rule, facts));

/**
 * { view, edit } for one row. Default: a department views and edits the rows it leads.
 * A matching rule sets the row's access for this user, overriding the default:
 *   hide = not visible · view = visible but read-only (even own rows) · edit = visible and editable
 * When several rules match the same row, the strictest wins (hide > view > edit).
 * Admins always see and edit everything.
 */
function rowAccess(access, facts) {
  if (access.canEditAll) return { view: true, edit: true };
  const matching = access.rules.filter((rule) => ruleMatches(rule, facts)).map((rule) => rule.permission);
  if (matching.includes('hide')) return { view: false, edit: false };
  if (matching.includes('view')) return { view: true, edit: false };
  if (matching.includes('edit')) return { view: true, edit: true };
  const own = facts.lead.some((c) => access.editCodes.includes(c));
  return { view: access.canViewAll || own, edit: own };
}

// Whether a row is shown: view-all users see everything (or the one department they picked in
// the Lead dropdown) except rows hidden from them; everyone else sees what rowAccess() allows
function rowVisible(access, facts) {
  if (access.canViewAll) {
    if (isHidden(access, facts)) return false;
    return !access.viewing || facts.lead.some((c) => access.viewing.includes(c));
  }
  return rowAccess(access, facts).view;
}

module.exports = { accessFor, rowAccess, rowVisible, ruleMatches };
