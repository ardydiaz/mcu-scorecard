// MCU departments: canonical code, full name, and other spellings used in the
// scorecard's Lead column or in the M365 "Department" profile field.
const DEPARTMENTS = [
  { code: 'ITD', name: 'Information Technology', aliases: ['IT'] },
  { code: 'MD', name: 'Marketing', aliases: ['MKTG'] },
  { code: 'EAO', name: 'External Affairs Office', aliases: [] },
  { code: 'QA', name: 'Quality Assurance Office', aliases: [] },
  { code: 'SAS', name: 'Student Affairs and Services', aliases: [] },
  { code: 'CDD', name: 'Campus Development', aliases: [] },
  { code: 'FD', name: 'Finance', aliases: [] },
  { code: 'HR', name: 'Human Resources', aliases: ['HRD'] },
  { code: 'AFAD', name: 'Admissions and Financial Aid', aliases: [] },
  { code: 'ACAD', name: 'Academics', aliases: [] },
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

const byCode = new Map();
const byName = new Map();
for (const dept of DEPARTMENTS) {
  for (const code of [dept.code, ...dept.aliases]) byCode.set(code, dept);
  byName.set(normalizeName(dept.name), dept);
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

module.exports = { DEPARTMENTS, canonicalCode, findDepartment, departmentValue };
