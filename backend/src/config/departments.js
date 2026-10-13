// Department registry. The list lives in MySQL (managed on the admin Departments page) and is
// cached here so matching stays synchronous and fast; department.service reloads it on changes.
//
// Each department:
//   code        canonical code used in the scorecard's Lead column
//   name        full name (also matched against the M365 "Department" profile field)
//   aliases     other spellings of the code in the Lead column / M365 ("IT" = ITD)
//   otherNames  other full names that mean this department in M365
//   viewAll     members see every row, without the Lead filter (they still only edit rows they lead)
//   leadCodes   extra Lead codes whose rows members may edit (kept as written, not merged)

// Used once, to fill the departments table the first time; after that MySQL is the source
const DEFAULT_DEPARTMENTS = [
  { code: 'ITD', name: 'Information Technology', aliases: ['IT'] },
  { code: 'MD', name: 'Marketing', aliases: ['MKTG'] },
  { code: 'EAO', name: 'External Affairs Office' },
  { code: 'QA', name: 'Quality Assurance Office' },
  { code: 'SAS', name: 'Student Affairs and Services' },
  { code: 'CDD', name: 'Campus Development' },
  { code: 'FD', name: 'Finance' },
  { code: 'HR', name: 'Human Resources', aliases: ['HRD'] },
  { code: 'AFAD', name: 'Admissions and Financial Aid' },
  { code: 'ACAD', name: 'Academics' },
  {
    code: 'EXECOM',
    name: 'Executive Committee',
    description: 'Executive Vice President, University President, Chairman of the Board of Trustees',
    otherNames: ['Execom', 'Office of the President', 'Executive Vice President', 'Board of Trustees', 'Chairman of the Board of Trustees'],
    viewAll: true,
    leadCodes: ['EVP', 'BOT', 'OP'],
  },
];

// "Information Technology Department" / "INFORMATION TECHNOLOGY" / "Admissions & Financial Aid" -> comparable key
function normalizeName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(DEPARTMENT|DEPT|OFFICE|OF|THE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const toCodes = (list) => (Array.isArray(list) ? list : []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
const toNames = (list) => (Array.isArray(list) ? list : []).map((n) => String(n).trim()).filter(Boolean);

let departments = [];
let byCode = new Map();
let byName = new Map();

// Replaces the cached list (called with the rows from MySQL)
function setDepartments(rows) {
  departments = rows
    .filter((d) => d.code)
    .map((d) => ({
      id: d.id,
      code: String(d.code).toUpperCase(),
      name: d.name,
      description: d.description || '',
      aliases: toCodes(d.aliases),
      otherNames: toNames(d.otherNames),
      viewAll: !!d.viewAll,
      leadCodes: toCodes(d.leadCodes),
    }));
  byCode = new Map();
  byName = new Map();
  for (const dept of departments) {
    for (const code of [dept.code, ...dept.aliases]) byCode.set(code, dept);
    for (const name of [dept.name, ...dept.otherNames]) byName.set(normalizeName(name), dept);
  }
}

setDepartments(DEFAULT_DEPARTMENTS);

function getDepartments() {
  return departments;
}

// "IT" -> "ITD", "MKTG" -> "MD"; unknown codes (EVP, BOT...) are returned unchanged
function canonicalCode(code) {
  const upper = String(code || '').trim().toUpperCase();
  return byCode.get(upper)?.code || upper;
}

// Maps an M365 department value (full name or code) to a known department, or null
function findDepartment(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return byCode.get(raw.toUpperCase()) || byName.get(normalizeName(raw)) || null;
}

// Value stored in users.department: the code when known ("INFORMATION TECHNOLOGY" -> "ITD"),
// otherwise the M365 value as-is so admins can see what needs adding; null when empty
function departmentValue(m365Department) {
  const raw = String(m365Department || '').trim();
  if (!raw) return null;
  return findDepartment(raw)?.code || raw;
}

// What a user's departments allow: seeing every row, and which Lead codes they may edit
function departmentAccess(codes) {
  const found = codes.map((c) => byCode.get(canonicalCode(c))).filter(Boolean);
  return {
    viewAll: found.some((d) => d.viewAll),
    editCodes: [...new Set([...codes.map(canonicalCode), ...found.flatMap((d) => d.leadCodes)])],
  };
}

// Names for Lead codes that aren't departments of their own (EXECOM's extra Lead codes)
const LEAD_CODE_NAMES = {
  BOT: 'Board of Trustees',
  EVP: 'Executive Vice President',
  OP: 'Office of the President',
};

// Options for a "filter by Lead" dropdown: the known departments among `leadCodes` (with names)
// first, then any other codes found in the Lead column. "LEAD" is the column's own header text
// (e.g. a repeated header row), not a department, so it's left out.
function departmentOptions(leadCodes) {
  const codes = new Set(leadCodes);
  codes.delete('LEAD');
  const known = departments.filter((d) => codes.has(d.code)).map(({ code, name }) => ({ code, name }));
  const others = [...codes].filter((c) => !departments.some((d) => d.code === c)).sort()
    .map((code) => ({ code, name: LEAD_CODE_NAMES[code] || '' }));
  return [...known, ...others];
}

module.exports = {
  DEFAULT_DEPARTMENTS,
  departmentOptions,
  normalizeName,
  setDepartments,
  getDepartments,
  canonicalCode,
  findDepartment,
  departmentValue,
  departmentAccess,
};
