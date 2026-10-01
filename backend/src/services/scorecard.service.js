const { listWorksheets, getUsedRange } = require('./excel.service');
const { departmentOptions, canonicalCode } = require('../config/departments');
const { accessFor, rowVisible } = require('./access.service');

// Header names used across the scorecard sheets (matched case-insensitively)
const COLUMN_PATTERNS = {
  perspective: /^perspectives?$/i,
  objective: /^objectives?$/i,
  kra: /^key result areas?$/i,
  qualityPolicy: /^quality policy$/i,
  kpi: /^kpis?$/i,
  tier: /^tier$/i,
  project: /^(projects?|initiatives?)$/i,
  lead: /^lead$/i,
  support: /^support$/i,
  launchDate: /^launch date$/i,
  completionDate: /^(completion|due) date$/i,
  execomNotes: /^execom notes$/i,
  trafficLight: /^traffic light$/i,
  // Hidden column with a permanent ID per row (added from Admin → Access Rules)
  rowId: /^row id$/i,
};
const TARGET_HEADER = /^(\d{2}-\d{2}|\d{4}-\d{4})$/; // e.g. "26-27"
const CACHE_TTL_MS = 60 * 1000;
const HEADER_SEARCH_ROWS = 30;

const cache = new Map();

function badRequest(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

const clean = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
const oneLine = (v) => clean(v).replace(/\s+/g, ' ');

// Excel stores dates as day counts from 1899-12-30
function excelDateLabel(serial) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// 0 -> "A", 25 -> "Z", 26 -> "AA"
function columnLetter(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

// Splits "AFAD/MD", "ITD/CDD/MD", "ACAD/MKTG" into canonical department codes (MKTG -> MD, IT -> ITD)
function parseCodes(value) {
  return [...new Set(
    clean(value).split(/[/,&;+\n]| and /i).map((s) => canonicalCode(s)).filter(Boolean)
  )];
}

function findHeaderRow(values) {
  const limit = Math.min(values.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const headers = values[i].map(oneLine);
    if (headers.some((h) => COLUMN_PATTERNS.kpi.test(h)) && headers.some((h) => COLUMN_PATTERNS.perspective.test(h))) {
      return i;
    }
  }
  return -1;
}

function mapColumns(headerValues, headerText) {
  const columns = {};
  const targets = [];
  headerValues.forEach((raw, i) => {
    const h = oneLine(raw);
    for (const [key, pattern] of Object.entries(COLUMN_PATTERNS)) {
      if (columns[key] === undefined && pattern.test(h)) columns[key] = i;
    }
    if (TARGET_HEADER.test(h)) targets.push({ index: i, label: h });
  });

  // Everything to the right of the last known column is a status update, newest first
  // (the Row ID column sits far to the right, so it doesn't count as a known column here)
  const known = Object.entries(columns).filter(([key]) => key !== 'rowId').map(([, i]) => i);
  const lastKnown = Math.max(...known, ...targets.map((t) => t.index));
  const statuses = [];
  for (let i = lastKnown + 1; i < headerValues.length; i++) {
    const raw = headerValues[i];
    if (raw === '' || raw === null || i === columns.rowId) continue;
    const label = typeof raw === 'number' && raw > 30000
      ? excelDateLabel(raw)
      : oneLine(headerText[i] || raw).replace(/\s+status$/i, '');
    statuses.push({ index: i, label });
  }
  return { columns, targets, statuses };
}

// Prefers the text Excel displays; falls back to the raw value when Excel shows "####"
function cellReader(valuesRow, textRow) {
  return (index) => {
    if (index === undefined) return '';
    const text = clean(textRow?.[index]);
    if (text && !/^#+$/.test(text)) return text;
    const raw = valuesRow[index];
    return raw === '' || raw === null || raw === undefined ? '' : clean(raw);
  };
}

function parseScorecard(sheetName, range) {
  const { values, text } = range;
  const headerRow = findHeaderRow(values);
  if (headerRow === -1) {
    throw badRequest(`"${sheetName}" does not use the scorecard layout (no "Perspectives" and "KPI" header row found).`);
  }
  const { columns, targets, statuses } = mapColumns(values[headerRow], text[headerRow]);
  // Used range may not start at A1; convert array positions back to real Excel cells
  const start = range.address.split('!')[1].match(/^([A-Z]+)(\d+)/);
  const firstRow = parseInt(start[2], 10);
  const firstCol = start[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const cellAddress = (colIndex, rowNumber) => `${columnLetter(firstCol + (colIndex ?? 0))}${rowNumber}`;

  const perspectives = [];
  let perspective = null;
  let objective = null;
  let kra = null;
  let kpi = null;

  const ensurePerspective = () => {
    if (!perspective) perspectives.push(perspective = { name: 'Unassigned', objectives: [] });
    return perspective;
  };
  const ensureObjective = () => {
    if (!objective) ensurePerspective().objectives.push(objective = { name: 'Unassigned', kras: [] });
    return objective;
  };
  const ensureKra = () => {
    if (!kra) ensureObjective().kras.push(kra = { name: 'General', kpis: [] });
    return kra;
  };

  for (let r = headerRow + 1; r < values.length; r++) {
    const cell = cellReader(values[r], text[r]);
    const rowNumber = firstRow + r;

    const perspectiveName = oneLine(cell(columns.perspective));
    const objectiveName = oneLine(cell(columns.objective));
    const kraName = oneLine(cell(columns.kra));
    const kpiName = cell(columns.kpi);
    const projectName = cell(columns.project);
    const rowTargets = targets.map((t) => ({ label: t.label, value: cell(t.index) })).filter((t) => t.value);
    const rowStatuses = statuses.map((s) => ({ label: s.label, text: cell(s.index) })).filter((s) => s.text);
    const lead = parseCodes(cell(columns.lead));
    const support = parseCodes(cell(columns.support));
    const qualityPolicy = cell(columns.qualityPolicy);
    const execomNotes = cell(columns.execomNotes);
    const trafficLight = cell(columns.trafficLight);
    const rowId = oneLine(cell(columns.rowId));

    // Merged cells only hold a value on their first row, so each level carries down until it changes
    if (perspectiveName) {
      perspectives.push(perspective = { name: perspectiveName, objectives: [] });
      objective = kra = kpi = null;
    }
    if (objectiveName) {
      ensurePerspective().objectives.push(objective = { name: objectiveName, kras: [] });
      kra = kpi = null;
    }
    if (kraName) {
      ensureObjective().kras.push(kra = { name: kraName, kpis: [] });
      kpi = null;
    }

    const hasDetails = rowTargets.length || rowStatuses.length || lead.length || support.length || qualityPolicy || projectName;

    if (kpiName && !hasDetails && kpi) {
      // A row with only KPI-column text (e.g. "COM...") is a note on the KPI above it
      kpi.notes.push(kpiName);
    } else if (kpiName) {
      kpi = {
        row: rowNumber,
        rowId,
        cell: cellAddress(columns.kpi, rowNumber),
        name: kpiName,
        qualityPolicy,
        targets: rowTargets,
        tier: cell(columns.tier),
        lead,
        support,
        notes: [],
        execomNotes: projectName ? '' : execomNotes,
        trafficLight: projectName ? '' : trafficLight,
        statuses: projectName ? [] : rowStatuses,
        projects: [],
      };
      ensureKra().kpis.push(kpi);
    }

    if (projectName) {
      if (!kpi) {
        kpi = { row: rowNumber, rowId: '', cell: cellAddress(columns.kpi, rowNumber), name: '', qualityPolicy: '', targets: [], tier: '', lead: [], support: [], notes: [], execomNotes: '', trafficLight: '', statuses: [], projects: [] };
        ensureKra().kpis.push(kpi);
      }
      kpi.projects.push({
        row: rowNumber,
        rowId,
        cell: cellAddress(columns.project, rowNumber),
        name: projectName,
        target: kpiName ? '' : rowTargets.map((t) => t.value).join(' / '),
        lead,
        support,
        launchDate: cell(columns.launchDate),
        completionDate: cell(columns.completionDate),
        execomNotes,
        trafficLight,
        statuses: rowStatuses,
      });
    }
  }

  return {
    sheet: sheetName,
    targetLabels: targets.map((t) => t.label),
    statusLabels: statuses.map((s) => s.label),
    perspectives: perspectives.filter((p) => p.objectives.length),
  };
}

async function loadScorecard(sheetName, { refresh = false } = {}) {
  const hit = cache.get(sheetName);
  if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = parseScorecard(sheetName, await getUsedRange(sheetName, { refresh }));
  cache.set(sheetName, { at: Date.now(), data });
  return data;
}

// Drops the parsed copy of a sheet after it was edited
function invalidateScorecard(sheetName) {
  cache.delete(sheetName);
}

// Drops every parsed sheet, e.g. after department aliases changed (Lead codes are resolved when parsing)
function invalidateAllScorecards() {
  cache.clear();
}

// Departments for the admin dropdown: every Lead code in the sheet, known departments first
function collectDepartments(scorecard) {
  const codes = new Set();
  const add = (item) => item.lead.forEach((c) => codes.add(c));
  for (const p of scorecard.perspectives) for (const o of p.objectives) for (const k of o.kras) {
    for (const kpi of k.kpis) { add(kpi); kpi.projects.forEach(add); }
  }
  return departmentOptions(codes);
}

// Keeps the KPIs and projects the user may see (rowVisible: their Lead rows, access rules, or
// the view-all Lead dropdown). A KPI the user can't see stays only as the parent of visible
// projects, flagged `contextOnly` so it isn't shown or counted as theirs.
function filterByAccess(scorecard, access) {
  const facts = (item, p, o, k) => ({
    sheet: scorecard.sheet,
    lead: item.lead,
    support: item.support,
    perspective: p.name,
    objective: o.name,
    kra: k.name,
    rowId: item.rowId,
  });

  const perspectives = scorecard.perspectives.map((p) => ({
    ...p,
    objectives: p.objectives.map((o) => ({
      ...o,
      kras: o.kras.map((k) => ({
        ...k,
        kpis: k.kpis
          .map((kpi) => ({
            ...kpi,
            contextOnly: !rowVisible(access, facts(kpi, p, o, k)),
            projects: kpi.projects.filter((pr) => rowVisible(access, facts(pr, p, o, k))),
          }))
          .filter((kpi) => !kpi.contextOnly || kpi.projects.length),
      })).filter((k) => k.kpis.length),
    })).filter((o) => o.kras.length),
  })).filter((p) => p.objectives.length);

  return { ...scorecard, perspectives };
}

function countItems(scorecard) {
  let kpis = 0;
  let projects = 0;
  for (const p of scorecard.perspectives) for (const o of p.objectives) for (const k of o.kras) {
    for (const kpi of k.kpis) {
      if (kpi.name && !kpi.contextOnly) kpis++;
      projects += kpi.projects.length;
    }
  }
  return { kpis, projects };
}

// Visible sheets in workbook order; `scorecardOnly` keeps the ones the parser understands
async function listVisibleSheets({ scorecardOnly = false } = {}) {
  const sheets = await listWorksheets();
  return sheets
    .filter((s) => s.visibility === 'Visible' && (!scorecardOnly || /scorecard/i.test(s.name)))
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name }));
}

const listScorecardSheets = () => listVisibleSheets({ scorecardOnly: true });

async function resolveSheet(sheetName) {
  const sheets = await listScorecardSheets();
  if (!sheetName) {
    if (!sheets.length) throw badRequest('The workbook has no visible scorecard sheets.', 404);
    return sheets[0].name;
  }
  if (!sheets.some((s) => s.name === sheetName)) throw badRequest(`Scorecard sheet "${sheetName}" not found.`, 404);
  return sheetName;
}

/**
 * Scorecard as seen by `user`: admins and view-all departments (EXECOM) see everything
 * (optionally narrowed to one department); everyone else sees only rows they lead.
 */
async function getScorecardForUser(user, { sheet, department, refresh } = {}) {
  const sheetName = await resolveSheet(sheet);
  const full = await loadScorecard(sheetName, { refresh });
  const departments = collectDepartments(full);
  const access = accessFor(user, department);
  const { canViewAll, viewing } = access;

  const visible = canViewAll && !viewing ? full : filterByAccess(full, access);
  return {
    ...visible,
    departments,
    canViewAll,
    viewingDepartments: viewing || [],
    // Access rules that add rows beyond the user's own Lead rows
    accessRuleCount: canViewAll ? 0 : access.rules.length,
    counts: countItems(visible),
  };
}

// Institution-wide view: perspectives and objectives with their KRAs and totals,
// plus the Objective/Target list from the "Strategy Map" sheet when present.
async function getStrategyMap({ sheet, refresh } = {}) {
  const sheetName = await resolveSheet(sheet);
  const scorecard = await loadScorecard(sheetName, { refresh });

  const perspectives = scorecard.perspectives.map((p) => ({
    name: p.name,
    objectives: p.objectives.map((o) => {
      const counts = countItems({ perspectives: [{ objectives: [o] }] });
      return { name: o.name, kras: o.kras.map((k) => k.name), ...counts };
    }),
  }));

  return { sheet: sheetName, perspectives, targets: await getMapTargets() };
}

// Reads the Objective | Target list from the "Strategy Map" sheet
async function getMapTargets() {
  const sheets = await listWorksheets();
  const mapSheet = sheets.find((s) => /^strategy map$/i.test(s.name.trim()));
  if (!mapSheet) return [];

  const { values } = await getUsedRange(mapSheet.name);
  for (let r = 0; r < values.length; r++) {
    const c = values[r].findIndex((v) => /^objectives?$/i.test(oneLine(v)));
    if (c === -1 || !/^targets?$/i.test(oneLine(values[r][c + 1]))) continue;

    const targets = [];
    for (let i = r + 1; i < values.length; i++) {
      const objectiveName = oneLine(values[i][c]);
      const target = oneLine(values[i][c + 1]);
      if (objectiveName) targets.push({ objective: objectiveName, targets: target ? [target] : [] });
      else if (target && targets.length) targets[targets.length - 1].targets.push(target);
    }
    return targets;
  }
  return [];
}

module.exports = {
  listVisibleSheets,
  listScorecardSheets,
  getScorecardForUser,
  getStrategyMap,
  parseScorecard,
  collectDepartments,
  invalidateScorecard,
  invalidateAllScorecards,
  // Sheet-reading helpers shared with grid.service
  findHeaderRow,
  mapColumns,
  cellReader,
  parseCodes,
  columnLetter,
  oneLine,
};
