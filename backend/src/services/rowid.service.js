const { getUsedRange, writeRange, setColumnHidden } = require('./excel.service');
const { listScorecardSheets, columnLetter, parseCodes, oneLine, invalidateScorecard } = require('./scorecard.service');
const { analyzeSheet, rowCells, rowIdAt, hierarchyByRow } = require('./grid.service');
const logger = require('../utils/logger');

// Permanent row IDs live in a hidden "Row ID" column of each scorecard sheet, e.g. SC-0001.
// They let access rules point at specific rows even when rows are inserted or moved in Excel.
const PREFIX = 'SC-';
const ID_PATTERN = /^SC-(\d+)$/i;
const HEADER = 'Row ID';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// `refresh: false` uses the cached copy of the sheet (fine for display, not before writing)
async function load(wb, sheet, { refresh = true } = {}) {
  const sheets = await listScorecardSheets(wb);
  if (!sheets.some((s) => s.name === sheet)) throw httpError(404, `Scorecard sheet "${sheet}" not found in "${wb.name}".`);
  const range = await getUsedRange(wb, sheet, { refresh });
  const layout = analyzeSheet(range);
  if (!layout) throw httpError(422, `"${sheet}" doesn't have the scorecard layout (Perspectives … Lead).`);
  return { range, layout };
}

// Data rows (rows with any value in the scorecard columns) with their current IDs
function dataRows(range, layout) {
  const rows = [];
  for (let r = layout.headerRow + 1; r < range.values.length; r++) {
    const cells = rowCells(layout, range, r);
    if (cells.every((v) => !v)) continue;
    rows.push({ r, row: layout.firstRow + r, cells, rowId: rowIdAt(layout, range, r) });
  }
  return rows;
}

/**
 * How far a sheet is set up: whether it has the Row ID column (and which column it is or would be),
 * how many rows have an ID, which rows are missing one, and IDs used more than once (usually a
 * copied row in Excel).
 */
async function getRowIdStatus(wb, sheet) {
  const { range, layout } = await load(wb, sheet);
  const rows = dataRows(range, layout);
  const seen = new Map();
  for (const x of rows) {
    if (!x.rowId) continue;
    seen.set(x.rowId.toUpperCase(), [...(seen.get(x.rowId.toUpperCase()) || []), x.row]);
  }
  const width = range.values[0]?.length || 0;
  return {
    workbookId: wb.id,
    sheet,
    hasColumn: layout.columns.rowId !== undefined,
    column: columnLetter(layout.firstCol + (layout.columns.rowId ?? width)),
    dataRows: rows.length,
    withId: rows.filter((x) => x.rowId).length,
    missing: rows.filter((x) => !x.rowId).map((x) => x.row),
    duplicates: [...seen.entries()].filter(([, list]) => list.length > 1).map(([id, list]) => ({ id, rows: list })),
  };
}

/**
 * Gives every data row without an ID (and every later copy of a duplicated ID) a new ID, creating
 * the hidden "Row ID" column after the last used column the first time. Existing unique IDs are
 * never changed. Only runs when an admin asks for it.
 */
async function assignRowIds(wb, sheet) {
  const { range, layout } = await load(wb, sheet);
  const rows = dataRows(range, layout);
  const headerRowNumber = layout.firstRow + layout.headerRow;

  const created = layout.columns.rowId === undefined;
  const colIndex = created ? range.values[0].length : layout.columns.rowId; // relative to the used range
  const letter = columnLetter(layout.firstCol + colIndex);

  let next = 1 + Math.max(0, ...rows.map((x) => Number(ID_PATTERN.exec(x.rowId)?.[1] || 0)));
  const used = new Set();
  let assigned = 0;
  const idFor = new Map();
  for (const x of rows) {
    const id = x.rowId.toUpperCase();
    if (id && !used.has(id)) {
      used.add(id);
      idFor.set(x.r, x.rowId);
    } else {
      const fresh = `${PREFIX}${String(next++).padStart(4, '0')}`;
      used.add(fresh);
      idFor.set(x.r, fresh);
      assigned++;
    }
  }

  const firstDataR = layout.headerRow + 1;
  const lastR = range.values.length - 1;
  if (created) await writeRange(wb, sheet, `${letter}${headerRowNumber}`, [[HEADER]]);
  if (assigned || created) {
    const values = [];
    for (let r = firstDataR; r <= lastR; r++) values.push([idFor.get(r) || '']);
    await writeRange(wb, sheet, `${letter}${layout.firstRow + firstDataR}:${letter}${layout.firstRow + lastR}`, values);
  }
  if (created) await setColumnHidden(wb, sheet, letter, true);
  invalidateScorecard(wb, sheet);
  logger.info(`Row IDs for ${wb.name} / ${sheet}: ${assigned} assigned${created ? `, column ${letter} created and hidden` : ''}`);

  return { workbookId: wb.id, sheet, column: letter, createdColumn: created, assigned, total: rows.length };
}

// Rows for the "specific rows" picker: ID, row number, name (project or KPI), Lead and KRA
async function listRows(wb, sheet, { refresh = true } = {}) {
  const { range, layout } = await load(wb, sheet, { refresh });
  const levels = hierarchyByRow(layout, range);
  const { columns } = layout;
  return dataRows(range, layout)
    .filter((x) => x.rowId)
    .map((x) => ({
      rowId: x.rowId,
      row: x.row,
      name: oneLine(x.cells[columns.project] || x.cells[columns.kpi] || ''),
      type: x.cells[columns.project] ? 'Project' : 'KPI',
      lead: parseCodes(x.cells[columns.lead]),
      kra: levels[x.r]?.kra || '',
    }))
    .filter((x) => x.name);
}

// Values the rule form offers: Perspectives, Objectives, KRAs, and codes used in Lead / Support
async function listMatchOptions(wb, sheet) {
  const { range, layout } = await load(wb, sheet);
  const levels = hierarchyByRow(layout, range);
  const sets = { perspective: new Set(), objective: new Set(), kra: new Set(), lead: new Set(), support: new Set() };
  for (const x of dataRows(range, layout)) {
    const h = levels[x.r] || {};
    if (h.perspective) sets.perspective.add(h.perspective);
    if (h.objective) sets.objective.add(h.objective);
    if (h.kra) sets.kra.add(h.kra);
    parseCodes(x.cells[layout.columns.lead]).forEach((c) => sets.lead.add(c));
    if (layout.columns.support !== undefined) parseCodes(x.cells[layout.columns.support]).forEach((c) => sets.support.add(c));
  }
  return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b))]));
}

module.exports = { getRowIdStatus, assignRowIds, listRows, listMatchOptions };
