const { getUsedRange, insertColumn, deleteColumn, writeCell } = require('./excel.service');
const { listVisibleSheets, mapColumns, columnLetter, oneLine, cellReader, invalidateScorecard } = require('./scorecard.service');
const { analyzeSheet, letterToIndex } = require('./grid.service');
const formatService = require('./format.service');
const logger = require('../utils/logger');

/**
 * Column changes in the Excel grid, like Excel's Insert / Delete sheet columns.
 *   insert  (everyone)  an empty column left or right of a column, with a header name
 *   update  (everyone)  a new weekly update column dated today, left of the newest update
 *   delete  (admins)    a whole column; the scorecard's key columns can't be deleted
 * A column runs through every department's rows, so each change is recorded in the audit log.
 */

const MAX_HEADER = 100;
// Columns the system depends on (department filter, access rules, dashboard): never deleted here
const PROTECTED = ['perspective', 'objective', 'kra', 'kpi', 'project', 'lead', 'support', 'tier', 'trafficLight', 'launchDate', 'completionDate', 'rowId'];
const PROTECTED_LABELS = {
  perspective: 'Perspectives', objective: 'Objectives', kra: 'Key Result Area', kpi: 'KPI', project: 'Projects', lead: 'Lead',
  support: 'Support', tier: 'Tier', trafficLight: 'Traffic Light', launchDate: 'Launch Date', completionDate: 'Completion Date', rowId: 'Row ID',
};

function httpError(status, message, data) {
  return Object.assign(new Error(message), { status }, data && { data });
}

const isAdmin = (user) => user.role === 'admin';

// Excel date serial for today (Manila time), e.g. for "4-Oct-26"
function todaySerial() {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // UTC+8
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000) + 25569;
}

// Reads the sheet fresh (before changing it) and works out its layout
async function load(wb, sheet) {
  const sheets = await listVisibleSheets(wb);
  if (!sheets.some((s) => s.name === sheet)) throw httpError(404, `Sheet "${sheet}" not found in "${wb.name}".`);
  const range = await getUsedRange(wb, sheet, { refresh: true });
  const layout = analyzeSheet(range);
  if (!layout) throw httpError(422, `"${sheet}" doesn't have the scorecard layout, so its columns can't be changed here.`);
  const headerRowNumber = layout.firstRow + layout.headerRow;
  const headerValues = range.values[layout.headerRow];
  const headerText = range.text[layout.headerRow];
  const header = (absIndex) => oneLine(cellReader(headerValues, headerText)(absIndex - layout.firstCol));
  return { range, layout, headerRowNumber, headerValues, headerText, header };
}

// The column the user right-clicked must still be the one they saw (someone may have changed the sheet)
function checkExpected(ctx, letter, expectedHeader) {
  if (expectedHeader === undefined) return;
  const now = ctx.header(letterToIndex(letter));
  if (now !== oneLine(expectedHeader)) {
    throw httpError(409, `Column ${letter} changed in Excel since you loaded the sheet (it is now "${now || 'empty'}"). Refresh and try again.`);
  }
}

function cleanHeader(ctx, raw) {
  const header = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!header) throw httpError(422, 'Type a header name for the new column.');
  if (header.length > MAX_HEADER) throw httpError(422, `The header can be at most ${MAX_HEADER} characters.`);
  const taken = ctx.headerText.map((t, i) => oneLine(t || ctx.headerValues[i]).toLowerCase());
  if (taken.includes(header.toLowerCase())) throw httpError(409, `There is already a column named "${header}".`);
  // Stored as text so it is never run as an Excel formula
  return /^[=+\-@]/.test(header) ? `'${header}` : header;
}

// After a column change: the parsed sheet is stale, and the cached formatting moves along with the
// columns (instead of reading the whole file again, which made the grid reload slow)
async function afterChange(wb, sheet, letter, delta) {
  invalidateScorecard(wb, sheet);
  formatService.shiftColumns(wb, sheet, letterToIndex(letter), delta);
}

/**
 * Inserts an empty column next to `column` (side 'left' | 'right') with `header` in the header row.
 * Returns { column, header, change } (change is for the audit log).
 */
