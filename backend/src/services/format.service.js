const path = require('path');
const { Worker } = require('worker_threads');
const { getAppGraphClient } = require('./graph.service');
const logger = require('../utils/logger');

// Sheet formatting (widths, colors, fonts) comes from the .xlsx file itself, because reading it
// cell by cell through Graph takes minutes. Parsing takes a few seconds, so it runs in a worker
// thread and the result is cached per workbook; stale results are served while a refresh runs.
// `wb` is the workbook ({ driveId, itemId, ... }, see workbook.service).
const FORMAT_TTL_MS = 15 * 60 * 1000;
const WORKER_PATH = path.join(__dirname, '../workers/xlsxFormat.worker.js');

const cached = new Map(); // itemId -> { at, sheets }
const loading = new Map(); // itemId -> in-flight Promise

async function downloadWorkbook(wb) {
  const client = await getAppGraphClient();
  const stream = await client.api(`/drives/${wb.driveId}/items/${wb.itemId}/content`).getStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { buffer } });
    worker.once('message', (msg) => (msg.error ? reject(new Error(msg.error)) : resolve(msg.sheets)));
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`Format worker exited with code ${code}`)));
  });
}

function refresh(wb) {
  if (!loading.has(wb.itemId)) {
    const started = Date.now();
    loading.set(wb.itemId, downloadWorkbook(wb)
      .then(parseInWorker)
      .then((sheets) => {
        cached.set(wb.itemId, { at: Date.now(), sheets });
        logger.info(`Loaded Excel formatting of "${wb.name || wb.itemId}" (${Object.keys(sheets).length} sheets) in ${Date.now() - started} ms`);
        return sheets;
      })
      .finally(() => loading.delete(wb.itemId)));
  }
  return loading.get(wb.itemId);
}

const sheetOf = (wb, sheetName) => cached.get(wb.itemId)?.sheets[sheetName];

// Formatting of one sheet, or null if it can't be loaded (the grid then uses default styling)
async function getSheetFormat(wb, sheetName) {
  try {
    const hit = cached.get(wb.itemId);
    if (!hit) await refresh(wb);
    else if (Date.now() - hit.at > FORMAT_TTL_MS) refresh(wb).catch((err) => logger.warn(`Format refresh failed: ${err.message}`));
    return sheetOf(wb, sheetName) || null;
  } catch (err) {
    logger.warn(`Could not load Excel formatting: ${err.message}`);
    return null;
  }
}

// Applies a format change made through the system to the cached styles, so the grid shows it
// right away without re-parsing the workbook. Returns the cell's style before and after.
function updateCachedStyle(wb, sheetName, rowNumber, columnIndex, format) {
  const sheet = sheetOf(wb, sheetName);
  const current = sheet?.styles[sheet.cells[rowNumber]?.[columnIndex]] || null;
  const before = current ? { ...current } : null;

  const after = { ...(current || { bg: null, color: null, bold: false, italic: false, underline: false, size: null, font: null, h: null, v: null, wrap: false }) };
  if (format.bold !== undefined) after.bold = format.bold;
  if (format.italic !== undefined) after.italic = format.italic;
  if (format.underline !== undefined) after.underline = format.underline;
  if (format.fontName !== undefined) after.font = format.fontName;
  if (format.fontSize !== undefined) after.size = format.fontSize;
  if (format.fontColor !== undefined) after.color = format.fontColor;
  if (format.fillColor !== undefined) after.bg = format.fillColor;
  if (format.hAlign !== undefined) after.h = format.hAlign === 'general' ? null : format.hAlign;
  if (format.vAlign !== undefined) after.v = format.vAlign;
  if (format.wrap !== undefined) after.wrap = format.wrap;

  if (sheet) {
    const key = JSON.stringify(after);
    let index = sheet.styles.findIndex((s) => JSON.stringify(s) === key);
    if (index === -1) index = sheet.styles.push(after) - 1;
    if (!sheet.cells[rowNumber]) sheet.cells[rowNumber] = [];
    sheet.cells[rowNumber][columnIndex] = index;
  }
  return { before, after };
}

