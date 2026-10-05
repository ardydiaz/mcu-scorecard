const { getUsedRange, insertColumn, deleteColumn } = require('./excel.service');
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

async function afterChange(wb, sheet) {
  invalidateScorecard(wb, sheet);
  formatService.forget(wb);
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
  await afterChange(wb, sheet);
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
  await afterChange(wb, sheet);
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
  await afterChange(wb, sheet);
  logger.info(`${user.email} deleted column ${column} "${name}" (${filled} filled) in ${wb.name} / ${sheet}`);
  return {
    column,
    change: { target: `${sheet}!${column}:${column}`, details: { workbook: wb.name, header: name, filledCells: filled } },
  };
}

module.exports = { insertColumnForUser, addUpdateColumnForUser, deleteColumnForUser };
