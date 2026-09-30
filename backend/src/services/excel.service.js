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

module.exports = { listWorksheets, getUsedRange, getWorkbookInfo, writeCell };
