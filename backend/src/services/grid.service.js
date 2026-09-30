const { getUsedRange, writeCell, writeCellFormat } = require('./excel.service');
const {
  listVisibleSheets,
  findHeaderRow,
  mapColumns,
  cellReader,
  parseCodes,
  columnLetter,
  oneLine,
  invalidateScorecard,
} = require('./scorecard.service');
const { DEPARTMENTS, canonicalCode } = require('../config/departments');
const EditLog = require('../models/EditLog');
const { getSheetFormat, updateCachedStyle } = require('./format.service');
const logger = require('../utils/logger');

const MAX_CELL_LENGTH = 5000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const letterToIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// "2026-08" -> Excel date serial for 1 Aug 2026
function monthToExcelSerial(value) {
  const [year, month] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, 1) / 86400000 + 25569;
}

// Column layout of a sheet with a Lead column, or null for sheets without one
function analyzeSheet(range) {
  const { values, text } = range;
  const headerRow = findHeaderRow(values);
  if (headerRow === -1) return null;
  const { columns, statuses } = mapColumns(values[headerRow], text[headerRow]);
  if (columns.lead === undefined) return null;

  const start = range.address.split('!')[1].match(/^([A-Z]+)(\d+)/);
  const firstRow = parseInt(start[2], 10);
  const firstCol = letterToIndex(start[1]);

  // Columns up to the last one with a header; later columns have no heading in the sheet
  const headerCells = values[headerRow];
  let lastCol = headerCells.length - 1;
  while (lastCol > 0 && (headerCells[lastCol] === '' || headerCells[lastCol] === null)) lastCol--;

  const statusLabels = new Map(statuses.map((s) => [s.index, s.label]));
  const projectStart = Math.min(columns.tier ?? Infinity, columns.project ?? Infinity);
  const headers = [];
  for (let i = 0; i <= lastCol; i++) {
    headers.push({
      letter: columnLetter(firstCol + i),
      label: statusLabels.get(i) || oneLine(text[headerRow][i] || headerCells[i]),
      group: statusLabels.has(i) ? 'status' : i >= projectStart ? 'project' : 'kpi',
    });
  }

  const hierarchy = [columns.perspective, columns.objective, columns.kra].filter((i) => i !== undefined);
  const kpiColumns = [columns.qualityPolicy, columns.kpi].filter((i) => i !== undefined);
  const dateColumns = [columns.launchDate, columns.completionDate].filter((i) => i !== undefined);

  return { headerRow, columns, headers, firstRow, firstCol, hierarchy, kpiColumns, dateColumns };
}

function rowCells(layout, range, r) {
  const cell = cellReader(range.values[r], range.text[r]);
  return layout.headers.map((_, i) => cell(i));
}

// Column indexes in row r whose cell holds a formula (these are read-only)
function formulaColumns(layout, range, r) {
  const row = range.formulas?.[r] || [];
  return layout.headers.map((_, i) => i).filter((i) => typeof row[i] === 'string' && row[i].startsWith('='));
}

// Identifies a row so a save can detect rows being inserted/moved in Excel meanwhile
function rowIdentity(layout, cells) {
  const { columns } = layout;
  return {
    lead: cells[columns.lead] || '',
    name: (columns.project !== undefined && cells[columns.project]) || (columns.kpi !== undefined && cells[columns.kpi]) || '',
  };
}

function userAccess(user, department) {
  const canViewAll = user.role === 'admin';
  const userCodes = (user.departments || []).map((d) => canonicalCode(d.code || d.name));
  const viewing = canViewAll ? (department ? [canonicalCode(department)] : null) : userCodes;
  return { canViewAll, userCodes, viewing };
}

async function requireSheet(sheet) {
  const sheets = await listVisibleSheets();
  if (!sheets.some((s) => s.name === sheet)) throw httpError(404, `Sheet "${sheet}" not found.`);
}

/**
 * The sheet as a spreadsheet grid (real Excel column letters and row numbers), with rows
 * filtered like Excel's "Lead contains <code>" filter. Admins see every row unless they pick
 * a department; everyone else only sees rows led by their own department.
 *
 * Perspective/Objective/KRA (and the KPI for project rows) are only filled in on the first row of
 * each group, so they are carried down onto filtered rows and flagged as `inherited`.
 */