// Records a merge/unmerge made through the system in the cached merged areas.
// `area` is 1-based { top, left, bottom, right }.
function updateCachedMerge(wb, sheetName, area, merged) {
  const sheet = sheetOf(wb, sheetName);
  if (!sheet) return;
  const overlaps = (m) => m.top <= area.bottom && m.bottom >= area.top && m.left <= area.right && m.right >= area.left;
  sheet.merges = (sheet.merges || []).filter((m) => !overlaps(m));
  if (merged) sheet.merges.push({ ...area });
}

// Sheet tab color from the cached formatting (null until it has loaded once)
function getTabColor(wb, sheetName) {
  return sheetOf(wb, sheetName)?.tabColor || null;
}

// Loads a workbook's formatting in the background so its first viewer doesn't wait
function warmUp(wb) {
  if (wb) refresh(wb).catch((err) => logger.warn(`Format warm-up failed: ${err.message}`));
}

// Drops the cached formatting of a workbook; the next grid load reads it again (a few seconds)
function forget(wb) {
  cached.delete(wb.itemId);
}

/**
 * After a column was inserted (delta 1) or deleted (delta -1) at `col` (0-based sheet column), moves
 * the cached formatting along like Excel does, so the grid doesn't wait for the file to be read
 * again: widths, cell styles and merged areas right of it shift, and an inserted column takes the
 * formatting of the column on its left (as Excel's Insert does). The next periodic refresh reads the
 * real formatting from the file anyway.
 */
function shiftColumns(wb, sheetName, col, delta) {
  const sheet = sheetOf(wb, sheetName);
  if (!sheet) return;
  const shiftArray = (arr, copyLeft) => {
    if (!Array.isArray(arr) || arr.length < col) return;
    if (delta > 0) arr.splice(col, 0, copyLeft && col > 0 ? arr[col - 1] : undefined);
    else arr.splice(col, 1);
  };
  shiftArray(sheet.columns, true);
  for (const row of Object.keys(sheet.cells || {})) shiftArray(sheet.cells[row], true);
  const c1 = col + 1; // merges are 1-based
  sheet.merges = (sheet.merges || []).flatMap((m) => {
    if (delta > 0) {
      if (m.left >= c1) return [{ ...m, left: m.left + 1, right: m.right + 1 }];
      if (m.right >= c1) return [{ ...m, right: m.right + 1 }]; // the new column is inside the merged area
      return [m];
    }
    if (m.left === c1 && m.right === c1) return []; // the deleted column was the whole area
    if (m.left > c1) return [{ ...m, left: m.left - 1, right: m.right - 1 }];
    if (m.right >= c1) return [{ ...m, right: m.right - 1 }];
    return [m];
  });
}

/**
 * After a column was moved in the file (0-based `from`, inserted before 0-based `insertAt` in the
 * sheet's original order), moves its cached formatting the same way: widths, cell styles, merged
 * areas, color rules and dropdown areas.
 */
function moveColumn(wb, sheetName, from, insertAt) {
  const sheet = sheetOf(wb, sheetName);
  if (!sheet) return;
  const to = insertAt > from ? insertAt - 1 : insertAt; // the column's final 0-based index
  // New 0-based index of each column after the move
  const map = (c) => {
    if (c === from) return to;
    if (from < to && c > from && c <= to) return c - 1;
    if (to < from && c >= to && c < from) return c + 1;
    return c;
  };
  const moveIn = (arr) => {
    if (!Array.isArray(arr) || from >= arr.length) return;
    const [item] = arr.splice(from, 1);
    arr.splice(Math.min(to, arr.length), 0, item);
  };
  moveIn(sheet.columns);
  for (const row of Object.keys(sheet.cells || {})) moveIn(sheet.cells[row]);
  // Areas are 1-based { left, right }: a single-column area moves with its column; wider areas keep
  // their span (moves are refused when they would split one)
  const moveArea = (a) => {
    if (a.left === a.right) { const c = map(a.left - 1) + 1; return { ...a, left: c, right: c }; }
    const left = Math.min(map(a.left - 1), map(a.right - 1)) + 1;
    return { ...a, left, right: left + (a.right - a.left) };
  };
  sheet.merges = (sheet.merges || []).map(moveArea);
  for (const group of [...(sheet.conditional || []), ...(sheet.dropdowns || [])]) group.areas = group.areas.map(moveArea);
}

module.exports = { getSheetFormat, getTabColor, updateCachedStyle, updateCachedMerge, warmUp, forget, shiftColumns, moveColumn };
