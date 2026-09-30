// Runs in a worker thread: parses the .xlsx file with ExcelJS (slow, ~5 s) and extracts a compact
// description of how each visible sheet looks: column widths, row heights, colors, fonts, alignment.
const { parentPort, workerData } = require('worker_threads');
const ExcelJS = require('exceljs');

const MAX_COLUMNS = 80;

// ---- Colors -------------------------------------------------------------------------------

// Excel's theme color indexes: 0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2, 4-9 = accent1-6, 10 = hlink, 11 = folHlink
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const DEFAULT_THEME = {
  lt1: 'FFFFFF', dk1: '000000', lt2: 'E7E6E6', dk2: '44546A', accent1: '4472C4', accent2: 'ED7D31',
  accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
};
// Legacy indexed palette (only the commonly used entries)
const INDEXED = { 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 22: 'C0C0C0', 23: '808080', 64: '000000' };

function readTheme(workbook) {
  const xml = Object.values(workbook._themes || {})[0] || '';
  const theme = { ...DEFAULT_THEME };
  const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g;
  let m;
  while ((m = re.exec(xml))) theme[m[1]] = (m[2] || m[3]).toUpperCase();
  return THEME_ORDER.map((key) => theme[key]);
}

function hexToHsl(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex([h, s, l]) {
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    [r, g, b] = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Excel's tint: negative darkens, positive lightens (applied to HSL lightness)
function applyTint(hex, tint) {
  if (!tint) return hex;
  const [h, s, l] = hexToHsl(hex);
  return hslToHex([h, s, tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint]);
}

function resolveColor(color, theme) {
  if (!color) return null;
  let hex = null;
  if (color.argb) hex = color.argb.slice(-6);
  else if (color.theme !== undefined) hex = theme[color.theme];
  else if (color.indexed !== undefined) hex = INDEXED[color.indexed];
  return hex ? `#${applyTint(hex.toUpperCase(), color.tint)}` : null;
}

// ---- Sheets --------------------------------------------------------------------------------

function describeSheet(ws, theme) {
  const styles = [];
  const styleIndex = new Map();
  const styleOf = (cell) => {
    const fill = cell.fill?.type === 'pattern' && cell.fill.pattern !== 'none' ? resolveColor(cell.fill.fgColor, theme) : null;
    const font = cell.font || {};
    const a = cell.alignment || {};
    const style = {
      bg: fill,
      color: resolveColor(font.color, theme),
      bold: !!font.bold,
      italic: !!font.italic,
      underline: !!font.underline && font.underline !== 'none',
      size: font.size || null,
      font: font.name || null,
      h: a.horizontal || null,
      v: a.vertical || null,
      wrap: !!a.wrapText,
    };
    const key = JSON.stringify(style);
    if (!styleIndex.has(key)) {
      styleIndex.set(key, styles.length);
      styles.push(style);
    }
    return styleIndex.get(key);
  };

  const columnCount = Math.min(ws.columnCount || 0, MAX_COLUMNS);
  const columns = [];
  for (let c = 1; c <= columnCount; c++) {
    const col = ws.getColumn(c);
    columns.push({ width: col.width || null, hidden: !!col.hidden });
  }

  const rowHeights = {};
  const cells = {};
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.height) rowHeights[r] = row.height;
    const rowStyles = [];
    for (let c = 1; c <= columnCount; c++) rowStyles.push(styleOf(row.getCell(c)));
    cells[r] = rowStyles;
  }

  const view = (ws.views || [])[0] || {};
  return {
    name: ws.name,
    tabColor: resolveColor(ws.properties?.tabColor, theme),
    zoom: view.zoomScale || 100,
    frozenRows: view.state === 'frozen' ? view.ySplit || 0 : 0,
    frozenColumns: view.state === 'frozen' ? view.xSplit || 0 : 0,
    showGridLines: view.showGridLines !== false,
    defaultRowHeight: ws.properties?.defaultRowHeight || 15,
    defaultColWidth: ws.properties?.defaultColWidth || 8.43,
    columns,
    rowHeights,
    styles,
    cells,
  };
}

(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workerData.buffer));
  const theme = readTheme(workbook);
  const sheets = {};
  for (const ws of workbook.worksheets) {
    if (ws.state !== 'visible') continue;
    sheets[ws.name] = describeSheet(ws, theme);
  }
  parentPort.postMessage({ sheets });
})().catch((err) => parentPort.postMessage({ error: err.message }));
