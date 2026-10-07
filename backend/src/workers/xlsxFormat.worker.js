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

const letterIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// "K130:M131" -> { top: 130, left: 11, bottom: 131, right: 13 }
function parseArea(area) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(area));
  if (!m) return null;
  return { top: Number(m[2]), left: letterIndex(m[1]), bottom: Number(m[4]), right: letterIndex(m[3]) };
}

// "M2:N334" / "B5" -> area; several areas may be separated by spaces ("W12:W13 W35:W38")
function parseAreas(ref) {
  return String(ref || '').split(/\s+/).filter(Boolean).map((part) => {
    const one = /^\$?([A-Z]+)\$?(\d+)$/.exec(part);
    if (one) return { top: Number(one[2]), left: letterIndex(one[1]), bottom: Number(one[2]), right: letterIndex(one[1]) };
    return parseArea(part.replace(/\$/g, ''));
  }).filter(Boolean);
}

// Text inside quotes in a formula: "\"On Track\"" -> On Track; null when it isn't a plain text/number
function literal(formula) {
  const s = String(formula ?? '').trim();
  const q = /^"((?:[^"]|"")*)"$/.exec(s);
  if (q) return q[1].replace(/""/g, '"');
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return null;
}

/**
 * Conditional formatting the grid can apply itself, evaluated on each cell's value:
 *   contains / notContains / beginsWith / endsWith (text, case-insensitive, like Excel's SEARCH)
 *   equal / notEqual / greaterThan / lessThan / … with a literal value
 * Rules that use formulas or broken references (#REF!) are left out, as Excel can't apply those either.
 * Returns [{ areas, rules: [{ type, value, stop, style: { bg, color, bold, italic } }] }] by priority.
 */
function conditionalRules(ws, theme) {
  const out = [];
  for (const cf of ws.conditionalFormattings || []) {
    const areas = parseAreas(cf.ref);
    if (!areas.length) continue;
    const rules = [];
    for (const r of [...(cf.rules || [])].sort((a, b) => (a.priority || 0) - (b.priority || 0))) {
      let type = null;
      let value = null;
      const formula = String(r.formulae?.[0] ?? '');
      if (r.type === 'containsText') {
        value = r.text ?? (/(?:SEARCH|FIND)\("((?:[^"]|"")*)"/i.exec(formula)?.[1] || /LEFT\([^,]+,\s*LEN\("((?:[^"]|"")*)"\)\)/i.exec(formula)?.[1] || null);
        const op = r.operator || '';
        type = /notContains/i.test(op) ? 'notContains' : /beginsWith/i.test(op) ? 'beginsWith' : /endsWith/i.test(op) ? 'endsWith' : 'contains';
        if (!r.operator && /^ISERROR/i.test(formula)) type = 'notContains';
      } else if (r.type === 'cellIs') {
        value = literal(formula);
        type = r.operator || 'equal';
      }
      if (!type || value === null || value === undefined || /#REF!/i.test(formula)) continue;
      const fill = r.style?.fill;
      const style = {
        bg: fill ? resolveColor(fill.bgColor || fill.fgColor, theme) : null,
        color: resolveColor(r.style?.font?.color, theme),
        bold: r.style?.font?.bold ? true : undefined,
        italic: r.style?.font?.italic ? true : undefined,
      };
      if (!style.bg && !style.color && !style.bold && !style.italic) continue;
      rules.push({ type, value: String(value), stop: !!r.stopIfTrue, style });
    }
    if (rules.length) out.push({ areas, rules });
  }
  return out;
}

// Values of a list given as a range, e.g. "$Z$1:$Z$4" or "Lists!$A$1:$A$9"
function rangeValues(workbook, ws, ref) {
  const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref).replace(/^=/, ''));
  if (!m) return null;
  const sheet = m[1] ? workbook.getWorksheet(m[1]) : ws;
  if (!sheet) return null;
  const [c1, r1, c2, r2] = [letterIndex(m[2]), Number(m[3]), letterIndex(m[4] || m[2]), Number(m[5] || m[3])];
  const values = [];
  for (let r = r1; r <= r2; r++) for (let col = c1; col <= c2; col++) {
    const text = String(sheet.getRow(r).getCell(col).text ?? '').trim();
    if (text) values.push(text);
  }
  return values;
}

/**
 * Dropdown lists (data validation "List"): [{ list: [...], strict, allowBlank, areas }]. `strict` is
 * Excel's "Stop" alert: other values are refused. Cells are grouped into column runs.
 */
function dropdownLists(workbook, ws) {
  const model = ws.dataValidations?.model || {};
  const groups = new Map();
  for (const [ref, v] of Object.entries(model)) {
    if (v.type !== 'list' || !v.formulae?.[0]) continue;
    const formula = String(v.formulae[0]);
    const quoted = /^"(.*)"$/s.exec(formula);
    const list = quoted ? quoted[1].split(',').map((s) => s.trim()).filter(Boolean) : rangeValues(workbook, ws, formula);
    if (!list?.length) continue;
    const strict = v.showErrorMessage !== false && (!v.errorStyle || v.errorStyle === 'stop');
    const key = JSON.stringify([list, strict, !!v.allowBlank]);
    if (!groups.has(key)) groups.set(key, { list, strict, allowBlank: !!v.allowBlank, cells: new Map() });
    for (const a of parseAreas(ref)) {
      for (let col = a.left; col <= a.right; col++) {
        const rows = groups.get(key).cells.get(col) || [];
        for (let r = a.top; r <= a.bottom; r++) rows.push(r);
        groups.get(key).cells.set(col, rows);
      }
    }
  }
  return [...groups.values()].map((g) => {
    const areas = [];
    for (const [col, rows] of g.cells) {
      const sorted = [...new Set(rows)].sort((x, y) => x - y);
      let start = sorted[0];
      for (let i = 1; i <= sorted.length; i++) {
        if (i === sorted.length || sorted[i] !== sorted[i - 1] + 1) {
          areas.push({ top: start, bottom: sorted[i - 1], left: col, right: col });
          start = sorted[i];
        }
      }
    }
    return { list: g.list, strict: g.strict, allowBlank: g.allowBlank, areas };
  });
}

function describeSheet(ws, theme, workbook) {
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
    // Number format ";;;" hides the value: Excel shows only the cell's color (e.g. a traffic light)
    if (/^\s*;;;?\s*$/.test(String(cell.numFmt || ''))) style.hideText = true;
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

  // Merged areas as 1-based { top, left, bottom, right } (ExcelJS gives "K130:M130" strings)
  const merges = (ws.model.merges || []).map(parseArea).filter(Boolean);

  const view = (ws.views || [])[0] || {};
  return {
    merges,
    conditional: conditionalRules(ws, theme),
    dropdowns: dropdownLists(workbook, ws),
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
    sheets[ws.name] = describeSheet(ws, theme, workbook);
  }
  parentPort.postMessage({ sheets });
})().catch((err) => parentPort.postMessage({ error: err.message }));
