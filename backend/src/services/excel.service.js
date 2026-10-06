const { getAppGraphClient } = require('./graph.service');
const logger = require('../utils/logger');

/**
 * Excel reads and writes through Microsoft Graph. Every function takes `wb`, the workbook to use:
 * { id, driveId, itemId, name } (a row of the workbooks table, see workbook.service).
 * Caches are kept per workbook and sheet.
 *
 * Calls to a workbook share a persistent Excel session (Microsoft's recommendation for many calls to
 * one file): without one, each call opens and closes a session of its own, which makes every call
 * slow. Changes made in the session are saved to the file in SharePoint as usual.
 */

function workbookPath(wb) {
  if (!wb?.driveId || !wb?.itemId) throw Object.assign(new Error('No Excel workbook selected.'), { status: 503 });
  return `/drives/${wb.driveId}/items/${wb.itemId}/workbook`;
}

const sheetPath = (wb, sheetName) => `${workbookPath(wb)}/worksheets('${encodeURIComponent(sheetName)}')`;
const cacheKey = (wb, sheetName) => `${wb.itemId}::${sheetName}`;

// Turns Graph failures into messages that say what to fix
function explainGraphError(err) {
  if (err.statusCode === 403 || err.statusCode === 401) {
    return Object.assign(new Error(
      'The app does not have access to the Excel workbook yet. An admin must grant this app access to the '
      + 'SharePoint/OneDrive site that holds the file (Sites.Selected).'
    ), { status: 503 });
  }
  if (err.statusCode === 404) {
    return Object.assign(new Error('Excel workbook or sheet not found. It may have been moved, renamed or deleted in SharePoint.'), { status: 404 });
  }
  return err;
}

function explainWriteError(err) {
  if (err.statusCode === 403) {
    return Object.assign(new Error('The app is not allowed to edit the workbook. Its SharePoint site permission must be "write", not "read".'), { status: 503 });
  }
  return explainGraphError(err);
}

// ---- Persistent Excel sessions, one per workbook ----

// Excel ends a session after about 5 idle minutes; a new one is opened a little before that
const SESSION_IDLE_MS = 4 * 60 * 1000;
const sessions = new Map(); // itemId -> { id, usedAt } | { pending: Promise }

async function openSession(wb) {
  const client = await getAppGraphClient();
  const { id } = await client.api(`${workbookPath(wb)}/createSession`).post({ persistChanges: true });
  return id;
}

// The workbook's session id, or null when one can't be opened (calls then work without a session)
async function sessionFor(wb) {
  const s = sessions.get(wb.itemId);
  if (s?.id && Date.now() - s.usedAt < SESSION_IDLE_MS) { s.usedAt = Date.now(); return s.id; }
  if (s?.pending) return s.pending;
  const pending = openSession(wb)
    .then((id) => { sessions.set(wb.itemId, { id, usedAt: Date.now() }); return id; })
    .catch((err) => {
      sessions.delete(wb.itemId);
      logger.warn(`Could not open an Excel session for "${wb.name || wb.itemId}" (${err.statusCode || ''} ${err.message}); continuing without one`);
      return null;
    });
  sessions.set(wb.itemId, { pending });
  return pending;
}

const isSessionError = (err) => /session/i.test(`${err.code || ''} ${err.message || ''}`)
  && [400, 404, 409, 410].includes(err.statusCode);

/**
 * Runs `fn(api)` against the workbook, where api(path) is a Graph request carrying the session.
 * If Excel reports the session expired, a new one is opened and `fn` runs once more.
 */
async function withSession(wb, fn) {
  const client = await getAppGraphClient();
  const run = async (sid) => fn((path) => (sid ? client.api(path).header('workbook-session-id', sid) : client.api(path)));
  const sid = await sessionFor(wb);
  try {
    return await run(sid);
  } catch (err) {
    if (!sid || !isSessionError(err)) throw err;
    sessions.delete(wb.itemId);
    return run(await sessionFor(wb));
  }
}

async function workbookGet(wb, path, select) {
  try {
    return await withSession(wb, (api) => api(path).select(select).get());
  } catch (err) {
    throw explainGraphError(err);
  }
}

// ---- Reads ----

const SHEETS_TTL_MS = 5 * 60 * 1000;
const sheetLists = new Map(); // itemId -> { at, data }