async function insertColumnForUser(wb, user, { sheet, column, side = 'right', header, expectedHeader }) {
  const ctx = await load(wb, sheet);
  checkExpected(ctx, column, expectedHeader);
  const text = cleanHeader(ctx, header);
  const at = letterToIndex(column) + (side === 'left' ? 0 : 1);
  const letter = columnLetter(at);
  await insertColumn(wb, sheet, letter, `${letter}${ctx.headerRowNumber}`, text);
  await afterChange(wb, sheet, letter, 1);
  logger.info(`${user.email} inserted column ${letter} "${text}" in ${wb.name} / ${sheet}`);
  return {
    column: letter,
    header: text.replace(/^'/, ''),
    change: { target: `${sheet}!${letter}:${letter}`, details: { workbook: wb.name, header: text.replace(/^'/, ''), position: `${side} of ${column}` } },
  };
}

/**
 * Adds this week's update column, dated today, left of the newest update column (updates run
 * newest first), or after the scorecard's columns when the sheet has no updates yet.
 */
async function addUpdateColumnForUser(wb, user, { sheet }) {
  const ctx = await load(wb, sheet);
  const { statuses, columns, targets } = mapColumns(ctx.headerValues, ctx.headerText);
  const serial = todaySerial();
  if (ctx.headerValues.some((v) => typeof v === 'number' && Math.floor(v) === serial)) {
    throw httpError(409, 'This sheet already has an update column for today.');
  }
  let rel;
  if (statuses.length) rel = statuses[0].index;
  else {
    const known = Object.entries(columns).filter(([key]) => !['rowId', 'stage', 'waitingOn'].includes(key)).map(([, i]) => i);
    rel = Math.max(...known, ...targets.map((t) => t.index)) + 1;
  }
  const letter = columnLetter(ctx.layout.firstCol + rel);
  await insertColumn(wb, sheet, letter, `${letter}${ctx.headerRowNumber}`, serial, { numberFormat: 'd-mmm-yy' });
  await afterChange(wb, sheet, letter, 1);
  const label = new Date((serial - 25569) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  logger.info(`${user.email} added update column ${letter} (${label}) in ${wb.name} / ${sheet}`);
  return {
    column: letter,
    header: label,
    change: { target: `${sheet}!${letter}:${letter}`, details: { workbook: wb.name, header: label, kind: 'Weekly update column' } },
  };
}

/**
 * Deletes a whole column (admins only). Key scorecard columns are refused. A column with values asks
 * for confirmation first: without `confirm`, a 409 with code CONFIRM_DELETE and the number of filled cells.
 */
async function deleteColumnForUser(wb, user, { sheet, column, expectedHeader, confirm = false }) {
  if (!isAdmin(user)) throw httpError(403, 'Only admins can delete columns, because a column holds every department’s data.');
  const ctx = await load(wb, sheet);
  checkExpected(ctx, column, expectedHeader);
  const rel = letterToIndex(column) - ctx.layout.firstCol;
  const key = Object.entries(ctx.layout.columns).find(([k, i]) => i === rel && PROTECTED.includes(k))?.[0];
  if (key) throw httpError(400, `"${PROTECTED_LABELS[key]}" is a key column of the scorecard (used for departments, access rules and the dashboard) and can't be deleted.`);

  let filled = 0;
  for (let r = ctx.layout.headerRow + 1; r < ctx.range.values.length; r++) {
    const v = ctx.range.values[r][rel];
    if (v !== '' && v !== null && v !== undefined) filled++;
  }
  const name = ctx.header(letterToIndex(column)) || `column ${column}`;
  if (filled && !confirm) {
    throw httpError(409, `"${name}" has ${filled} filled cell(s) in this sheet. Deleting the column removes them for every department.`, {
      code: 'CONFIRM_DELETE', filled, header: name,
    });
  }
  await deleteColumn(wb, sheet, column);
  await afterChange(wb, sheet, column, -1);
  logger.info(`${user.email} deleted column ${column} "${name}" (${filled} filled) in ${wb.name} / ${sheet}`);
  return {
    column,
    change: { target: `${sheet}!${column}:${column}`, details: { workbook: wb.name, header: name, filledCells: filled } },
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// A header typed as a date ("21-Sep-26", "Sep 21, 2026", "21 September 2026", "2026-09-21") -> Excel
// date serial, so update columns stay real dates the dashboard reads as weeks; null for other text
function headerDateSerial(text) {
  const s = String(text).trim();
  const mon = (w) => MONTHS.indexOf(String(w).slice(0, 3).toLowerCase());
  const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let y; let m; let d;
  let x = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/.exec(s);
  if (x && mon(x[2]) !== -1) [d, m, y] = [Number(x[1]), mon(x[2]), year(x[3])];
  x = !y && /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (x && mon(x[1]) !== -1) [d, m, y] = [Number(x[2]), mon(x[1]), Number(x[3])];
  x = !y && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]) - 1, Number(x[3])];
  if (!y || d < 1 || d > 31) return null;
  return Date.UTC(y, m, d) / 86400000 + 25569;
}

/**
 * Renames a column: writes a new header (admins only). Key scorecard columns keep their names, since
 * the system finds them by name. A date ("21-Sep-26") is saved as an Excel date shown as d-mmm-yy.
 */
async function renameColumnForUser(wb, user, { sheet, column, header, expectedHeader }) {
  if (!isAdmin(user)) throw httpError(403, 'Only admins can rename columns, because the header is shared by every department.');
  const ctx = await load(wb, sheet);
  checkExpected(ctx, column, expectedHeader);
  const absIndex = letterToIndex(column);
  const rel = absIndex - ctx.layout.firstCol;
  const key = Object.entries(ctx.layout.columns).find(([k, i]) => i === rel && PROTECTED.includes(k))?.[0];
  if (key) throw httpError(400, `"${PROTECTED_LABELS[key]}" is a key column of the scorecard (the system finds it by this name), so it can't be renamed.`);

  const before = ctx.header(absIndex);
  const typed = String(header || '').replace(/\s+/g, ' ').trim();
  if (typed === before) throw httpError(400, 'The header already has that name.');
  const serial = headerDateSerial(typed);
  let value;
  if (serial) {
    if (ctx.headerValues.some((v, i) => i !== rel && typeof v === 'number' && Math.floor(v) === serial)) {
      throw httpError(409, 'There is already a column for that date.');
    }
    value = serial;
  } else {
    // Duplicate check against the other columns only
    const others = { ...ctx, headerText: ctx.headerText.map((t, i) => (i === rel ? '' : t)), headerValues: ctx.headerValues.map((v, i) => (i === rel ? '' : v)) };
    value = cleanHeader(others, typed);
  }
  await writeCell(wb, sheet, `${column}${ctx.headerRowNumber}`, value, serial ? { numberFormat: 'd-mmm-yy' } : {});
  invalidateScorecard(wb, sheet);
  const after = serial ? new Date((serial - 25569) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }) : String(value).replace(/^'/, '');
  logger.info(`${user.email} renamed column ${column} "${before}" -> "${after}" in ${wb.name} / ${sheet}`);
  return {
    column,
    header: after,
    change: { target: `${sheet}!${column}:${column}`, details: { workbook: wb.name, from: before, to: after } },
  };
}

module.exports = { insertColumnForUser, addUpdateColumnForUser, deleteColumnForUser, renameColumnForUser };
