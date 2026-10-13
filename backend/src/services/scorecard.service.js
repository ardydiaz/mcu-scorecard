const { listWorksheets, getUsedRange, getTopRows } = require('./excel.service');
const { departmentOptions, canonicalCode } = require('../config/departments');
const { accessFor, withoutNarrow, rowVisible } = require('./access.service');

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
  // Optional columns for the dashboard scoreboard: the project's stage, and what it is waiting on
  stage: /^stage$/i,
  waitingOn: /^waiting (on|for)$/i,
};
// Columns that may sit anywhere (even right of the dated updates), so they don't mark where updates start
const FREE_COLUMNS = ['rowId', 'stage', 'waitingOn'];
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
  const known = Object.entries(columns).filter(([key]) => !FREE_COLUMNS.includes(key)).map(([, i]) => i);
  const lastKnown = Math.max(...known, ...targets.map((t) => t.index));
  const freeIndexes = FREE_COLUMNS.map((key) => columns[key]).filter((i) => i !== undefined);
  const statuses = [];
  for (let i = lastKnown + 1; i < headerValues.length; i++) {
    const raw = headerValues[i];
    if (raw === '' || raw === null || freeIndexes.includes(i)) continue;
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
        // Dashboard scoreboard: the row's own tier (projects of one KPI can differ), and the optional columns
        tier: cell(columns.tier),
        stage: oneLine(cell(columns.stage)),
        waitingOn: oneLine(cell(columns.waitingOn)),
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

// `wb` is the workbook ({ id, driveId, itemId, name }, see workbook.service); caches are per workbook
const cacheKey = (wb, sheetName) => `${wb.itemId}::${sheetName}`;

async function loadScorecard(wb, sheetName, { refresh = false } = {}) {
  const key = cacheKey(wb, sheetName);
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = parseScorecard(sheetName, await getUsedRange(wb, sheetName, { refresh }));
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Drops the parsed copy of a sheet after it was edited
function invalidateScorecard(wb, sheetName) {
  cache.delete(cacheKey(wb, sheetName));
}

// Drops every parsed sheet, e.g. after department aliases changed (Lead codes are resolved when parsing)
function invalidateAllScorecards() {
  cache.clear();
}

// Departments for the Lead dropdown: every Lead code in the scorecard given, known departments
// first (KPIs kept only as the parent of visible projects don't count)
function collectDepartments(scorecard) {
  const codes = new Set();
  const add = (item) => item.lead.forEach((c) => codes.add(c));
  for (const p of scorecard.perspectives) for (const o of p.objectives) for (const k of o.kras) {
    for (const kpi of k.kpis) { if (!kpi.contextOnly) add(kpi); kpi.projects.forEach(add); }
  }
  return departmentOptions(codes);
}

// Keeps the KPIs and projects the user may see (rowVisible: their Lead rows, access rules, or
// the view-all Lead dropdown). A KPI the user can't see stays only as the parent of visible
// projects, flagged `contextOnly` so it isn't shown or counted as theirs.
function filterByAccess(wb, scorecard, access) {
  const facts = (item, p, o, k) => ({
    workbookId: wb.id,
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

const LAYOUT_TTL_MS = 10 * 60 * 1000;
const layoutCache = new Map(); // "itemId::sheet" -> { at, isScorecard }

// Whether a sheet has the scorecard layout (a header row with Perspectives, KPI and Lead),
// whatever it's called, e.g. "Sheet1" in a newly uploaded file. Cached for 10 minutes.
async function hasScorecardLayout(wb, sheetName) {
  const key = cacheKey(wb, sheetName);
  const hit = layoutCache.get(key);
  if (hit && Date.now() - hit.at < LAYOUT_TTL_MS) return hit.isScorecard;
  let isScorecard = false;
  try {
    const { values, text } = await getTopRows(wb, sheetName, HEADER_SEARCH_ROWS);
    const header = findHeaderRow(values);
    isScorecard = header !== -1 && mapColumns(values[header], text[header]).columns.lead !== undefined;
  } catch {
    isScorecard = false; // unreadable sheet (e.g. a chart sheet): not offered as a scorecard
  }
  layoutCache.set(key, { at: Date.now(), isScorecard });
  return isScorecard;
}

// Visible sheets in workbook order; `scorecardOnly` keeps the ones the parser understands:
// sheets named "…Scorecard…", and any other sheet with the scorecard columns
async function listVisibleSheets(wb, { scorecardOnly = false } = {}) {
  const sheets = (await listWorksheets(wb))
    .filter((s) => s.visibility === 'Visible')
    .sort((a, b) => a.position - b.position);
  const keep = scorecardOnly
    ? await Promise.all(sheets.map((s) => /scorecard/i.test(s.name) || hasScorecardLayout(wb, s.name)))
    : sheets.map(() => true);
  return sheets.filter((_, i) => keep[i]).map((s) => ({ id: s.id, name: s.name }));
}

const listScorecardSheets = (wb) => listVisibleSheets(wb, { scorecardOnly: true });

async function resolveSheet(wb, sheetName) {
  const sheets = await listScorecardSheets(wb);
  if (!sheetName) {
    if (!sheets.length) {
      throw badRequest(`"${wb.name}" has no sheet in the scorecard layout (a header row with Perspectives, KPI and Lead), so it can't be shown as a scorecard report. Open it in Strategy Map → Excel instead.`, 404);
    }
    return sheets[0].name;
  }
  if (!sheets.some((s) => s.name === sheetName)) throw badRequest(`Scorecard sheet "${sheetName}" not found in "${wb.name}".`, 404);
  return sheetName;
}

/**
 * Scorecard as seen by `user`: admins and view-all departments (EXECOM) see everything
 * (optionally narrowed to one department); everyone else sees only rows they lead.
 */
async function getScorecardForUser(wb, user, { sheet, department, refresh } = {}) {
  const sheetName = await resolveSheet(wb, sheet);
  const full = await loadScorecard(wb, sheetName, { refresh });
  const access = accessFor(user, department);
  const { canViewAll, viewing } = access;
  // View-all users choose from every department; a Department Head only from the rows they may see
  const departments = collectDepartments(canViewAll ? full : filterByAccess(wb, full, withoutNarrow(access)));

  const visible = canViewAll && !viewing && !access.rules.some((r) => r.permission === 'hide') ? full : filterByAccess(wb, full, access);
  return {
    ...visible,
    departments,
    canViewAll,
    canFilterLead: access.canFilterLead,
    viewingDepartments: viewing || [],
    // Access rules that add rows beyond the user's own Lead rows
    accessRuleCount: canViewAll ? 0 : access.rules.length,
    counts: countItems(visible),
  };
}

// Lead codes of an objective's counted KPIs and projects (KPIs kept only as context don't count),
// known departments first in registry order, then other codes A–Z
function leadCodesOf(objective) {
  const codes = new Set();
  for (const k of objective.kras) for (const kpi of k.kpis) {
    if (!kpi.contextOnly) kpi.lead.forEach((c) => codes.add(c));
    kpi.projects.forEach((pr) => pr.lead.forEach((c) => codes.add(c)));
  }
  return departmentOptions(codes).map((d) => d.code);
}

// Summary view: perspectives and objectives with their KRAs and totals, counted from the rows the
// user may see (their department's Lead rows; every row for view-all users, or the department
// they picked in the Lead dropdown), plus the Objective/Target list from the "Strategy Map" sheet.
async function getStrategyMap(wb, user, { sheet, department, refresh } = {}) {
  const card = await getScorecardForUser(wb, user, { sheet, department, refresh });

  const perspectives = card.perspectives.map((p) => ({
    name: p.name,
    objectives: p.objectives.map((o) => {
      const counts = countItems({ perspectives: [{ objectives: [o] }] });
      return { name: o.name, kras: o.kras.map((k) => k.name), leads: leadCodesOf(o), ...counts };
    }),
  }));

  return {
    sheet: card.sheet,
    perspectives,
    targets: await getMapTargets(wb),
    canViewAll: card.canViewAll,
    canFilterLead: card.canFilterLead,
    viewingDepartments: card.viewingDepartments,
    departments: card.departments,
    counts: card.counts,
  };
}

// Reads the Objective | Target list from the "Strategy Map" sheet
async function getMapTargets(wb) {
  const sheets = await listWorksheets(wb);
  const mapSheet = sheets.find((s) => /^strategy map$/i.test(s.name.trim()));
  if (!mapSheet) return [];

  const { values } = await getUsedRange(wb, mapSheet.name);
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
  resolveSheet,
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
