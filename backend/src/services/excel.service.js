const { getAppGraphClient } = require('./graph.service');

/**
 * Excel reads and writes through Microsoft Graph. Every function takes `wb`, the workbook to use:
 * { id, driveId, itemId, name } (a row of the workbooks table, see workbook.service).
 * Caches are kept per workbook and sheet.
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

async function graphGet(path, select) {
  const client = await getAppGraphClient();
  try {
    return await client.api(path).select(select).get();
  } catch (err) {
    throw explainGraphError(err);
  }
}

async function listWorksheets(wb) {
  const { value } = await graphGet(`${workbookPath(wb)}/worksheets`, 'id,name,position,visibility');
  return value;
}

const WORKBOOK_INFO_TTL_MS = 10 * 60 * 1000;
const workbookInfo = new Map();

// Name and Excel-for-the-web address of the workbook; links are built from `docUrl`
async function getWorkbookInfo(wb) {
  const hit = workbookInfo.get(wb.itemId);
  if (hit && Date.now() - hit.at < WORKBOOK_INFO_TTL_MS) return hit.data;
  const item = await graphGet(`/drives/${wb.driveId}/items/${wb.itemId}`, 'name,webUrl');

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
  const data = await graphGet(`${sheetPath(wb, sheetName)}/usedRange(valuesOnly=true)`, 'address,values,text,formulas');
  rangeCache.set(key, { at: Date.now(), data });
  return data;
}

// The top-left block of a sheet (first `rows` rows, columns A–BZ): enough to find its header row
// without downloading the whole sheet
async function getTopRows(wb, sheetName, rows = 30) {
  return graphGet(`${sheetPath(wb, sheetName)}/range(address='A1:BZ${rows}')`, 'values,text');
}

// Writes one cell (e.g. "R130"); `numberFormat` keeps e.g. dates displayed as "mmm-yy".
// Returns the cell as Excel now displays it.
async function writeCell(wb, sheetName, address, value, { numberFormat } = {}) {
  const client = await getAppGraphClient();
  const body = { values: [[value]] };
  if (numberFormat) body.numberFormat = [[numberFormat]];
  try {
    const result = await client.api(`${sheetPath(wb, sheetName)}/range(address='${address}')`).patch(body);
    forgetRange(wb, sheetName);
    return result.text?.[0]?.[0] ?? String(value);
  } catch (err) {
    throw explainWriteError(err);
  }
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
  const client = await getAppGraphClient();
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

  try {
    if (Object.keys(font).length) await client.api(`${base}/font`).patch(font);
    if (format.fillColor === null) await client.api(`${base}/fill/clear`).post({});
    else if (format.fillColor !== undefined) await client.api(`${base}/fill`).patch({ color: format.fillColor });
    if (Object.keys(alignment).length) await client.api(base).patch(alignment);
  } catch (err) {
    throw explainWriteError(err);
  }
}

/**
 * Merges or unmerges a range such as "R130:T130" or "A129:A131". Before merging, `clear`
 * ([{ address, rows, cols }]) empties the cells merging would discard, so what Excel keeps is
 * decided here and the kept (top-left) cell is never rewritten. `center` = "Merge & Center".
 */
async function mergeRange(wb, sheetName, address, { merge, clear = [], center = false }) {
  const client = await getAppGraphClient();
  const sheet = sheetPath(wb, sheetName);
  const range = `${sheet}/range(address='${address}')`;
  try {
    if (merge) {
      for (const part of clear || []) {
        const blank = Array.from({ length: part.rows }, () => Array(part.cols).fill(''));
        await client.api(`${sheet}/range(address='${part.address}')`).patch({ values: blank });
      }
      await client.api(`${range}/merge`).post({ across: false });
      if (center) await client.api(`${range}/format`).patch({ horizontalAlignment: 'Center' });
    } else {
      await client.api(`${range}/unmerge`).post({});
    }
    forgetRange(wb, sheetName);
  } catch (err) {
    throw explainWriteError(err);
  }
}

// Writes a block of values (2D array) to a range such as "BT2:BT384"
async function writeRange(wb, sheetName, address, values) {
  const client = await getAppGraphClient();
  try {
    await client.api(`${sheetPath(wb, sheetName)}/range(address='${address}')`).patch({ values });
    forgetRange(wb, sheetName);
  } catch (err) {
    throw explainWriteError(err);
  }
}

/**
 * Inserts an empty column at `letter` (e.g. "R"), shifting that column and everything right of it
 * one place right, like Excel's "Insert sheet columns" (formulas and merged areas follow), then
 * writes `header` into `headerAddress` (e.g. "R1"). `header` may be a date serial with `numberFormat`.
 */
async function insertColumn(wb, sheetName, letter, headerAddress, header, { numberFormat } = {}) {
  const client = await getAppGraphClient();
  const sheet = sheetPath(wb, sheetName);
  try {
    await client.api(`${sheet}/range(address='${letter}:${letter}')/insert`).post({ shift: 'Right' });
    const body = { values: [[header]] };
    if (numberFormat) body.numberFormat = [[numberFormat]];
    await client.api(`${sheet}/range(address='${headerAddress}')`).patch(body);
    forgetRange(wb, sheetName);
  } catch (err) {
    forgetRange(wb, sheetName);
    throw explainWriteError(err);
  }
}

// Deletes a whole column, shifting the columns right of it one place left (Excel's "Delete sheet columns")
async function deleteColumn(wb, sheetName, letter) {
  const client = await getAppGraphClient();
  try {
    await client.api(`${sheetPath(wb, sheetName)}/range(address='${letter}:${letter}')/delete`).post({ shift: 'Left' });
    forgetRange(wb, sheetName);
  } catch (err) {
    forgetRange(wb, sheetName);
    throw explainWriteError(err);
  }
}

// Hides (or shows) a whole column, e.g. "BT"
async function setColumnHidden(wb, sheetName, letter, hidden = true) {
  const client = await getAppGraphClient();
  try {
    await client.api(`${sheetPath(wb, sheetName)}/range(address='${letter}:${letter}')`).patch({ columnHidden: hidden });
  } catch (err) {
    throw explainGraphError(err);
  }
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
  insertColumn,
  deleteColumn,
  setColumnHidden,
  explainGraphError,
};