// The workbook's sheets. Kept for 5 minutes (sheets are rarely added or renamed); `refresh` reads again.
async function listWorksheets(wb, { refresh = false } = {}) {
  const hit = sheetLists.get(wb.itemId);
  if (!refresh && hit && Date.now() - hit.at < SHEETS_TTL_MS) return hit.data;
  const { value } = await workbookGet(wb, `${workbookPath(wb)}/worksheets`, 'id,name,position,visibility');
  sheetLists.set(wb.itemId, { at: Date.now(), data: value });
  return value;
}

const WORKBOOK_INFO_TTL_MS = 10 * 60 * 1000;
const workbookInfo = new Map();

// Name and Excel-for-the-web address of the workbook; links are built from `docUrl`
async function getWorkbookInfo(wb) {
  const hit = workbookInfo.get(wb.itemId);
  if (hit && Date.now() - hit.at < WORKBOOK_INFO_TTL_MS) return hit.data;
  const client = await getAppGraphClient();
  let item;
  try {
    item = await client.api(`/drives/${wb.driveId}/items/${wb.itemId}`).select('name,webUrl').get();
  } catch (err) {
    throw explainGraphError(err);
  }

  // Keep only the document id and file name; the frontend adds action / activeCell
  const url = new URL(item.webUrl);
  const docUrl = new URL(url.origin + url.pathname);
  for (const key of ['sourcedoc', 'file']) {
    if (url.searchParams.has(key)) docUrl.searchParams.set(key, url.searchParams.get(key));
  }

  const data = { name: item.name, webUrl: item.webUrl, docUrl: docUrl.toString() };
  workbookInfo.set(wb.itemId, { at: Date.now(), data });
  return data;
}

const RANGE_TTL_MS = 60 * 1000;
const rangeCache = new Map();
const forgetRange = (wb, sheetName) => rangeCache.delete(cacheKey(wb, sheetName));

// Returns the sheet's filled area: raw `values` plus `text` (as displayed in Excel, e.g. "Aug-26", "15%").
// Cached for a minute; `refresh` reads Excel again.
async function getUsedRange(wb, sheetName, { refresh = false } = {}) {
  const key = cacheKey(wb, sheetName);
  const hit = rangeCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < RANGE_TTL_MS) return hit.data;
  const data = await workbookGet(wb, `${sheetPath(wb, sheetName)}/usedRange(valuesOnly=true)`, 'address,values,text,formulas');
  rangeCache.set(key, { at: Date.now(), data });
  return data;
}

// The top-left block of a sheet (first `rows` rows, columns A–BZ): enough to find its header row
// without downloading the whole sheet
async function getTopRows(wb, sheetName, rows = 30) {
  return workbookGet(wb, `${sheetPath(wb, sheetName)}/range(address='A1:BZ${rows}')`, 'values,text');
}

// ---- Writes ----

// Runs writes in the workbook's session; any change forgets the cached copy of the sheet
async function write(wb, sheetName, fn, explain = explainWriteError) {
  try {
    return await withSession(wb, fn);
  } catch (err) {
    throw explain(err);
  } finally {
    forgetRange(wb, sheetName);
  }
}

// Writes one cell (e.g. "R130"); `numberFormat` keeps e.g. dates displayed as "mmm-yy".
// Returns the cell as Excel now displays it.
async function writeCell(wb, sheetName, address, value, { numberFormat } = {}) {
  const body = { values: [[value]] };
  if (numberFormat) body.numberFormat = [[numberFormat]];
  const result = await write(wb, sheetName, (api) => api(`${sheetPath(wb, sheetName)}/range(address='${address}')`).patch(body));
  return result?.text?.[0]?.[0] ?? String(value);
}

const H_ALIGN = { general: 'General', left: 'Left', center: 'Center', right: 'Right' };
const V_ALIGN = { top: 'Top', middle: 'Center', bottom: 'Bottom' };

/**
 * Changes one cell's formatting. `format` may contain: bold, italic, underline (booleans),
 * fontName, fontSize, fontColor ("#RRGGBB"), fillColor ("#RRGGBB" or null for no fill),
 * hAlign (general/left/center/right), vAlign (top/middle/bottom), wrap (boolean).
 * Graph keeps font, fill and alignment as separate resources, so only the changed ones are sent.
 */
