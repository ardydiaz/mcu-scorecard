const { getUsedRange, writeCell, writeCellFormat, mergeRange, writeRange, writeCellNumberFormat } = require('./excel.service');
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
const { departmentOptions } = require('../config/departments');
const { accessFor, withoutNarrow, rowAccess, rowVisible } = require('./access.service');
const { getSheetFormat, updateCachedStyle, updateCachedMerge } = require('./format.service');
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

  // Columns up to the last one with a header; later columns have no heading in the sheet.
  // The hidden Row ID column (far to the right) isn't shown in the grid.
  const headerCells = values[headerRow];
  let lastCol = headerCells.length - 1;
  while (lastCol > 0 && (headerCells[lastCol] === '' || headerCells[lastCol] === null || lastCol === columns.rowId)) lastCol--;

  const statusLabels = new Map(statuses.map((s) => [s.index, s.label]));
  const projectStart = Math.min(columns.tier ?? Infinity, columns.project ?? Infinity);
  const headers = [];
  for (let i = 0; i <= lastCol; i++) {
    headers.push({
      letter: columnLetter(firstCol + i),
      label: statusLabels.get(i) || oneLine(text[headerRow][i] || headerCells[i]),
      // The header cell as Excel shows it (used to check the column didn't move before changing it)
      header: oneLine(text[headerRow][i] || headerCells[i]),
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

// The row's permanent ID from the hidden Row ID column ('' when the sheet has none yet)
function rowIdAt(layout, range, r) {
  if (layout.columns.rowId === undefined) return '';
  return oneLine(cellReader(range.values[r], range.text[r])(layout.columns.rowId));
}

/**
 * Perspective / Objective / KRA for every sheet row, carried down from the row where each starts
 * (the sheet only fills them in on the first row of a group). Returns an array indexed like range.values.
 */
function hierarchyByRow(layout, range) {
  const { columns, headerRow } = layout;
  const levels = ['perspective', 'objective', 'kra'].filter((k) => columns[k] !== undefined);
  const current = {};
  const out = [];
  for (let r = headerRow + 1; r < range.values.length; r++) {
    const cell = cellReader(range.values[r], range.text[r]);
    levels.forEach((level, i) => {
      const value = oneLine(cell(columns[level]));
      if (value) {
        current[level] = value;
        levels.slice(i + 1).forEach((below) => delete current[below]);
      }
    });
    out[r] = { ...current };
  }
  return out;
}

// What access rules match on for sheet row r of file `wb` (see access.service ruleMatches)
function rowFacts(wb, sheet, layout, range, r, hierarchy, cells = rowCells(layout, range, r)) {
  return {
    workbookId: wb.id,
    sheet,
    lead: parseCodes(cells[layout.columns.lead]),
    support: parseCodes(cells[layout.columns.support]),
    perspective: hierarchy[r]?.perspective || '',
    objective: hierarchy[r]?.objective || '',
    kra: hierarchy[r]?.kra || '',
    rowId: rowIdAt(layout, range, r),
  };
}

// Merged areas starting on an Excel row, as grid columns: [{ col, span, rows }] where `rows` is
// how many sheet rows it covers (1 = merged across only)
function rowMerges(format, layout, rowNumber, columnCount) {
  return (format?.merges || [])
    .filter((m) => m.top === rowNumber)
    .map((m) => ({ col: m.left - 1 - layout.firstCol, span: m.right - m.left + 1, rows: m.bottom - m.top + 1 }))
    .filter((m) => m.col >= 0 && m.col < columnCount)
    .map((m) => ({ ...m, span: Math.min(m.span, columnCount - m.col) }));
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

// Excel areas (1-based sheet columns) as grid column ranges { top, bottom, c1, c2 }; parts outside the grid are cut off
function toGridAreas(areas, layout, columnCount) {
  return (areas || []).map((a) => ({
    top: a.top,
    bottom: a.bottom,
    c1: Math.max(0, a.left - 1 - layout.firstCol),
    c2: Math.min(columnCount - 1, a.right - 1 - layout.firstCol),
  })).filter((a) => a.c1 <= a.c2);
}

// The strict dropdown list (Excel data validation with a "Stop" alert) covering a cell, or null
function strictListAt(format, rowNumber, absCol) {
  const c1 = absCol + 1;
  return (format?.dropdowns || []).find((d) => d.strict && d.areas.some((a) => a.left <= c1 && a.right >= c1 && a.top <= rowNumber && a.bottom >= rowNumber)) || null;
}

/**
 * Checks a value against the cell's strict dropdown list like Excel does. Returns the list's own
 * spelling of the value ("on track" -> "On Track"); throws when the value isn't in the list.
 */
function checkDropdown(format, rowNumber, absCol, value, address) {
  const dd = strictListAt(format, rowNumber, absCol);
  if (!dd) return value;
  const text = String(value ?? '').trim();
  if (!text) return value;
  const hit = dd.list.find((item) => item.toLowerCase() === text.toLowerCase());
  if (!hit) throw httpError(400, `${address} only accepts a value from its list: ${dd.list.join(', ')}.`);
  return hit;
}

async function requireSheet(wb, sheet) {
  const sheets = await listVisibleSheets(wb);
  if (!sheets.some((s) => s.name === sheet)) throw httpError(404, `Sheet "${sheet}" not found in "${wb.name}".`);
}

/**
 * The sheet as a spreadsheet grid (real Excel column letters and row numbers), with rows
 * filtered like Excel's "Lead contains <code>" filter. Admins see every row unless they pick
 * a department; everyone else only sees rows led by their own department.
 *
 * Perspective/Objective/KRA (and the KPI for project rows) are only filled in on the first row of
 * each group, so they are carried down onto filtered rows and flagged as `inherited`.
 */
async function getGridForUser(wb, user, { sheet, department, refresh = false } = {}) {
  await requireSheet(wb, sheet);
  const [range, format] = await Promise.all([getUsedRange(wb, sheet, { refresh }), getSheetFormat(wb, sheet)]);
  const layout = analyzeSheet(range);
  if (!layout) return { sheet, supported: false };

  const { columns, headers, headerRow, firstRow, hierarchy, kpiColumns } = layout;
  const access = accessFor(user, department);
  const { canViewAll, viewing } = access;
  const choosable = withoutNarrow(access);
  const levels = hierarchyByRow(layout, range);

  const carried = {};
  const rows = [];
  // Lead dropdown: every code in the sheet for view-all users; a Department Head only gets the
  // codes on rows they may see, so the dropdown never names rows hidden from them
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

    const facts = rowFacts(wb, sheet, layout, range, r, levels, cells);
    if (canViewAll || rowVisible(choosable, facts)) lead.forEach((c) => leadCodes.add(c));
    if (!rowVisible(access, facts)) continue;

    const identity = rowIdentity(layout, cells);
    const inherited = [];
    for (const col of [...hierarchy, ...kpiColumns]) {
      if (!cells[col] && carried[col]) {
        cells[col] = carried[col];
        inherited.push(col);
      }
    }
    rows.push({
      row: firstRow + r,
      cells,
      inherited,
      formulas: formulaColumns(layout, range, r),
      identity,
      rowId: facts.rowId,
      // Stable key for per-user settings such as hidden rows (Row ID when the sheet has them)
      key: facts.rowId ? `id:${facts.rowId}` : `name:${identity.lead}|${identity.name}`,
      // Rows shown but not editable: view-only access rules, or view-all users (EXECOM) on others' rows
      editable: rowAccess(access, facts).edit,
    });
  }

  const departments = departmentOptions(leadCodes);

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
    // Excel's conditional formatting (colors that depend on the value) and dropdown lists, by grid column
    conditional: (format.conditional || []).map((cf) => ({ areas: toGridAreas(cf.areas, layout, headers.length), rules: cf.rules }))
      .filter((cf) => cf.areas.length),
    dropdowns: (format.dropdowns || []).map((d) => ({ list: d.list, strict: d.strict, allowBlank: d.allowBlank, areas: toGridAreas(d.areas, layout, headers.length) }))
      .filter((d) => d.areas.length),
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
      row.merges = rowMerges(format, layout, row.row, headers.length);
    }
  }

  return {
    workbookId: wb.id,
    sheet,
    supported: true,
    format: styled || null,
    headers,
    rows,
    totalRows,
    leadColumn: headers[columns.lead].letter,
    dateColumns: layout.dateColumns,
    // Editing is allowed on this grid; each row's own `editable` says whether this user may change it
    editable: true,
    canViewAll,
    canFilterLead: access.canFilterLead,
    viewingDepartments: viewing || [],
    // Access rules that add rows beyond the user's own Lead rows
    accessRuleCount: canViewAll ? 0 : access.rules.length,
    departments,
  };
}

/**
 * Loads one cell for a change (value or format), re-reading the sheet first. Refuses when the
 * user's department doesn't lead the row (admins excepted), the row no longer matches what the
 * user loaded, or the cell only shows a value carried down from a row above.
 */
async function loadCellForChange(wb, user, { sheet, row, column, identity }) {
  await requireSheet(wb, sheet);
  const range = await getUsedRange(wb, sheet, { refresh: true });
  const layout = analyzeSheet(range);
  if (!layout) throw httpError(422, `"${sheet}" can't be edited here.`);

  const r = row - layout.firstRow;
  const col = letterToIndex(column) - layout.firstCol;
  if (r <= layout.headerRow || r >= range.values.length) throw httpError(404, `Row ${row} is not in the sheet any more.`);
  if (col < 0 || col >= layout.headers.length) throw httpError(400, `Column ${column} can't be edited.`);

  const cells = rowCells(layout, range, r);
  const facts = rowFacts(wb, sheet, layout, range, r, hierarchyByRow(layout, range), cells);
  if (!rowAccess(accessFor(user), facts).edit) {
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
async function updateCellForUser(wb, user, { sheet, row, column, value, previous = '', identity }) {
  const { range, layout, r, col, cells } = await loadCellForChange(wb, user, { sheet, row, column, identity });
  if (formulaColumns(layout, range, r).includes(col)) {
    throw httpError(400, `${column}${row} is calculated by an Excel formula and can't be edited here.`);
  }
  if ((previous || '') !== cells[col]) {
    throw httpError(409, `Someone changed ${column}${row} in Excel meanwhile (it now says "${cells[col] || '(empty)'}"). Refresh and try again.`);
  }

  let toWrite = String(value ?? '');
  if (toWrite.length > MAX_CELL_LENGTH) throw httpError(400, `Text is too long (max ${MAX_CELL_LENGTH} characters).`);
  // A cell with a strict dropdown list (Excel data validation) only takes a value from that list
  toWrite = checkDropdown(await getSheetFormat(wb, sheet), row, layout.firstCol + col, toWrite, `${column}${row}`);
  let numberFormat;
  if (layout.dateColumns.includes(col) && /^\d{4}-\d{2}$/.test(toWrite)) {
    toWrite = monthToExcelSerial(toWrite);
    numberFormat = 'mmm-yy';
  } else if (/^[=+\-@]/.test(toWrite) && Number.isNaN(Number(toWrite))) {
    // Store as text so it is never run as an Excel formula
    toWrite = `'${toWrite}`;
  }

  const address = `${column}${row}`;
  const text = await writeCell(wb, sheet, address, toWrite, { numberFormat });
  invalidateScorecard(wb, sheet);
  logger.info(`${user.email} edited ${wb.name} / ${sheet}!${address}: "${cells[col]}" -> "${text}"`);

  const oldValue = cells[col];
  cells[col] = text;
  return {
    row,
    column,
    text,
    identity: rowIdentity(layout, cells),
    // For the audit log (recorded by the controller)
    change: { target: `${sheet}!${address}`, details: { workbook: wb.name, column: layout.headers[col].label, oldValue, newValue: text } },
  };
}

/**
 * Changes one cell's formatting in Excel (font, colors, alignment, wrap), after the same checks
 * as editing a value. `format` is already validated by the route. Returns the cell's new style.
 */
async function formatCellForUser(wb, user, { sheet, row, column, identity, format }) {
  const { layout, col } = await loadCellForChange(wb, user, { sheet, row, column, identity });
  const address = `${column}${row}`;

  await writeCellFormat(wb, sheet, address, format);
  const { after } = updateCachedStyle(wb, sheet, row, layout.firstCol + col, format);
  logger.info(`${user.email} formatted ${wb.name} / ${sheet}!${address}: ${JSON.stringify(format)}`);

  return {
    row,
    column,
    style: after,
    // For the audit log (recorded by the controller)
    change: { target: `${sheet}!${address}`, details: { workbook: wb.name, column: layout.headers[col].label, format } },
  };
}

/**
 * Merges a range like Excel (e.g. R130:T130 across, or A129:A131 down), or unmerges a merged cell.
 * Rules on top of the usual edit checks for the top-left cell:
 *  - every row in the range must be one the user may edit (led by their department; admins any),
 *    and each row must still be the row the user loaded (`identities`, one per row, top to bottom).
 *    That also means a department can't swallow other departments' rows hidden by its filter.
 *  - Lead, Projects and KPI can't be merged down (each row needs its own), and across one row they
 *    may only be the leftmost cell, so their value is always the one kept
 *  - no formula cells, and no partial overlap with an existing merged area
 *  - values in the cells being merged away are only discarded after the user confirms
 *    (`confirm`); otherwise a 409 with code CONFIRM_MERGE lists them
 */
async function mergeCellsForUser(wb, user, {
  sheet, row, endRow = row, startColumn, endColumn, identities = [], merge = true, center = false, confirm = false,
}) {
  const { range, layout, r, col: startCol } = await loadCellForChange(wb, user, { sheet, row, column: startColumn, identity: identities[0] });
  const endCol = letterToIndex(endColumn) - layout.firstCol;
  const endR = endRow - layout.firstRow;
  if (endCol < startCol || endCol >= layout.headers.length || endRow < row || endR >= range.values.length) {
    throw httpError(400, 'That range is outside the sheet.');
  }

  const absStart = layout.firstCol + startCol + 1; // 1-based, like Excel
  const absEnd = layout.firstCol + endCol + 1;
  const format = await getSheetFormat(wb, sheet);
  const overlapping = (format?.merges || []).filter((m) => m.top <= endRow && m.bottom >= row && m.left <= absEnd && m.right >= absStart);

  // Every row in the range: editable by this user, and still the row they loaded
  const access = accessFor(user);
  const levels = hierarchyByRow(layout, range);
  const rowsInRange = [];
  for (let rr = r; rr <= endR; rr++) {
    const cells = rowCells(layout, range, rr);
    const rowNumber = layout.firstRow + rr;
    if (!rowAccess(access, rowFacts(wb, sheet, layout, range, rr, levels, cells)).edit) {
      throw httpError(403, `You can't edit row ${rowNumber}, so it can't be part of your merge.`);
    }
    const expected = identities[rr - r];
    const now = rowIdentity(layout, cells);
    if (expected && (expected.lead !== now.lead || expected.name !== now.name)) {
      throw httpError(409, `Row ${rowNumber} changed in Excel since you loaded it (rows may have been added or moved). Refresh and try again.`);
    }
    rowsInRange.push({ rr, rowNumber, cells });
  }

  if (!merge) {
    const area = overlapping.find((m) => m.top === row && m.left === absStart);
    if (!area) throw httpError(400, `${startColumn}${row} is not merged.`);
    const areaAddress = `${startColumn}${area.top}:${columnLetter(area.right - 1)}${area.bottom}`;
    await mergeRange(wb, sheet, areaAddress, { merge: false });
    updateCachedMerge(wb, sheet, area, false);
    invalidateScorecard(wb, sheet);
    return {
      row, endRow: area.bottom, startColumn, endColumn: columnLetter(area.right - 1), merged: false,
      change: { target: `${sheet}!${areaAddress}`, details: { workbook: wb.name } },
    };
  }

  if (endCol === startCol && endRow === row) throw httpError(400, 'Select two or more cells to merge.');
  const address = `${startColumn}${row}:${endColumn}${endRow}`;
  if (overlapping.some((m) => m.top < row || m.bottom > endRow || m.left < absStart || m.right > absEnd)) {
    throw httpError(400, 'Part of this range is already merged with cells outside it. Unmerge that first.');
  }

  const { columns } = layout;
  const protectedCols = [columns.lead, columns.project, columns.kpi].filter((c) => c !== undefined && c >= startCol && c <= endCol);
  if (endRow > row && protectedCols.length) {
    throw httpError(400, `${layout.headers[protectedCols[0]].label} can't be merged down: every row needs its own ${layout.headers[protectedCols[0]].label} value.`);
  }
  const coveredProtected = protectedCols.find((c) => c > startCol);
  if (coveredProtected !== undefined) {
    throw httpError(400, `The ${layout.headers[coveredProtected].label} cell can only be the first (leftmost) cell of a merge, so its value is kept.`);
  }

  const lost = [];
  for (const { rr, rowNumber, cells } of rowsInRange) {
    const formula = formulaColumns(layout, range, rr).find((c) => c >= startCol && c <= endCol);
    if (formula !== undefined) throw httpError(400, `${layout.headers[formula].letter}${rowNumber} has a formula and can't be merged.`);
    for (let c = startCol; c <= endCol; c++) {
      if (rr === r && c === startCol) continue; // the top-left cell is kept
      if (cells[c]) lost.push({ cell: `${layout.headers[c].letter}${rowNumber}`, column: layout.headers[c].label, value: cells[c] });
    }
  }
  if (lost.length && !confirm) {
    throw Object.assign(httpError(409, `Merging keeps only ${startColumn}${row}. ${lost.length} other cell(s) have values that would be deleted.`), {
      data: { code: 'CONFIRM_MERGE', lost },
    });
  }

  // Empty everything except the top-left cell (the rest of its row, then the rows below)
  const width = endCol - startCol + 1;
  const clear = [];
  if (lost.length) {
    if (endCol > startCol) clear.push({ address: `${layout.headers[startCol + 1].letter}${row}:${endColumn}${row}`, rows: 1, cols: width - 1 });
    if (endRow > row) clear.push({ address: `${startColumn}${row + 1}:${endColumn}${endRow}`, rows: endRow - row, cols: width });
  }
  await mergeRange(wb, sheet, address, { merge: true, center, clear });
  updateCachedMerge(wb, sheet, { top: row, bottom: endRow, left: absStart, right: absEnd }, true);
  const style = center ? updateCachedStyle(wb, sheet, row, layout.firstCol + startCol, { hAlign: 'center' }).after : null;
  invalidateScorecard(wb, sheet);
  logger.info(`${user.email} merged ${wb.name} / ${sheet}!${address}${lost.length ? ` (cleared ${lost.map((l) => l.cell).join(', ')})` : ''}`);

  return {
    row,
    endRow,
    startColumn,
    endColumn,
    merged: true,
    style,
    change: { target: `${sheet}!${address}`, details: { workbook: wb.name, center, ...(lost.length && { deletedValues: lost }) } },
  };
}

const MAX_PASTE_CELLS = 2000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "Aug-26" / "Aug 2026" (as copied from a date column) -> "2026-08"; null for anything else
function monthText(value) {
  const m = /^([A-Za-z]{3})[-\s'](\d{2}|\d{4})$/.exec(String(value).trim());
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (month === -1) return null;
  return `${m[2].length === 2 ? 2000 + Number(m[2]) : m[2]}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Pastes values into the grid, like Ctrl+V in Excel (values only, formatting unchanged).
 * `targets`: [{ row, identity, cells: [{ column, value, previous }] }] for the rows shown to the user.
 * All or nothing: if any cell can't be changed (a row the user may not edit, a formula cell, a row
 * that moved, or a cell someone changed meanwhile) nothing is written. Cells are written in as few
 * rectangular blocks as possible; rows the user doesn't see (filtered out) are never touched.
 * Returns { cells: [{ row, column, text }], identities: { [row]: identity }, change }.
 */
async function pasteForUser(wb, user, { sheet, targets }) {
  await requireSheet(wb, sheet);
  const total = targets.reduce((n, t) => n + t.cells.length, 0);
  if (!total) throw httpError(400, 'There is nothing to paste.');
  if (total > MAX_PASTE_CELLS) throw httpError(400, `You can paste at most ${MAX_PASTE_CELLS} cells at once (this paste has ${total}).`);

  const range = await getUsedRange(wb, sheet, { refresh: true });
  const layout = analyzeSheet(range);
  if (!layout) throw httpError(422, `"${sheet}" can't be edited here.`);
  const access = accessFor(user);
  const levels = hierarchyByRow(layout, range);
  const format = await getSheetFormat(wb, sheet);

  const denied = [];
  const blocked = [];
  const writes = [];
  for (const t of targets) {
    const r = t.row - layout.firstRow;
    if (r <= layout.headerRow || r >= range.values.length) throw httpError(409, `Row ${t.row} is not in the sheet any more. Refresh and try again.`);
    const cells = rowCells(layout, range, r);
    if (!rowAccess(access, rowFacts(wb, sheet, layout, range, r, levels, cells)).edit) { denied.push(t.row); continue; }
    const now = rowIdentity(layout, cells);
    if (t.identity && (t.identity.lead !== now.lead || t.identity.name !== now.name)) {
      throw httpError(409, `Row ${t.row} changed in Excel since you loaded it (rows may have been added or moved). Refresh and try again.`);
    }
    const formulas = formulaColumns(layout, range, r);
    for (const { column, value, previous } of t.cells) {
      const col = letterToIndex(column) - layout.firstCol;
      if (col < 0 || col >= layout.headers.length) { blocked.push(`${column}${t.row} (outside the sheet)`); continue; }
      if (formulas.includes(col)) { blocked.push(`${column}${t.row} (formula)`); continue; }
      if (previous !== undefined && (previous || '') !== cells[col]) {
        throw httpError(409, `Someone changed ${column}${t.row} in Excel meanwhile (it now says "${cells[col] || '(empty)'}"). Refresh and try again.`);
      }
      let text = String(value ?? '');
      if (text.length > MAX_CELL_LENGTH) throw httpError(400, `${column}${t.row}: text is too long (max ${MAX_CELL_LENGTH} characters).`);
      text = checkDropdown(format, t.row, layout.firstCol + col, text, `Nothing was pasted: ${column}${t.row}`);
      let write = text;
      let isDate = false;
      if (layout.dateColumns.includes(col) && (monthText(text) || /^\d{4}-\d{2}$/.test(text))) {
        write = monthToExcelSerial(monthText(text) || text);
        isDate = true;
      } else if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) {
        write = `'${text}`; // stored as text so it is never run as an Excel formula
      }
      writes.push({ r, col, write, isDate, row: t.row, column, old: cells[col] });
    }
  }
  if (denied.length) {
    throw httpError(403, `Nothing was pasted: you can't edit row${denied.length === 1 ? '' : 's'} ${denied.slice(0, 8).join(', ')}${denied.length > 8 ? '…' : ''} (your department doesn't lead ${denied.length === 1 ? 'it' : 'them'}).`);
  }
  if (blocked.length) {
    throw httpError(400, `Nothing was pasted: ${blocked.slice(0, 6).join(', ')}${blocked.length > 6 ? ` and ${blocked.length - 6} more` : ''} can't be changed here.`);
  }

  // Rectangular blocks: per row, runs of adjacent columns; consecutive rows with the same run are merged
  const byRow = new Map();
  for (const w of writes) byRow.set(w.r, [...(byRow.get(w.r) || []), w]);
  const blocks = [];
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const ws = byRow.get(r).sort((a, b) => a.col - b.col);
    let run = [ws[0]];
    const flush = () => {
      const c1 = run[0].col; const c2 = run.at(-1).col;
      const last = blocks.at(-1);
      if (last && last.c1 === c1 && last.c2 === c2 && last.r2 === r - 1) { last.r2 = r; last.rows.push(run); } else blocks.push({ r1: r, r2: r, c1, c2, rows: [run] });
    };
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].col === run.at(-1).col + 1) run.push(ws[i]); else { flush(); run = [ws[i]]; }
    }
    flush();
  }
  const addr = (r, c) => `${columnLetter(layout.firstCol + c)}${layout.firstRow + r}`;
  for (const b of blocks) {
    await writeRange(wb, sheet, `${addr(b.r1, b.c1)}:${addr(b.r2, b.c2)}`, b.rows.map((run) => run.map((w) => w.write)));
  }
  // Pasted months show as "Aug-26", like dates entered in the grid
  for (const w of writes.filter((x) => x.isDate)) await writeCellNumberFormat(wb, sheet, addr(w.r, w.col), 'mmm-yy');

  invalidateScorecard(wb, sheet);
  const after = await getUsedRange(wb, sheet, { refresh: true });
  const textAt = (r, col) => cellReader(after.values[r], after.text[r])(col);
  const identities = {};
  for (const r of byRow.keys()) identities[layout.firstRow + r] = rowIdentity(layout, rowCells(layout, after, r));
  const first = blocks[0]; const lastB = blocks.at(-1);
  const area = `${addr(first.r1, Math.min(...blocks.map((b) => b.c1)))}:${addr(lastB.r2, Math.max(...blocks.map((b) => b.c2)))}`;
  logger.info(`${user.email} pasted ${writes.length} cell(s) into ${wb.name} / ${sheet}!${area} (${blocks.length} block(s))`);
  return {
    cells: writes.map((w) => ({ row: w.row, column: w.column, text: textAt(w.r, w.col) })),
    identities,
    change: {
      target: `${sheet}!${area}`,
      details: {
        workbook: wb.name,
        cells: writes.length,
        rows: byRow.size,
        sample: writes.slice(0, 5).map((w) => ({ cell: `${w.column}${w.row}`, oldValue: w.old, newValue: String(w.write).replace(/^'/, '') })),
      },
    },
  };
}

module.exports = {
  getGridForUser,
  pasteForUser,
  updateCellForUser,
  formatCellForUser,
  mergeCellsForUser,
  // Sheet-reading helpers shared with rowid.service / access-rule.service
  analyzeSheet,
  rowCells,
  rowIdAt,
  hierarchyByRow,
  letterToIndex,
};
