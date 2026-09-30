const env = require('../config/env');
const { getAppGraphClient } = require('./graph.service');

function workbookPath() {
  if (!env.excel.driveId || !env.excel.itemId) {
    throw Object.assign(new Error('EXCEL_DRIVE_ID and EXCEL_ITEM_ID must be set in .env'), { status: 503 });
  }
  return `/drives/${env.excel.driveId}/items/${env.excel.itemId}/workbook`;
}

// Turns Graph failures into messages that say what to fix
function explainGraphError(err) {
  if (err.statusCode === 403 || err.statusCode === 401) {
    return Object.assign(new Error(
      'The app does not have access to the Excel workbook yet. An admin must grant this app access to the '
      + 'SharePoint/OneDrive site that holds the file (Sites.Selected).'
    ), { status: 503 });
  }
  if (err.statusCode === 404) {
    return Object.assign(new Error('Excel workbook or sheet not found. Check EXCEL_DRIVE_ID, EXCEL_ITEM_ID and the sheet name.'), { status: 404 });
  }
  return err;
}

async function graphGet(path, select) {
  const client = await getAppGraphClient();
  try {
    return await client.api(path).select(select).get();
  } catch (err) {
    throw explainGraphError(err);
  }
}

async function listWorksheets() {
  const { value } = await graphGet(`${workbookPath()}/worksheets`, 'id,name,position,visibility');
  return value;
}

const WORKBOOK_INFO_TTL_MS = 10 * 60 * 1000;
let workbookInfo = null;

// Name and Excel-for-the-web address of the workbook; links are built from `docUrl`
async function getWorkbookInfo() {
  if (workbookInfo && Date.now() - workbookInfo.at < WORKBOOK_INFO_TTL_MS) return workbookInfo.data;
  const item = await graphGet(`/drives/${env.excel.driveId}/items/${env.excel.itemId}`, 'name,webUrl');

  // Keep only the document id and file name; the frontend adds action / activeCell
  const url = new URL(item.webUrl);
  const docUrl = new URL(url.origin + url.pathname);
  for (const key of ['sourcedoc', 'file']) {
    if (url.searchParams.has(key)) docUrl.searchParams.set(key, url.searchParams.get(key));
  }

  const data = { name: item.name, webUrl: item.webUrl, docUrl: docUrl.toString() };
  workbookInfo = { at: Date.now(), data };
  return data;
}

const RANGE_TTL_MS = 60 * 1000;
const rangeCache = new Map();

// Returns the sheet's filled area: raw `values` plus `text` (as displayed in Excel, e.g. "Aug-26", "15%").
// Cached for a minute; `refresh` reads Excel again.
async function getUsedRange(sheetName, { refresh = false } = {}) {
  const hit = rangeCache.get(sheetName);
  if (!refresh && hit && Date.now() - hit.at < RANGE_TTL_MS) return hit.data;
  const data = await graphGet(
    `${workbookPath()}/worksheets('${encodeURIComponent(sheetName)}')/usedRange(valuesOnly=true)`,
    'address,values,text,formulas'
  );
  rangeCache.set(sheetName, { at: Date.now(), data });
  return data;
}

// Writes one cell (e.g. "R130"); `numberFormat` keeps e.g. dates displayed as "mmm-yy".
// Returns the cell as Excel now displays it.
async function writeCell(sheetName, address, value, { numberFormat } = {}) {
  const client = await getAppGraphClient();
  const body = { values: [[value]] };
  if (numberFormat) body.numberFormat = [[numberFormat]];
  try {
    const result = await client
      .api(`${workbookPath()}/worksheets('${encodeURIComponent(sheetName)}')/range(address='${address}')`)
      .patch(body);
    rangeCache.delete(sheetName);
    return result.text?.[0]?.[0] ?? String(value);
  } catch (err) {
    if (err.statusCode === 403) {
      throw Object.assign(new Error('The app is not allowed to edit the workbook. Its SharePoint site permission must be "write", not "read".'), { status: 503 });
    }
    throw explainGraphError(err);
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
async function writeCellFormat(sheetName, address, format) {
  const client = await getAppGraphClient();
  const base = `${workbookPath()}/worksheets('${encodeURIComponent(sheetName)}')/range(address='${address}')/format`;

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
    if (err.statusCode === 403) {
      throw Object.assign(new Error('The app is not allowed to edit the workbook. Its SharePoint site permission must be "write", not "read".'), { status: 503 });
    }
    throw explainGraphError(err);
  }
}

/**
 * Merges or unmerges a range such as "R130:T130" or "A129:A131". Before merging, `clear`
 * ([{ address, rows, cols }]) empties the cells merging would discard, so what Excel keeps is
 * decided here and the kept (top-left) cell is never rewritten. `center` = "Merge & Center".
 */
async function mergeRange(sheetName, address, { merge, clear = [], center = false }) {
  const client = await getAppGraphClient();
  const sheetPath = `${workbookPath()}/worksheets('${encodeURIComponent(sheetName)}')`;
  const range = `${sheetPath}/range(address='${address}')`;
  try {
    if (merge) {
      for (const part of clear || []) {
        const blank = Array.from({ length: part.rows }, () => Array(part.cols).fill(''));
        await client.api(`${sheetPath}/range(address='${part.address}')`).patch({ values: blank });
      }
      await client.api(`${range}/merge`).post({ across: false });
      if (center) await client.api(`${range}/format`).patch({ horizontalAlignment: 'Center' });
    } else {
      await client.api(`${range}/unmerge`).post({});
    }
    rangeCache.delete(sheetName);
  } catch (err) {
    if (err.statusCode === 403) {
      throw Object.assign(new Error('The app is not allowed to edit the workbook. Its SharePoint site permission must be "write", not "read".'), { status: 503 });
    }
    throw explainGraphError(err);
  }
}

module.exports = { listWorksheets, getUsedRange, getWorkbookInfo, writeCell, writeCellFormat, mergeRange };
