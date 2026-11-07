const env = require('../config/env');
const { getAppGraphClient } = require('./graph.service');
const { explainGraphError, getUsedRange, listWorksheets, getWorkbookInfo, writeCell, writeCellFormat } = require('./excel.service');
const { resolveWorkbook } = require('./workbook.service');
const { getSheetFormat, updateCachedStyle } = require('./format.service');
const { columnLetter } = require('./scorecard.service');
const logger = require('../utils/logger');

/**
 * Operational Dashboard: reads the Excel file in the SharePoint "Operational" folder (next to the
 * scorecard folder, or OPERATIONAL_FOLDER_ID) - read-only. The first visible sheet is laid out as:
 * A = item, C = particular (what is measured), G = person in charge (initials), and the update columns
 * to the right (H onwards, oldest first). Rows with only a name in A are section rows: the 4M
 * (Manpower, Materials, Machinery, Methods...) or a group within one (e.g. Staffing).
 */
const CACHE_MS = 60 * 1000;
const FOLDER_NAME = /^operational$/i;
const SECTIONS = /^(manpower|materials?|machinery|machines?|methods?|money|measurements?|environment)$/i;
const COL = { item: 0, particular: 2, pic: 6, firstUpdate: 7 };

// Latest update text -> status (checked in this order, so "good condition (1 device for repair)" needs attention)
const STATUS_RULES = [
  ['issue', /repair|defective|problem|beeping|not working|offline|\bdown\b|\bissue|damaged|for replacement/i],
  ['checking', /for checking|verifying|under monitoring|pending|on ?going/i],
  ['good', /good (running )?condition|in good|running condition|\bactive\b|operational|functional/i],
];
const statusOf = (text) => (!text ? 'none' : (STATUS_RULES.find(([, re]) => re.test(text)) || ['noted'])[0]);

let fileCache = null; // { at, file: { driveId, itemId, name, webUrl, lastModified } }
const dataCache = new Map(); // itemId -> { at, data }

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// The newest Excel file in the Operational folder
async function findFile(client) {
  if (fileCache && Date.now() - fileCache.at < CACHE_MS) return fileCache.file;
  const wb = await resolveWorkbook(undefined, { role: 'admin' });
  const drive = wb.driveId || env.excel.driveId;
  let folderId = process.env.OPERATIONAL_FOLDER_ID;
  if (!folderId) {
    const item = await client.api(`/drives/${drive}/items/${wb.itemId}`).select('parentReference').get();
    const scorecard = await client.api(`/drives/${drive}/items/${item.parentReference.id}`).select('parentReference').get();
    const siblings = await client.api(`/drives/${drive}/items/${scorecard.parentReference.id}/children`).select('id,name,folder').top(200).get();
    folderId = siblings.value.find((f) => f.folder && FOLDER_NAME.test(f.name))?.id;
    if (!folderId) throw httpError(404, 'The "Operational" folder was not found next to the scorecard folder in SharePoint.');
  }
  const files = (await client.api(`/drives/${drive}/items/${folderId}/children`).select('id,name,file,webUrl,lastModifiedDateTime').top(200).get())
    .value.filter((f) => f.file && /\.xlsx$/i.test(f.name) && !f.name.startsWith('~$'))
    .sort((a, b) => b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime));
  if (!files.length) throw httpError(404, 'There is no Excel file in the "Operational" folder yet.');
  const f = files[0];
  fileCache = { at: Date.now(), file: { driveId: drive, itemId: f.id, name: f.name, webUrl: f.webUrl, lastModified: f.lastModifiedDateTime } };
  return fileCache.file;
}

const clean = (v) => String(v ?? '').replace(/\r/g, '').trim();

