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

module.exports = { getSheetFormat, getTabColor, updateCachedStyle, updateCachedMerge, warmUp };