async function getGridForUser(user, { sheet, department, refresh = false } = {}) {
  await requireSheet(sheet);
  const [range, format] = await Promise.all([getUsedRange(sheet, { refresh }), getSheetFormat(sheet)]);
  const layout = analyzeSheet(range);
  if (!layout) return { sheet, supported: false };

  const { columns, headers, headerRow, firstRow, hierarchy, kpiColumns } = layout;
  const { canViewAll, viewing } = userAccess(user, department);
  const wanted = viewing && new Set(viewing);

  const carried = {};
  const rows = [];
  const leadCodes = new Set();
  let totalRows = 0;

  for (let r = headerRow + 1; r < range.values.length; r++) {
    const cells = rowCells(layout, range, r);
    if (cells.every((v) => !v)) continue;
    totalRows++;

    // A new level resets everything below it (new Objective clears KRA and KPI, etc.)
    hierarchy.forEach((col, level) => {
      if (cells[col]) {
        carried[col] = cells[col];
        hierarchy.slice(level + 1).forEach((below) => delete carried[below]);
        kpiColumns.forEach((k) => delete carried[k]);
      }
    });
    const lead = parseCodes(cells[columns.lead]);
    const isKpiRow = columns.kpi !== undefined && cells[columns.kpi] && (lead.length || cells[columns.qualityPolicy]);
    if (isKpiRow) kpiColumns.forEach((k) => { carried[k] = cells[k]; });

    lead.forEach((c) => leadCodes.add(c));
    if (wanted && !lead.some((c) => wanted.has(c))) continue;

    const identity = rowIdentity(layout, cells);
    const inherited = [];
    for (const col of [...hierarchy, ...kpiColumns]) {
      if (!cells[col] && carried[col]) {
        cells[col] = carried[col];
        inherited.push(col);
      }
    }
    rows.push({ row: firstRow + r, cells, inherited, formulas: formulaColumns(layout, range, r), identity });
  }

  const departments = [
    ...DEPARTMENTS.filter((d) => leadCodes.has(d.code)).map(({ code, name }) => ({ code, name })),
    ...[...leadCodes].filter((c) => !DEPARTMENTS.some((d) => d.code === c)).sort().map((code) => ({ code, name: '' })),
  ];

  // Excel look: widths/heights/colors from the .xlsx (null when formatting couldn't be loaded)
  const absoluteCol = (i) => layout.firstCol + i;
  const headerRowNumber = firstRow + headerRow;
  const styled = format && {
    zoom: format.zoom,
    frozenRows: format.frozenRows,
    showGridLines: format.showGridLines,
    defaultRowHeight: format.defaultRowHeight,
    defaultColWidth: format.defaultColWidth,
    styles: format.styles,
    headerHeight: format.rowHeights[headerRowNumber] || null,
    columns: headers.map((_, i) => ({
      width: format.columns[absoluteCol(i)]?.width ?? null,
      hidden: !!format.columns[absoluteCol(i)]?.hidden,
      headerStyle: format.cells[headerRowNumber]?.[absoluteCol(i)] ?? null,
    })),
  };
  if (styled) {
    for (const row of rows) {
      row.height = format.rowHeights[row.row] || null;
      row.styles = headers.map((_, i) => format.cells[row.row]?.[absoluteCol(i)] ?? null);
    }
  }

  return {
    sheet,
    supported: true,
    format: styled || null,
    headers,
    rows,
    totalRows,
    leadColumn: headers[columns.lead].letter,
    dateColumns: layout.dateColumns,
    // Rows shown to a department user are all rows they lead, so every shown row is editable
    editable: true,
    canViewAll,
    viewingDepartments: viewing || [],
    departments,
  };
}

/**
 * Loads one cell for a change (value or format), re-reading the sheet first. Refuses when the
 * user's department doesn't lead the row (admins excepted), the row no longer matches what the
 * user loaded, or the cell only shows a value carried down from a row above.
 */