// Sheet values (as Excel shows them) -> { title, asOf, updates: [labels], sections: [{ name, items }] }
function parseSheet(text) {
  const width = Math.max(...text.map((r) => r.length));
  // Update columns: from H on, those with a value in any item row
  const updateCols = [];
  for (let c = COL.firstUpdate; c < width; c += 1) {
    if (text.slice(1).some((r) => clean(r[c]) && clean(r[COL.pic]))) updateCols.push(c);
  }
  const header = text[0] || [];
  const updates = updateCols.map((c, i) => clean(header[c]) || `Update ${i + 1}`);

  const sections = [];
  let section = null;
  let group = '';
  text.slice(1).forEach((r, i) => {
    const name = clean(r[COL.item]);
    const particular = clean(r[COL.particular]);
    const pic = clean(r[COL.pic]);
    const values = updateCols.map((c) => clean(r[c]));
    if (!name && !particular) return;
    const isHeading = name && !pic && values.every((v) => !v);
    if (isHeading && (SECTIONS.test(name) || !section)) {
      section = { name, items: [] };
      sections.push(section);
      group = '';
      return;
    }
    if (isHeading) { group = name; return; }
    if (!section) { section = { name: 'Other', items: [] }; sections.push(section); }
    // Latest = the last update column with a value; previous = the one before it with a value
    const filled = values.map((v, k) => [v, k]).filter(([v]) => v);
    const [latest, latestIdx] = filled[filled.length - 1] || ['', -1];
    const [previous] = filled[filled.length - 2] || [''];
    section.items.push({
      row: i + 2,
      name,
      particular,
      group,
      pic: pic.split(/\s*[/,&]\s*/).filter(Boolean),
      latest,
      latestLabel: latestIdx >= 0 ? updates[latestIdx] : '',
      previous,
      changed: Boolean(previous && latest && previous !== latest),
      status: statusOf(latest),
      // `status` = the condition as of that update, from the last update so far with a value (an empty
      // column keeps the condition the item already had); used by the condition timeline
      history: values.map((v, k) => ({ label: updates[k], text: v, status: statusOf(values.slice(0, k + 1).filter(Boolean).pop() || '') })),
    });
  });
  return { title: clean(header[0]) || 'Operational', updates, sections: sections.filter((s) => s.items.length) };
}