async function writeCellFormat(wb, sheetName, address, format) {
  const base = `${sheetPath(wb, sheetName)}/range(address='${address}')/format`;

  const font = {};
  if (format.bold !== undefined) font.bold = format.bold;
  if (format.italic !== undefined) font.italic = format.italic;
  if (format.underline !== undefined) font.underline = format.underline ? 'Single' : 'None';
  if (format.fontName !== undefined) font.name = format.fontName;
  if (format.fontSize !== undefined) font.size = format.fontSize;
  if (format.fontColor !== undefined) font.color = format.fontColor || '#000000';

  const alignment = {};
  if (format.hAlign !== undefined) alignment.horizontalAlignment = H_ALIGN[format.hAlign];
  if (format.vAlign !== undefined) alignment.verticalAlignment = V_ALIGN[format.vAlign];
  if (format.wrap !== undefined) alignment.wrapText = format.wrap;

  await write(wb, sheetName, async (api) => {
    if (Object.keys(font).length) await api(`${base}/font`).patch(font);
    if (format.fillColor === null) await api(`${base}/fill/clear`).post({});
    else if (format.fillColor !== undefined) await api(`${base}/fill`).patch({ color: format.fillColor });
    if (Object.keys(alignment).length) await api(base).patch(alignment);
  });
}

/**
 * Merges or unmerges a range such as "R130:T130" or "A129:A131". Before merging, `clear`
 * ([{ address, rows, cols }]) empties the cells merging would discard, so what Excel keeps is
 * decided here and the kept (top-left) cell is never rewritten. `center` = "Merge & Center".
 */
async function mergeRange(wb, sheetName, address, { merge, clear = [], center = false }) {
  const sheet = sheetPath(wb, sheetName);
  const range = `${sheet}/range(address='${address}')`;
  await write(wb, sheetName, async (api) => {
    if (merge) {
      for (const part of clear || []) {
        const blank = Array.from({ length: part.rows }, () => Array(part.cols).fill(''));
        await api(`${sheet}/range(address='${part.address}')`).patch({ values: blank });
      }
      await api(`${range}/merge`).post({ across: false });
      if (center) await api(`${range}/format`).patch({ horizontalAlignment: 'Center' });
    } else {
      await api(`${range}/unmerge`).post({});
    }
  });
}

// Sets the number format of one cell, e.g. "mmm-yy" so a pasted month shows as "Aug-26"
async function writeCellNumberFormat(wb, sheetName, address, numberFormat) {
  await write(wb, sheetName, (api) => api(`${sheetPath(wb, sheetName)}/range(address='${address}')`).patch({ numberFormat: [[numberFormat]] }));
}

// Writes a block of values (2D array) to a range such as "BT2:BT384"
async function writeRange(wb, sheetName, address, values) {
  await write(wb, sheetName, (api) => api(`${sheetPath(wb, sheetName)}/range(address='${address}')`).patch({ values }));
}

/**
 * Inserts an empty column at `letter` (e.g. "R"), shifting that column and everything right of it
 * one place right, like Excel's "Insert sheet columns" (formulas and merged areas follow), then
 * writes `header` into `headerAddress` (e.g. "R1"). `header` may be a date serial with `numberFormat`.
 */
async function insertColumn(wb, sheetName, letter, headerAddress, header, { numberFormat } = {}) {
  const sheet = sheetPath(wb, sheetName);
  const body = { values: [[header]] };
  if (numberFormat) body.numberFormat = [[numberFormat]];
  await write(wb, sheetName, async (api) => {
    await api(`${sheet}/range(address='${letter}:${letter}')/insert`).post({ shift: 'Right' });
    await api(`${sheet}/range(address='${headerAddress}')`).patch(body);
  });
}

// Deletes a whole column, shifting the columns right of it one place left (Excel's "Delete sheet columns")
async function deleteColumn(wb, sheetName, letter) {
  await write(wb, sheetName, (api) => api(`${sheetPath(wb, sheetName)}/range(address='${letter}:${letter}')/delete`).post({ shift: 'Left' }));
}

// Hides (or shows) a whole column, e.g. "BT"
async function setColumnHidden(wb, sheetName, letter, hidden = true) {
  await write(wb, sheetName, (api) => api(`${sheetPath(wb, sheetName)}/range(address='${letter}:${letter}')`).patch({ columnHidden: hidden }), explainGraphError);
}

module.exports = {
  listWorksheets,
  getUsedRange,
  getTopRows,
  getWorkbookInfo,
  writeCell,
  writeCellFormat,
  mergeRange,
  writeRange,
  writeCellNumberFormat,
  insertColumn,
  deleteColumn,
  setColumnHidden,
  explainGraphError,
};