async function loadCellForChange(user, { sheet, row, column, identity }) {
  await requireSheet(sheet);
  const range = await getUsedRange(sheet, { refresh: true });
  const layout = analyzeSheet(range);
  if (!layout) throw httpError(422, `"${sheet}" can't be edited here.`);

  const r = row - layout.firstRow;
  const col = letterToIndex(column) - layout.firstCol;
  if (r <= layout.headerRow || r >= range.values.length) throw httpError(404, `Row ${row} is not in the sheet any more.`);
  if (col < 0 || col >= layout.headers.length) throw httpError(400, `Column ${column} can't be edited.`);

  const cells = rowCells(layout, range, r);
  const { canViewAll, userCodes } = userAccess(user);
  const lead = parseCodes(cells[layout.columns.lead]);
  if (!canViewAll && !lead.some((c) => userCodes.includes(c))) {
    throw httpError(403, 'You can only edit rows that your department leads.');
  }

  const current = rowIdentity(layout, cells);
  if (identity && (identity.lead !== current.lead || identity.name !== current.name)) {
    throw httpError(409, `Row ${row} changed in Excel since you loaded it (rows may have been added or moved). Refresh and try again.`);
  }
  if ([...layout.hierarchy, ...layout.kpiColumns].includes(col) && !cells[col]) {
    throw httpError(400, 'This value is carried down from a row above. Edit it on the row where it starts.');
  }
  return { range, layout, r, col, cells };
}

/**
 * Saves one cell value back to Excel, after the checks in loadCellForChange. Also refuses
 * formula cells and cells changed in Excel since the user loaded them.
 */
async function updateCellForUser(user, { sheet, row, column, value, previous = '', identity }) {
  const { range, layout, r, col, cells } = await loadCellForChange(user, { sheet, row, column, identity });
  if (formulaColumns(layout, range, r).includes(col)) {
    throw httpError(400, `${column}${row} is calculated by an Excel formula and can't be edited here.`);
  }
  if ((previous || '') !== cells[col]) {
    throw httpError(409, `Someone changed ${column}${row} in Excel meanwhile (it now says "${cells[col] || '(empty)'}"). Refresh and try again.`);
  }

  let toWrite = String(value ?? '');
  if (toWrite.length > MAX_CELL_LENGTH) throw httpError(400, `Text is too long (max ${MAX_CELL_LENGTH} characters).`);
  let numberFormat;
  if (layout.dateColumns.includes(col) && /^\d{4}-\d{2}$/.test(toWrite)) {
    toWrite = monthToExcelSerial(toWrite);
    numberFormat = 'mmm-yy';
  } else if (/^[=+\-@]/.test(toWrite) && Number.isNaN(Number(toWrite))) {
    // Store as text so it is never run as an Excel formula
    toWrite = `'${toWrite}`;
  }

  const address = `${column}${row}`;
  const text = await writeCell(sheet, address, toWrite, { numberFormat });
  invalidateScorecard(sheet);

  await EditLog.create({
    userId: user.id,
    userEmail: user.email,
    sheet,
    cell: address,
    column: layout.headers[col].label,
    oldValue: cells[col],
    newValue: text,
  });
  logger.info(`${user.email} edited ${sheet}!${address}: "${cells[col]}" -> "${text}"`);

  cells[col] = text;
  return { row, column, text, identity: rowIdentity(layout, cells) };
}

/**
 * Changes one cell's formatting in Excel (font, colors, alignment, wrap), after the same checks
 * as editing a value. `format` is already validated by the route. Returns the cell's new style.
 */
async function formatCellForUser(user, { sheet, row, column, identity, format }) {
  const { layout, col } = await loadCellForChange(user, { sheet, row, column, identity });
  const address = `${column}${row}`;

  await writeCellFormat(sheet, address, format);
  const { before, after } = updateCachedStyle(sheet, row, layout.firstCol + col, format);

  await EditLog.create({
    userId: user.id,
    userEmail: user.email,
    sheet,
    cell: address,
    column: `${layout.headers[col].label} (format)`,
    oldValue: before ? JSON.stringify(before) : null,
    newValue: JSON.stringify(format),
  });
  logger.info(`${user.email} formatted ${sheet}!${address}: ${JSON.stringify(format)}`);

  return { row, column, style: after };
}

module.exports = { getGridForUser, updateCellForUser, formatCellForUser };