async function getDashboard({ refresh = false } = {}) {
  let client;
  try {
    client = await getAppGraphClient();
    const file = await findFile(client);
    const hit = dataCache.get(file.itemId);
    if (!refresh && hit && Date.now() - hit.at < CACHE_MS && hit.data.file.lastModified === file.lastModified) return hit.data;
    const base = `/drives/${file.driveId}/items/${file.itemId}/workbook`;
    const sheets = (await client.api(`${base}/worksheets`).select('name,visibility').get()).value.filter((w) => w.visibility === 'Visible');
    if (!sheets.length) throw httpError(404, 'The Operational file has no visible sheet.');
    const sheet = sheets[0].name;
    const used = await client.api(`${base}/worksheets('${encodeURIComponent(sheet.replace(/'/g, "''"))}')/usedRange(valuesOnly=true)`).select('text').get();
    const data = { ...parseSheet(used.text), sheet, file, loadedAt: new Date().toISOString() };
    dataCache.set(file.itemId, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (err.status) throw err;
    throw explainGraphError(err);
  }
}

// ---------- Excel view (the grid on the Operational Dashboard) ----------

// Who may change the file: admins and the departments in OPERATIONAL_EDITORS (default ITD, the
// ICT office that writes the report). Everyone else sees the grid read-only.
const EDITOR_DEPARTMENTS = (process.env.OPERATIONAL_EDITORS || 'ITD').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
function canEdit(user) {
  if (user?.role === 'admin') return true;
  return (user?.departments || []).some((d) => EDITOR_DEPARTMENTS.includes(String(d.code || '').toUpperCase()));
}

const MAX_CELL_LENGTH = 5000;
const letterToIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// The Operational file as the `wb` the Excel and format services work with
async function operationalWb() {
  const client = await getAppGraphClient();
  const file = await findFile(client);
  return { id: `operational:${file.itemId}`, driveId: file.driveId, itemId: file.itemId, name: file.name };
}

async function visibleSheets(wb) {
  return (await listWorksheets(wb)).filter((s) => s.visibility === 'Visible').sort((a, b) => a.position - b.position).map((s) => s.name);
}

async function requireSheet(wb, sheet) {
  if (!(await visibleSheets(wb)).includes(sheet)) throw httpError(404, `Sheet "${sheet}" not found in "${wb.name}".`);
}

// The used range's top-left cell: { firstRow (1-based), firstCol (0-based) }
function rangeStart(range) {
  const m = range.address.split('!')[1].match(/^([A-Z]+)(\d+)/);
  return { firstRow: parseInt(m[2], 10), firstCol: letterToIndex(m[1]) };
}

// A row's identity: its item name (column A), to detect rows inserted or moved in Excel meanwhile
const identityOf = (cells) => ({ lead: '', name: cells[0] || '' });

/**
 * The sheet as a grid for SheetGrid, in the same shape as the Live Agenda's (grid.service), without
 * the scorecard parts (Lead filter, access rules, carried-down values): row 1 is the header row and
 * every other row is shown as it is in Excel, with the file's formatting.
 */
async function getGrid(user, { sheet, refresh = false } = {}) {
  try {
    const wb = await operationalWb();
    const sheets = await visibleSheets(wb);
    if (!sheets.length) throw httpError(404, 'The Operational file has no visible sheet.');
    const name = sheet || sheets[0];
    if (!sheets.includes(name)) throw httpError(404, `Sheet "${name}" not found in "${wb.name}".`);
    const [range, format, info] = await Promise.all([
      getUsedRange(wb, name, { refresh }), getSheetFormat(wb, name), getWorkbookInfo(wb).catch(() => null),
    ]);
    const { firstRow, firstCol } = rangeStart(range);
    const width = Math.max(1, ...range.text.map((r) => r.length));
    const text = (r, i) => String(range.text[r]?.[i] ?? '');
    const editable = canEdit(user);

    const headers = Array.from({ length: width }, (_, i) => ({
      letter: columnLetter(firstCol + i),
      label: text(0, i).replace(/\s+/g, ' ').trim(),
      header: text(0, i).replace(/\s+/g, ' ').trim(),
      group: 'kpi',
    }));
    const rows = [];
    for (let r = 1; r < range.text.length; r++) {
      const cells = headers.map((_, i) => text(r, i));
      const formulas = range.formulas?.[r] || [];
      rows.push({
        row: firstRow + r,
        cells,
        inherited: [],
        formulas: headers.map((_, i) => i).filter((i) => typeof formulas[i] === 'string' && formulas[i].startsWith('=')),
        identity: identityOf(cells),
        rowId: '',
        key: `row:${firstRow + r}`,
        editable,
      });
    }

    // Excel look (as in grid.service): widths, heights, colors and merged cells from the .xlsx
    const absCol = (i) => firstCol + i;
    const headerRowNumber = firstRow;
    const toGrid = (areas) => (areas || []).map((a) => ({
      top: a.top, bottom: a.bottom, c1: Math.max(0, a.left - 1 - firstCol), c2: Math.min(width - 1, a.right - 1 - firstCol),
    })).filter((a) => a.c1 <= a.c2);
    const styled = format && {
      zoom: format.zoom,
      frozenRows: format.frozenRows,
      showGridLines: format.showGridLines,
      defaultRowHeight: format.defaultRowHeight,
      defaultColWidth: format.defaultColWidth,
      pxPerChar: format.pxPerChar || null,
      styles: format.styles,
      headerHeight: format.rowHeights[headerRowNumber] || null,
      conditional: (format.conditional || []).map((cf) => ({ areas: toGrid(cf.areas), rules: cf.rules })).filter((cf) => cf.areas.length),
      dropdowns: (format.dropdowns || []).map((d) => ({ list: d.list, strict: d.strict, allowBlank: d.allowBlank, areas: toGrid(d.areas) }))
        .filter((d) => d.areas.length),
      columns: headers.map((_, i) => ({
        width: format.columns[absCol(i)]?.width ?? null,
        hidden: !!format.columns[absCol(i)]?.hidden,
        headerStyle: format.cells[headerRowNumber]?.[absCol(i)] ?? null,
      })),
    };
    if (styled) {
      for (const row of rows) {
        row.height = format.rowHeights[row.row] || null;
        row.styles = headers.map((_, i) => format.cells[row.row]?.[absCol(i)] ?? null);
        row.merges = (format.merges || [])
          .filter((m) => m.top === row.row)
          .map((m) => ({ col: m.left - 1 - firstCol, span: m.right - m.left + 1, rows: m.bottom - m.top + 1 }))
          .filter((m) => m.col >= 0 && m.col < width)
          .map((m) => ({ ...m, span: Math.min(m.span, width - m.col) }));
      }
    }

    return {
      sheet: name,
      sheets: sheets.map((s) => ({ name: s })),
      supported: true,
      format: styled || null,
      headers,
      rows,
      totalRows: rows.length,
      leadColumn: null,
      dateColumns: [],
      editable,
      canViewAll: true,
      canFilterLead: false,
      viewingDepartments: [],
      accessRuleCount: 0,
      departments: [],
      docUrl: info?.docUrl || null,
      fileName: wb.name,
    };
  } catch (err) {
    if (err.status) throw err;
    throw explainGraphError(err);
  }
}

// Re-reads the sheet and checks a cell may be changed: editor, row still the one the user loaded
async function loadCell(user, { sheet, row, column, identity }) {
  if (!canEdit(user)) throw httpError(403, 'Only admins and the ICT office can change the Operational file.');
  const wb = await operationalWb();
  await requireSheet(wb, sheet);
  const range = await getUsedRange(wb, sheet, { refresh: true });
  const { firstRow, firstCol } = rangeStart(range);
  const r = row - firstRow;
  const col = letterToIndex(column) - firstCol;
  const width = Math.max(1, ...range.text.map((x) => x.length));
  if (r < 1 || r >= range.text.length) throw httpError(404, `Row ${row} is not in the sheet any more.`);
  if (col < 0 || col >= width) throw httpError(400, `Column ${column} can't be edited.`);
  const cells = Array.from({ length: width }, (_, i) => String(range.text[r]?.[i] ?? ''));
  if (identity && identity.name !== identityOf(cells).name) {
    throw httpError(409, `Row ${row} changed in Excel since you loaded it (rows may have been added or moved). Refresh and try again.`);
  }
  return { wb, range, r, col, cells, firstCol };
}

// Saves one cell value to the Operational file; refuses formula cells and cells changed meanwhile
async function updateCell(user, { sheet, row, column, value, previous = '', identity }) {
  const { wb, range, r, col, cells } = await loadCell(user, { sheet, row, column, identity });
  const formula = range.formulas?.[r]?.[col];
  if (typeof formula === 'string' && formula.startsWith('=')) {
    throw httpError(400, `${column}${row} is calculated by an Excel formula and can't be edited here.`);
  }
  if ((previous || '') !== cells[col]) {
    throw httpError(409, `Someone changed ${column}${row} in Excel meanwhile (it now says "${cells[col] || '(empty)'}"). Refresh and try again.`);
  }
  let toWrite = String(value ?? '');
  if (toWrite.length > MAX_CELL_LENGTH) throw httpError(400, `Text is too long (max ${MAX_CELL_LENGTH} characters).`);
  // Stored as text so it is never run as an Excel formula
  if (/^[=+\-@]/.test(toWrite) && Number.isNaN(Number(toWrite))) toWrite = `'${toWrite}`;

  const address = `${column}${row}`;
  const text = await writeCell(wb, sheet, address, toWrite);
  dataCache.clear();
  logger.info(`${user.email} edited ${wb.name} / ${sheet}!${address}: "${cells[col]}" -> "${text}"`);
  const oldValue = cells[col];
  cells[col] = text;
  return {
    row,
    column,
    text,
    identity: identityOf(cells),
    change: { target: `${sheet}!${address}`, details: { workbook: wb.name, oldValue, newValue: text } },
  };
}

// Changes one cell's formatting (font, colors, alignment, wrap) in the Operational file
async function formatCell(user, { sheet, row, column, identity, format }) {
  const { wb, col, firstCol } = await loadCell(user, { sheet, row, column, identity });
  const address = `${column}${row}`;
  await writeCellFormat(wb, sheet, address, format);
  const { after } = updateCachedStyle(wb, sheet, row, firstCol + col, format);
  logger.info(`${user.email} formatted ${wb.name} / ${sheet}!${address}: ${JSON.stringify(format)}`);
  return { row, column, style: after, change: { target: `${sheet}!${address}`, details: { workbook: wb.name, format } } };
}

module.exports = { getDashboard, statusOf, parseSheet, getGrid, updateCell, formatCell, operationalWb, canEdit };
