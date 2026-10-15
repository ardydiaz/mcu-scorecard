import { useEffect, useMemo, useRef, useState } from 'react';
import { alertDialog, confirmDialog, promptDialog } from '../../utils/dialog';
import SheetRibbon from './SheetRibbon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150];
const ZOOM_KEY = 'mcu-scorecard-grid-zoom';
const MIN_COL_PX = 24; // narrowest a column can be dragged
const MIN_ROW_PX = 8; // lowest a row can be dragged
const UNDO_LIMIT = 100; // most recent changes kept for Ctrl+Z

// The formatting that puts back `before` (a cell style) for the options a change touched
function inverseFormat(changes, before) {
  const b = before || {};
  const previous = {
    bold: !!b.bold,
    italic: !!b.italic,
    underline: !!b.underline,
    fontName: b.font || 'Calibri',
    fontSize: b.size || 11,
    fontColor: b.color || '#000000',
    fillColor: b.bg || null,
    hAlign: ['left', 'center', 'right'].includes(b.h) ? b.h : 'general',
    vAlign: b.v === 'center' ? 'middle' : b.v || 'bottom',
    wrap: !!b.wrap,
  };
  return Object.fromEntries(Object.keys(changes).map((k) => [k, previous[k]]));
}
const DEFAULT_WIDTH_CHARS = 8.43;
const DEFAULT_HEIGHT_PT = 15;

// Excel units -> CSS pixels at 100% zoom
const colPx = (chars) => Math.round((chars ?? DEFAULT_WIDTH_CHARS) * 7 + 5);
const ptPx = (pt) => (pt * 4) / 3;

// "Aug-26" -> "2026-08" for <input type="month">; anything else -> ""
function toMonthInput(text) {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(text || '');
  const month = m && MONTHS.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
  return m && month >= 0 ? `20${m[2]}-${String(month + 1).padStart(2, '0')}` : '';
}

function readZoom(fallback) {
  try {
    const saved = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

// Cell style from the workbook's style table, scaled to the zoom level
function cellCss(style, zoom) {
  if (!style) return { fontSize: ptPx(11) * zoom };
  return {
    background: style.bg || undefined,
    color: style.color || undefined,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    fontFamily: style.font ? `"${style.font}", Calibri, Carlito, "Segoe UI", sans-serif` : undefined,
    fontSize: ptPx(style.size || 11) * zoom,
    textAlign: style.h && style.h !== 'general' ? (style.h === 'centerContinuous' ? 'center' : style.h) : undefined,
    verticalAlign: style.v === 'middle' || style.v === 'center' ? 'middle' : style.v === 'top' ? 'top' : 'bottom',
    whiteSpace: style.wrap ? 'pre-wrap' : 'pre',
  };
}

const FilterIcon = ({ active }) => (
  <span className={active ? 'xl-filter xl-filter--active' : 'xl-filter'} aria-hidden="true">
    {active ? (
      <svg viewBox="0 0 16 16"><path d="M2 3h12L9.5 8.5V13l-3 1.5v-6z" fill="currentColor" /></svg>
    ) : (
      <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4z" fill="currentColor" /></svg>
    )}
  </span>
);

function CellEditor({ initial, isDate, minHeight, onCommit, onCancel, onDraftChange }) {
  const [draft, setDraft] = useState(isDate ? toMonthInput(initial) : initial);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (!isDate) el.setSelectionRange(el.value.length, el.value.length);
  }, [isDate]);

  useEffect(() => { onDraftChange(draft); }, [draft, onDraftChange]);

  // Excel keys: Enter saves and moves down, Tab saves and moves right, Alt+Enter = line break, Esc cancels
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter' && e.altKey && !isDate) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = e.target;
      setDraft((d) => `${d.slice(0, s)}\n${d.slice(end)}`);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); onCommit(draft, e.shiftKey ? 'up' : 'down'); }
    if (e.key === 'Tab') { e.preventDefault(); onCommit(draft, e.shiftKey ? 'left' : 'right'); }
  };

  if (isDate) {
    return (
      <input
        ref={ref}
        type="month"
        className="xl-editor xl-editor--date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onCommit(draft, null)}
      />
    );
  }
  return (
    <textarea
      ref={ref}
      className="xl-editor"
      style={{ minHeight }}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(draft, null)}
    />
  );
}

/**
 * Excel-like sheet: formatting from the workbook (widths, heights, fills, fonts), column letters
 * and row numbers, a Name box + formula bar, keyboard navigation, in-cell editing, sheet tabs and
 * a status bar. `onSaveCell` writes an edit to the Excel file and returns { text, identity }.
 * Carried-down values (grey italics) and formula cells are read-only.
 */
// Clipboard text as Excel puts it there: rows on new lines, cells separated by tabs, and cells that
// contain tabs, line breaks or quotes wrapped in "…" (with "" for a quote)
function parseClipboard(text) {
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}
// Does a conditional formatting rule (from the Excel file) apply to this value? Text rules ignore case,
// like Excel's SEARCH; number comparisons need both sides to be numbers.
function ruleMatches(rule, value) {
  const v = String(value ?? '');
  const lower = v.toLowerCase();
  const t = String(rule.value).toLowerCase();
  const num = (x) => (x !== '' && !Number.isNaN(Number(x)) ? Number(x) : null);
  const [a, b] = [num(v), num(rule.value)];
  switch (rule.type) {
    case 'contains': return t !== '' && lower.includes(t);
    case 'notContains': return !lower.includes(t);
    case 'beginsWith': return lower.startsWith(t);
    case 'endsWith': return lower.endsWith(t);
    case 'equal': return a !== null && b !== null ? a === b : lower === t;
    case 'notEqual': return a !== null && b !== null ? a !== b : lower !== t;
    case 'greaterThan': return a !== null && b !== null && a > b;
    case 'lessThan': return a !== null && b !== null && a < b;
    case 'greaterThanOrEqual': return a !== null && b !== null && a >= b;
    case 'lessThanOrEqual': return a !== null && b !== null && a <= b;
    default: return false;
  }
}

const clipboardCell = (v) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export default function SheetGrid({
  grid, onSaveCell, onFormatCell, onMergeCells, onHideRows, onColumns, onColumnWidths, onRowHeights, onPasteCells, excelLinkFor, sheets = [], onSheetChange,
}) {
  const format = grid.format;
  const [zoomPct, setZoomPct] = useState(() => readZoom(format?.zoom || 100));
  const zoom = zoomPct / 100;
  // allRows: every row the user may see; rows: minus the ones they hid in their own view
  const [allRows, setRows] = useState(grid.rows);
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set(grid.hiddenKeys || []));
  const rows = useMemo(() => allRows.filter((x) => !hiddenKeys.has(x.key)), [allRows, hiddenKeys]);
  const [rowMenu, setRowMenu] = useState(null); // { x, y, keys } for the row-number right-click menu
  const [colMenu, setColMenu] = useState(null); // { x, y, c } for the column-letter right-click menu
  const [columnBusy, setColumnBusy] = useState(''); // message on the loader shown while a column change or paste runs
  const [copied, setCopied] = useState(null); // { r1, r2, c1, c2 }: copied cells, shown with a dashed border
  const [cellMenu, setCellMenu] = useState(null); // { x, y } for the right-click menu on cells
  // Sizes changed since the grid was loaded, in px at 100% zoom: column widths by column key, row
  // heights by sheet row number. Dragging an edge shows them at once; they're saved to the Excel file
  // when the mouse is released (onColumnWidths / onRowHeights)
  const [colWidths, setColWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const resizing = useRef(null); // set while a column or row edge is dragged
  // Dragging a column letter onto another moves the column in the Excel file: { from, to, side }
  const [drag, setDrag] = useState(null);
  const [listOpen, setListOpen] = useState(false); // the selected cell's dropdown list (Excel data validation) is open
  // Local copy of the workbook's style table; formatting done here adds styles to it
  const [styles, setStyles] = useState(format?.styles || []);
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [editing, setEditing] = useState(null); // { initial }
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(null);
  const [errors, setErrors] = useState({});
  const [status, setStatusState] = useState({ text: '', error: false });
  const setStatus = (text, error = false) => setStatusState({ text, error });
  const scrollRef = useRef(null);
  const containerRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false); // real browser fullscreen
  const [expanded, setExpanded] = useState(false); // fallback: fill the browser window

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (expanded) {
      setExpanded(false);
    } else {
      try {
        await containerRef.current.requestFullscreen();
      } catch {
        setExpanded(true); // Fullscreen API blocked or unsupported
      }
    }
    scrollRef.current?.focus();
  }

  useEffect(() => {
    setRows(grid.rows);
    setHiddenKeys(new Set(grid.hiddenKeys || []));
    setColWidths({});
    setRowHeights({});
    setCopied(null);
    setRowMenu(null);
    setHistory({ undo: [], redo: [] });
    setStyles(grid.format?.styles || []);
    setSel({ r: 0, c: 0 });
    setAnchor(null);
    setEditing(null);
    setErrors({});
    setStatusState({ text: '', error: false });
  }, [grid]);

  useEffect(() => {
    try { localStorage.setItem(ZOOM_KEY, String(zoomPct)); } catch { /* storage unavailable */ }
  }, [zoomPct]);

  // Columns in the Excel file's order (columns can't be moved here: Microsoft Graph can't move a
  // column in the file, so the grid always matches it). Columns hidden in the workbook stay hidden.
  // Each column has a key (its header text, numbered when headers repeat) for personal column widths.
  const cols = useMemo(() => {
    const seen = new Map();
    return grid.headers.map((h, i) => {
      const base = h.header || h.label || `#${h.letter}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { ...h, index: i, key: n > 1 ? `${base}#${n}` : base };
    }).filter((h) => !format?.columns[h.index]?.hidden);
  }, [grid.headers, format]);
  const style = (index) => (index === null || index === undefined ? null : styles[index]);

  // ---- Excel's conditional formatting and dropdown lists (from the file, by grid column) ----
  const covers = (a, rowNumber, i) => a.top <= rowNumber && a.bottom >= rowNumber && a.c1 <= i && a.c2 >= i;
  // The cell's look: its own style, with the first matching conditional formatting rule on top
  const cellStyle = (row, i) => {
    const base = style(row.styles?.[i]);
    for (const cf of format?.conditional || []) {
      if (!cf.areas.some((a) => covers(a, row.row, i))) continue;
      const rule = cf.rules.find((r) => ruleMatches(r, row.cells[i]));
      if (rule) {
        return {
          ...(base || {}),
          ...(rule.style.bg && { bg: rule.style.bg }),
          ...(rule.style.color && { color: rule.style.color }),
          ...(rule.style.bold !== undefined && { bold: rule.style.bold }),
          ...(rule.style.italic !== undefined && { italic: rule.style.italic }),
        };
      }
    }
    return base;
  };
  const dropdownAt = (row, i) => (row ? (format?.dropdowns || []).find((d) => d.areas.some((a) => covers(a, row.row, i))) || null : null);
  // A strict list (Excel's "Stop" alert) refuses other values; returns the list's spelling, or null when refused
  const listValue = (dd, value) => {
    const text = String(value ?? '').trim();
    if (!dd?.strict || !text) return value;
    return dd.list.find((item) => item.toLowerCase() === text.toLowerCase()) ?? null;
  };
  // Width in pixels as Excel shows it: the file's width times the pixels per width unit measured from
  // Excel (format.pxPerChar), or Excel's usual 7 px per character + padding when it isn't known
  const fileWidthOf = (i) => {
    const chars = format?.columns[i]?.width ?? format?.defaultColWidth;
    return format?.pxPerChar ? Math.round((chars ?? DEFAULT_WIDTH_CHARS) * format.pxPerChar) : colPx(chars);
  };
  const baseWidthOf = (h) => colWidths[h.key] ?? fileWidthOf(h.index);
  const widthOf = (h) => baseWidthOf(h) * zoom;
  const baseHeightOf = (row) => rowHeights[row.row] ?? ptPx(row.height || format?.defaultRowHeight || DEFAULT_HEIGHT_PT);
  const rowHeightOf = (row) => baseHeightOf(row) * zoom;

  // ---- Resizing, like Excel: drag the right edge of a column letter or the bottom edge of a row
  // number; double-click it to fit the content. When several whole columns (rows) are selected and
  // the edge of one of them is dragged, they all get that size. Saved to the Excel file. ----
  const resizeTargets = (kind, index) => {
    if (kind === 'col') {
      const whole = isRange && range.r1 === 0 && range.r2 === rows.length - 1;
      return whole && index >= range.c1 && index <= range.c2 ? cols.slice(range.c1, range.c2 + 1) : [cols[index]];
    }
    const whole = isRange && range.c1 === 0 && range.c2 === cols.length - 1;
    return whole && index >= range.r1 && index <= range.r2 ? rows.slice(range.r1, range.r2 + 1) : [rows[index]];
  };

  async function saveSizes(kind, targets, request, before) {
    const isCol = kind === 'col';
    const save = isCol ? onColumnWidths : onRowHeights;
    if (!save) return; // e.g. the Summary: the size only applies on screen
    let what;
    if (isCol) what = targets.length > 1 ? `columns ${targets[0].letter}:${targets[targets.length - 1].letter}` : `column ${targets[0].letter}`;
    else what = targets.length > 1 ? `${targets.length} rows` : `row ${targets[0].row}`;
    const set = isCol ? setColWidths : setRowHeights;
    const keyOf = (t) => (isCol ? t.key : t.row);
    setStatus(request.autofit ? `Fitting ${what} to the content…` : `Saving the size of ${what}…`);
    try {
      const saved = isCol
        ? (await save({ columns: targets.map((t) => t.letter), ...request })).widths
        : (await save({ rows: targets.map((t) => t.row), ...request })).heights;
      set((m) => {
        const next = { ...m };
        targets.forEach((t) => { const v = saved?.[isCol ? t.letter : t.row]; if (v) next[keyOf(t)] = v; });
        return next;
      });
      setStatus(`Size of ${what} saved to the Excel file`);
    } catch (err) {
      set((m) => {
        const next = { ...m };
        targets.forEach((t, i) => { if (before[i] === undefined) delete next[keyOf(t)]; else next[keyOf(t)] = before[i]; });
        return next;
      });
      setStatus(`Couldn't change the size of ${what}: ${err.message}`, true);
    }
  }

  function startResize(e, kind, index) {
    e.preventDefault();
    e.stopPropagation();
    // A column letter can also be dragged to move the column: switch that off while resizing, or the
    // browser starts moving the column instead of resizing it
    const cell = e.currentTarget.parentElement;
    const wasDraggable = cell.draggable;
    cell.draggable = false;
    const isCol = kind === 'col';
    const targets = resizeTargets(kind, index);
    const own = isCol ? cols[index] : rows[index];
    const set = isCol ? setColWidths : setRowHeights;
    const keyOf = (t) => (isCol ? t.key : t.row);
    const before = targets.map((t) => (isCol ? colWidths[t.key] : rowHeights[t.row]));
    const start = isCol ? baseWidthOf(own) : baseHeightOf(own);
    const startAt = isCol ? e.clientX : e.clientY;
    resizing.current = { size: start };
    document.body.classList.add(isCol ? 'xl-resizing' : 'xl-resizing-row');
    const onMove = (ev) => {
      const r = resizing.current;
      if (!r) return;
      r.size = Math.max(isCol ? MIN_COL_PX : MIN_ROW_PX, Math.round(start + ((isCol ? ev.clientX : ev.clientY) - startAt) / zoom));
      set((m) => {
        if (targets.every((t) => m[keyOf(t)] === r.size)) return m;
        const next = { ...m };
        targets.forEach((t) => { next[keyOf(t)] = r.size; });
        return next;
      });
    };
    const onUp = () => {
      const r = resizing.current;
      resizing.current = null;
      cell.draggable = wasDraggable;
      document.body.classList.remove('xl-resizing', 'xl-resizing-row');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (r && Math.abs(r.size - start) >= 2) saveSizes(kind, targets, isCol ? { width: r.size } : { height: r.size }, before);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function autofit(e, kind, index) {
    e.preventDefault();
    e.stopPropagation();
    const targets = resizeTargets(kind, index);
    const before = targets.map((t) => (kind === 'col' ? colWidths[t.key] : rowHeights[t.row]));
    saveSizes(kind, targets, { autofit: true }, before);
  }

  // The corner box selects the whole sheet (as in Excel), e.g. to resize every column or row at once
  function selectAll() {
    if (editing || !rows.length || !cols.length) return;
    keepScroll.current = true;
    setAnchor({ r: rows.length - 1, c: cols.length - 1 });
    setSel({ r: 0, c: 0 });
    scrollRef.current?.focus({ preventScroll: true });
  }
  const headerHeight = ptPx(format?.headerHeight || 30) * zoom;

  // Merged areas as grid positions { r0, c0, r1, c1 }. row.merges ({ col, span, rows }) is on the
  // area's top row; an area only spans down over rows shown consecutively (filters can hide some).
  const mergeLayout = useMemo(() => {
    const cover = new Map(); // "r-c" -> area, for every cell inside an area
    rows.forEach((row, r) => {
      for (const m of row.merges || []) {
        const inside = cols.map((h, c) => ({ h, c })).filter(({ h }) => h.index >= m.col && h.index < m.col + m.span).map((x) => x.c).sort((a, b) => a - b);
        if (!inside.length) continue;
        let r1 = r;
        while (r1 + 1 < rows.length && rows[r1 + 1].row === rows[r1].row + 1 && rows[r1 + 1].row < row.row + (m.rows || 1)) r1++;
        // With a personal column order the area's columns may no longer sit side by side: each run of
        // adjacent columns is drawn as its own area
        const runs = [];
        inside.forEach((cc) => { if (runs.length && cc === runs.at(-1).at(-1) + 1) runs.at(-1).push(cc); else runs.push([cc]); });
        for (const run of runs) {
          const area = { r0: r, c0: run[0], r1, c1: run.at(-1) };
          for (let rr = area.r0; rr <= area.r1; rr++) {
            for (let cc = area.c0; cc <= area.c1; cc++) cover.set(`${rr}-${cc}`, area);
          }
        }
      }
    });
    return cover;
  }, [rows, cols]);
  const mergeAt = (r, c) => mergeLayout.get(`${r}-${c}`) || null;
  // A position inside a merged area means its top-left cell
  const snap = (r, c) => {
    const area = mergeAt(r, c);
    return area ? { r: area.r0, c: area.c0 } : { r, c };
  };

  const current = rows[sel.r];
  const currentCol = cols[sel.c];
  const cellKey = (row, i) => `${row}:${i}`;
  // row.editable is false on rows another department leads (shown to view-all users like EXECOM)
  const isReadOnly = (row, i) => !grid.editable || !onSaveCell || row.editable === false
    || row.inherited.includes(i) || row.formulas.includes(i);
  const notYourRow = (row) => row.editable === false;
  // The server refused a change (403): the whole row is read-only for this user now,
  // e.g. an admin made it "View only" while the page was open
  const markRowReadOnly = (rowNumber) => setRows((all) => all.map((x) => (x.row === rowNumber ? { ...x, editable: false } : x)));

  // Range selected with Shift+click / Shift+arrows: from `anchor` to `sel`
  const [anchor, setAnchor] = useState(null);
  const range = anchor && {
    r1: Math.min(anchor.r, sel.r), r2: Math.max(anchor.r, mergeAt(sel.r, sel.c)?.r1 ?? sel.r),
    c1: Math.min(anchor.c, sel.c), c2: Math.max(anchor.c, mergeAt(sel.r, sel.c)?.c1 ?? sel.c),
  };
  const isRange = !!range && (range.r1 !== range.r2 || range.c1 !== range.c2);
  const inRange = (r, c) => isRange && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
  const address = !current || !currentCol ? ''
    : isRange ? `${cols[range.c1].letter}${rows[range.r1].row}:${cols[range.c2].letter}${rows[range.r2].row}`
      : `${currentCol.letter}${current.row}`;

  // Like Excel: a row number selects the whole row, a column letter the whole column; with Shift
  // the selection grows from where it started. (The grid shows only the rows in the Lead filter.)
  // The active cell is the first cell of the clicked row / column (its left / top end), and the
  // sheet doesn't scroll, as in Excel (`keepScroll` skips the keep-selection-visible scroll once)
  const keepScroll = useRef(false);

  function selectRows(r, extend) {
    if (editing) return;
    const startRow = extend && anchor ? anchor.r : extend ? sel.r : r;
    keepScroll.current = true;
    setAnchor({ r: startRow, c: cols.length - 1 });
    setSel({ r, c: 0 });
    scrollRef.current?.focus({ preventScroll: true });
  }

  function selectColumns(c, extend) {
    if (editing) return;
    const startCol = extend && anchor ? anchor.c : extend ? sel.c : c;
    keepScroll.current = true;
    setAnchor({ r: rows.length - 1, c: startCol });
    setSel({ r: 0, c });
    scrollRef.current?.focus({ preventScroll: true });
  }

  // ---- Hide rows (personal view setting, saved per user; the Excel file isn't changed) ----

  // Keys of the hidden rows directly above each shown row, and after the last one
  const hiddenGaps = useMemo(() => {
    const before = new Map();
    let pending = [];
    for (const x of allRows) {
      if (hiddenKeys.has(x.key)) pending.push(x.key);
      else if (pending.length) { before.set(x.key, pending); pending = []; }
    }
    return { before, after: pending };
  }, [allRows, hiddenKeys]);

  const selectedRowKeys = () => {
    const [from, to] = isRange ? [range.r1, range.r2] : [sel.r, sel.r];
    return rows.slice(from, to + 1).map((x) => x.key);
  };

  async function setRowsHidden(keys, hidden, { all = false } = {}) {
    if (!onHideRows || (!keys.length && !all)) return;
    const previous = hiddenKeys;
    const next = new Set(all && !hidden ? [] : previous);
    keys.forEach((k) => (hidden ? next.add(k) : next.delete(k)));
    setHiddenKeys(next); // show the change right away, then save it
    setRowMenu(null);
    setAnchor(null);
    setSel((s) => ({ r: Math.max(0, Math.min(s.r, allRows.filter((x) => !next.has(x.key)).length - 1)), c: s.c }));
    const count = all ? previous.size : keys.length;
    setStatus(`${hidden ? 'Hid' : 'Unhid'} ${count} row${count === 1 ? '' : 's'} in your view`);
    try {
      const saved = await onHideRows({ keys, hidden, all });
      setHiddenKeys(new Set(saved));
    } catch (err) {
      setHiddenKeys(previous);
      setStatus(`Couldn't save hidden rows: ${err.message}`, true);
    }
    scrollRef.current?.focus();
  }

  // Right-click on a row number: act on the selected rows if it's one of them, else on that row
  function openRowMenu(e, r) {
    if (!onHideRows) return;
    e.preventDefault();
    const inSelection = isRange ? r >= range.r1 && r <= range.r2 : r === sel.r;
    if (!inSelection) { setAnchor(null); setSel({ r, c: 0 }); }
    const keys = inSelection ? selectedRowKeys() : [rows[r].key];
    const box = containerRef.current.getBoundingClientRect();
    setRowMenu({ x: e.clientX - box.left, y: e.clientY - box.top, keys });
  }

  useEffect(() => {
    if (!rowMenu && !colMenu && !cellMenu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.xl-context')) { setRowMenu(null); setColMenu(null); setCellMenu(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [rowMenu, colMenu, cellMenu]);

  // ---- Copy / paste (Ctrl+C / Ctrl+V), like Excel: values only, as tab-separated text, so they also
  // go to and from Excel itself. Pasting writes the values into the Excel file. ----

  const selectionBounds = () => (isRange ? { ...range } : { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c });
  const closeMenus = () => { setCellMenu(null); setColMenu(null); setRowMenu(null); };

  async function copySelection() {
    closeMenus();
    const b = selectionBounds();
    // Carried-down values (grey) are empty cells in Excel, so they are copied as empty
    const text = rows.slice(b.r1, b.r2 + 1)
      .map((row) => cols.slice(b.c1, b.c2 + 1).map((h) => clipboardCell(row.inherited.includes(h.index) ? '' : row.cells[h.index] || '')).join('\t'))
      .join('\r\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(b);
      const n = (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1);
      setStatus(`Copied ${n} cell${n === 1 ? '' : 's'}. Select where to paste and press Ctrl+V (Esc clears the copy).`);
    } catch {
      setStatus("Couldn't copy: the browser blocked access to the clipboard.", true);
    }
    scrollRef.current?.focus({ preventScroll: true });
  }

  // Writes a list of { r, c, value } (grid positions) to Excel in one paste; returns false when nothing was written
  async function runPaste(list, { record = true, verb = 'Paste' } = {}) {
    if (!onPasteCells) return false;
    const blockedCells = list.filter(({ r, c }) => isReadOnly(rows[r], cols[c].index));
    if (blockedCells.length) {
      const b = blockedCells[0];
      setStatus(`Nothing was pasted: ${cols[b.c].letter}${rows[b.r].row}${blockedCells.length > 1 ? ` and ${blockedCells.length - 1} more cell(s)` : ''} can't be edited (a formula, a value carried down from above, or a row you can't edit).`, true);
      return false;
    }
    const changes = list.filter(({ r, c, value }) => (rows[r].cells[cols[c].index] || '') !== value);
    if (!changes.length) { setStatus('Nothing to change: the cells already have those values.'); return false; }
    if (record && changes.length > 50 && !(await confirmDialog({
      title: `Paste ${changes.length} cells into the Excel file?`,
      text: 'The values are written to the Excel file right away. You can undo the paste with Ctrl+Z.',
      confirmText: 'Paste',
    }))) return false;

    const byRow = new Map();
    for (const ch of changes) {
      const row = rows[ch.r];
      const col = cols[ch.c];
      if (!byRow.has(row.row)) byRow.set(row.row, { row: row.row, identity: row.identity, cells: [] });
      byRow.get(row.row).cells.push({ column: col.letter, value: ch.value, previous: row.cells[col.index] || '' });
    }
    const n = changes.length;
    const label = `${n} cell${n === 1 ? '' : 's'}`;
    setSaving('paste');
    setColumnBusy(`${verb === 'Paste' ? 'Pasting' : verb === 'Undo' ? 'Undoing the paste of' : 'Redoing the paste of'} ${label}…`);
    try {
      const result = await onPasteCells({ targets: [...byRow.values()] });
      const letterIndex = new Map(grid.headers.map((h, i) => [h.letter, i]));
      setRows((all) => all.map((x) => {
        const updates = result.cells.filter((u) => u.row === x.row);
        if (!updates.length) return x;
        const cells = [...x.cells];
        updates.forEach((u) => { if (letterIndex.has(u.column)) cells[letterIndex.get(u.column)] = u.text; });
        return { ...x, cells, identity: result.identities[x.row] || x.identity };
      }));
      if (record) {
        remember({
          kind: 'paste',
          cells: changes.map((ch) => {
            const row = rows[ch.r];
            const col = cols[ch.c];
            const saved = result.cells.find((u) => u.row === row.row && u.column === col.letter);
            return { rowNumber: row.row, col: col.index, before: row.cells[col.index] || '', after: saved ? saved.text : ch.value };
          }),
        });
      }
      setStatus(`${verb === 'Paste' ? 'Pasted' : verb === 'Undo' ? 'Undid the paste of' : 'Redid the paste of'} ${label} in Excel`);
      return true;
    } catch (err) {
      setStatus(err.message, true);
      return false;
    } finally {
      setSaving(null);
      setColumnBusy('');
      scrollRef.current?.focus({ preventScroll: true });
    }
  }

  // Pastes clipboard text at the selection: one value fills the whole selected range, a block
  // starts at the selection's top-left cell (cells past the last row / column are left out)
  async function pasteText(text) {
    closeMenus();
    if (editing || saving) return;
    const data = parseClipboard(text);
    if (!data.length) { setStatus('The clipboard is empty.', true); return; }
    const b = selectionBounds();
    const list = [];
    let dropped = 0;
    const add = (r, c, value) => {
      const area = mergeAt(r, c);
      if (area && (area.r0 !== r || area.c0 !== c)) return; // inside a merged cell: only its top-left cell holds a value
      list.push({ r, c, value });
    };
    if (data.length === 1 && data[0].length === 1 && isRange) {
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) add(r, c, data[0][0]);
    } else {
      data.forEach((line, i) => line.forEach((value, j) => {
        const r = b.r1 + i;
        const c = b.c1 + j;
        if (r >= rows.length || c >= cols.length) dropped++; else add(r, c, value);
      }));
    }
    const ok = await runPaste(list);
    if (ok && dropped) setStatus(`Pasted. ${dropped} cell(s) past the last shown row or column were left out.`);
  }

  // Paste from a menu: reads the clipboard (the browser may ask for permission once)
  async function pasteFromMenu() {
    closeMenus();
    try {
      await pasteText(await navigator.clipboard.readText());
    } catch {
      setStatus('The browser blocked reading the clipboard. Press Ctrl+V to paste instead.', true);
    }
  }

  // Ctrl+V: the browser's paste event carries the clipboard text without asking for permission
  const pasteHandled = useRef(false);
  useEffect(() => {
    if (!onPasteCells) return undefined;
    const onPaste = (e) => {
      if (editing || !scrollRef.current?.contains(document.activeElement)) return;
      pasteHandled.current = true;
      e.preventDefault();
      pasteText(e.clipboardData?.getData('text/plain') || '');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  function openCellMenu(e) {
    if (editing) return;
    e.preventDefault();
    setRowMenu(null);
    setColMenu(null);
    const box = containerRef.current.getBoundingClientRect();
    setCellMenu({ x: e.clientX - box.left, y: e.clientY - box.top });
  }

  // ---- Columns (changes the Excel file for everyone: insert for all users, delete for admins) ----

  function openColMenu(e, c) {
    if (!onColumns || editing) return;
    e.preventDefault();
    selectColumns(c, false);
    setRowMenu(null);
    const box = containerRef.current.getBoundingClientRect();
    setColMenu({ x: e.clientX - box.left, y: e.clientY - box.top, c });
  }

  // Runs a column change; the page reloads the grid afterwards. The server may ask first (409 + code):
  //   CONFIRM_DELETE      deleting a column with values: how many cells would be lost
  //   CONFIRM_DROP_RULES  moving a column whose dropdown list / color rules can't move with it
  async function runColumns(request, busyText) {
    setSaving('columns');
    setStatus(busyText);
    setColumnBusy(busyText);
    try {
      try {
        await onColumns(request);
      } catch (err) {
        const question = {
          CONFIRM_DELETE: {
            title: `Delete “${err.header}” and its data?`,
            text: `${err.filled} cell(s) in this column have values, in every department's rows. They are deleted from the Excel file, and this can't be undone here (SharePoint's version history keeps older copies).`,
            confirmText: 'Delete column and data',
            tone: 'danger',
            cancelled: 'Delete cancelled',
          },
          CONFIRM_DROP_RULES: {
            title: `Move “${err.header}” without its ${(err.lost || []).join(' and ') || 'rules'}?`,
            text: `${err.message} Its values and formatting move as usual. Move it anyway?`,
            confirmText: 'Move anyway',
            tone: 'warning',
            cancelled: 'Move cancelled',
          },
        }[err.code];
        if (!question) throw err;
        setColumnBusy('');
        const ok = await confirmDialog(question);
        if (!ok) { setStatus(question.cancelled); return; }
        setColumnBusy(busyText);
        await onColumns({ ...request, confirm: true });
      }
    } catch (err) {
      setStatus(err.message, true);
      // A refused move explains why (key column, formulas, dropdowns…): show it, not only in the status bar
      if (request.action === 'move') {
        setColumnBusy('');
        await alertDialog({ title: 'The column was not moved', text: err.message });
      }
    } finally {
      setSaving(null);
      setColumnBusy('');
    }
  }

  async function insertColumn(side) {
    const h = cols[colMenu.c];
    setColMenu(null);
    const taken = grid.headers.map((x) => (x.header || x.label || '').toLowerCase());
    const header = await promptDialog({
      title: `Insert a column ${side} of ${h.letter}`,
      text: 'The column is added to the Excel file for every department. Everyone can then fill in its cells on the rows they may edit.',
      label: 'Header name',
      placeholder: 'e.g. Stage',
      confirmText: 'Insert column',
      validate: (v) => (taken.includes(v.toLowerCase()) ? `There is already a column named “${v}”.` : null),
    });
    if (header) await runColumns({ action: 'insert', column: h.letter, side, header, expectedHeader: h.header }, `Inserting “${header}” ${side} of ${h.letter}…`);
  }

  async function addUpdateColumn() {
    setColMenu(null);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    const ok = await confirmDialog({
      title: `Add an update column for ${today}?`,
      text: 'A new column dated today is added left of the latest update, for every department. Each department then types this week’s update on its own rows, and the Dashboard shows it as a new “Status as of” date.',
      confirmText: 'Add update column',
    });
    if (ok) await runColumns({ action: 'update' }, `Adding the ${today} update column…`);
  }

  // Drop of a dragged column letter: moves that column in the Excel file, next to the one dropped on
  async function dropColumn() {
    const d = drag;
    setDrag(null);
    if (!d || d.to === null || !onColumns || saving) return;
    const from = cols[d.from];
    const target = cols[d.to];
    if (!from || !target) return;
    // Dropping next to itself changes nothing
    if (d.from === d.to || (d.side === 'right' && d.to === d.from - 1) || (d.side === 'left' && d.to === d.from + 1)) return;
    const ok = await confirmDialog({
      title: `Move column ${from.letter} “${from.header || from.label}”?`,
      text: `It moves ${d.side} of column ${target.letter} “${target.header || target.label}” in the Excel file, for every department, `
        + 'with its values and formatting. The columns in between shift one place. This takes a few seconds.',
      confirmText: 'Move column',
    });
    if (!ok) return;
    await runColumns({
      action: 'move', column: from.letter, target: target.letter, side: d.side,
      expectedHeader: from.header, expectedTarget: target.header,
    }, `Moving column ${from.letter} ${d.side} of ${target.letter}…`);
  }

  function openInExcel(c) {
    setColMenu(null);
    const h = cols[c];
    const href = excelLinkFor?.(`${h.letter}${current?.row || 1}`);
    if (href) window.open(href, 'mcu-excel', 'noopener');
  }

  // Renames a column (admins): double-click its header, or the column menu
  async function renameColumn(c) {
    const h = cols[c];
    setColMenu(null);
    if (!h || !grid.canRenameColumns || !onColumns || saving) return;
    const taken = grid.headers.filter((x) => x.letter !== h.letter).map((x) => (x.header || x.label || '').toLowerCase());
    const header = await promptDialog({
      title: `Rename column ${h.letter}`,
      text: 'The new header is written into the Excel file for every department. For an update column, type a date such as 21-Sep-26 so it stays a week on the Dashboard.',
      label: 'Header name',
      value: h.header || h.label,
      confirmText: 'Rename',
      validate: (v) => (taken.includes(v.toLowerCase()) ? `There is already a column named “${v}”.` : v === (h.header || h.label) ? 'Type a different name.' : null),
    });
    if (header) await runColumns({ action: 'rename', column: h.letter, header, expectedHeader: h.header }, `Renaming column ${h.letter}…`);
  }

  async function deleteColumn() {
    const h = cols[colMenu.c];
    setColMenu(null);
    const ok = await confirmDialog({
      title: `Delete column ${h.letter} “${h.header || h.label}”?`,
      text: 'The whole column is removed from the Excel file for every department, and the columns to its right move one place left.',
      confirmText: 'Delete column',
      tone: 'danger',
    });
    if (ok) await runColumns({ action: 'delete', column: h.letter, expectedHeader: h.header }, `Deleting column ${h.letter}…`);
  }

  // Arrow keys step over merged areas; `extend` (Shift) grows the selected range instead
  function move(dr, dc, extend = false) {
    if (extend) setAnchor((a) => a || sel);
    else setAnchor(null);
    setSel((s) => {
      const area = mergeAt(s.r, s.c);
      let r = dr > 0 ? (area?.r1 ?? s.r) + dr : s.r + dr;
      let c = dc > 0 ? (area?.c1 ?? s.c) + dc : s.c + dc;
      r = Math.max(0, Math.min(rows.length - 1, r));
      c = Math.max(0, Math.min(cols.length - 1, c));
      return snap(r, c);
    });
  }

  useEffect(() => { setListOpen(false); }, [sel.r, sel.c]);

  // Keep the selected cell visible
  useEffect(() => {
    if (keepScroll.current) { keepScroll.current = false; return; }
    const el = scrollRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  // Is the selected cell's text cut off by the row height / column width? Then it pops out in full.
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const clip = scrollRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"] .xl-clip`);
    setClipped(!!clip && (clip.scrollHeight > clip.clientHeight + 1 || clip.scrollWidth > clip.clientWidth + 1));
  }, [sel, rows, zoom]);

  function startEdit(initialOverride) {
    if (!current || !currentCol) return;
    if (isReadOnly(current, currentCol.index)) {
      setStatus(current.formulas.includes(currentCol.index)
        ? `${address} is calculated by a formula and can't be edited here.`
        : current.inherited.includes(currentCol.index)
          ? `${address} is carried down from a row above. Edit it on the row where it starts.`
          : notYourRow(current)
            ? `${address} is read-only: your department doesn't lead row ${current.row}.`
            : `${address} is read-only.`, true);
      return;
    }
    const value = current.cells[currentCol.index];
    setEditing({ initial: initialOverride ?? value, original: value });
  }

  // ---- Saving, shared by editing and undo/redo ----

  // Writes a value to Excel and shows it; returns the text Excel now displays
  async function writeValue(row, col, value, previous) {
    const result = await onSaveCell({ row, col, value, previous });
    setRows((all) => all.map((x) => (x.row !== row.row ? x : {
      ...x,
      cells: x.cells.map((c, i) => (i === col ? result.text : c)),
      identity: result.identity,
    })));
    return result.text;
  }

  // Writes formatting to Excel and shows it
  async function writeFormat(row, col, changes) {
    const result = await onFormatCell({ row, col, format: changes });
    // Reuse an identical style if there is one, otherwise add the new style
    const styleKey = JSON.stringify(result.style);
    let index = styles.findIndex((st) => JSON.stringify(st) === styleKey);
    if (index === -1) {
      index = styles.length;
      setStyles((all) => [...all, result.style]);
    }
    setRows((all) => all.map((x) => (x.row !== row.row ? x : {
      ...x,
      styles: (x.styles || grid.headers.map(() => null)).map((st, i) => (i === col ? index : st)),
    })));
  }

  // ---- Undo / redo (Ctrl+Z / Ctrl+Y) of the edits and formatting made on this page ----
  // Entries: { kind: 'value', rowNumber, col, before, after } or { kind: 'format', rowNumber, col, changes, before }
  const [history, setHistory] = useState({ undo: [], redo: [] });
  const remember = (entry) => setHistory((h) => ({ undo: [...h.undo, entry].slice(-UNDO_LIMIT), redo: [] }));

  async function step(direction) {
    if (saving || editing) return;
    const entry = history[direction].at(-1);
    if (!entry) { setStatus(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo'); return; }
    if (entry.kind === 'paste') {
      const list = entry.cells.map((x) => ({
        r: rows.findIndex((row) => row.row === x.rowNumber),
        c: cols.findIndex((h) => h.index === x.col),
        value: direction === 'undo' ? x.before : x.after,
      }));
      if (list.some((x) => x.r < 0 || x.c < 0)) {
        setStatus(`Some pasted cells are no longer shown, so the paste can't be ${direction === 'undo' ? 'undone' : 'redone'}.`, true);
        return;
      }
      if (await runPaste(list, { record: false, verb: direction === 'undo' ? 'Undo' : 'Redo' })) {
        setHistory((h) => (direction === 'undo'
          ? { undo: h.undo.slice(0, -1), redo: [...h.redo, entry] }
          : { undo: [...h.undo, entry], redo: h.redo.slice(0, -1) }));
      }
      return;
    }
    const row = allRows.find((x) => x.row === entry.rowNumber);
    const cellAddress = `${grid.headers[entry.col].letter}${entry.rowNumber}`;
    if (!row) { setStatus(`${cellAddress} is no longer shown, so it can't be ${direction === 'undo' ? 'undone' : 'redone'}.`, true); return; }

    const key = cellKey(row.row, entry.col);
    setSaving(key);
    setStatus(`${direction === 'undo' ? 'Undoing' : 'Redoing'} ${cellAddress}…`);
    try {
      if (entry.kind === 'value') {
        const target = direction === 'undo' ? entry.before : entry.after;
        // Date columns are saved from "2026-08"; "Aug-26" text would be read differently by Excel
        const value = grid.dateColumns.includes(entry.col) ? (toMonthInput(target) || target) : target;
        // The server checks the cell still shows what we show, so others' changes are never overwritten
        await writeValue(row, entry.col, value, row.cells[entry.col]);
      } else {
        await writeFormat(row, entry.col, direction === 'undo' ? inverseFormat(entry.changes, entry.before) : entry.changes);
      }
      setHistory((h) => (direction === 'undo'
        ? { undo: h.undo.slice(0, -1), redo: [...h.redo, entry] }
        : { undo: [...h.undo, entry], redo: h.redo.slice(0, -1) }));
      const r = rows.findIndex((x) => x.row === entry.rowNumber);
      const c = cols.findIndex((h) => h.index === entry.col);
      if (r >= 0 && c >= 0) { setAnchor(null); setSel(snap(r, c)); }
      setStatus(`${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.kind === 'value' ? 'edit' : 'formatting'} of ${cellAddress} in Excel`);
    } catch (err) {
      setStatus(`${cellAddress}: ${err.message}`, true);
      if (err.status === 403) markRowReadOnly(row.row);
    } finally {
      setSaving(null);
      scrollRef.current?.focus();
    }
  }

  // Each edit is committed once: Enter / Tab commits and moves focus back to the sheet, which blurs
  // the editor, and the editor's blur would commit the same edit again (a second write to Excel)
  const committed = useRef(null);
  async function commit(value, direction) {
    const edit = editing;
    if (!edit || committed.current === edit) return;
    committed.current = edit;
    setEditing(null);
    const moves = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] };
    if (direction) move(...moves[direction]);
    scrollRef.current?.focus();
    if (!edit || !current || !currentCol) return;

    const col = currentCol.index;
    const previous = edit.original;
    const isDate = grid.dateColumns.includes(col);
    if (value === previous || (isDate && value === toMonthInput(previous))) return;
    const dd = dropdownAt(current, col);
    const allowed = listValue(dd, value);
    if (allowed === null) {
      setStatus(`${currentCol.letter}${current.row} only accepts a value from its list: ${dd.list.join(', ')}. Use the ▾ button (or Alt+↓) to choose one.`, true);
      return;
    }
    await saveValue(current, col, allowed, previous);
  }

  // Saves one cell's value (typed, or chosen from a dropdown list), with undo and error display
  async function saveValue(row, col, value, previous) {
    const colInfo = cols.find((h) => h.index === col);
    const key = cellKey(row.row, col);
    const cellAddress = `${colInfo?.letter || grid.headers[col].letter}${row.row}`;
    setSaving(key);
    setStatus(`Saving ${cellAddress}…`);
    setErrors((e) => ({ ...e, [key]: undefined }));
    try {
      const text = await writeValue(row, col, value, previous);
      remember({ kind: 'value', rowNumber: row.row, col, before: previous, after: text });
      setStatus(`Saved ${cellAddress} to Excel`);
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: err.message }));
      setStatus(`${cellAddress}: ${err.message}`, true);
      if (err.status === 403) markRowReadOnly(row.row);
    } finally {
      setSaving(null);
    }
  }

  // Formatting is allowed where editing is, formula cells included (only their value is protected)
  const canFormat = (row, i) => grid.editable && !!onFormatCell && row.editable !== false && !row.inherited.includes(i);
  const selectedFormattable = !!current && !!currentCol && canFormat(current, currentCol.index);

  async function applyFormat(changes) {
    if (!current || !currentCol || saving) return;
    if (!selectedFormattable) {
      setStatus(current.inherited.includes(currentCol.index)
        ? `${address} is carried down from a row above. Format it on the row where it starts.`
        : notYourRow(current)
          ? `${address} is read-only: your department doesn't lead row ${current.row}.`
          : `${address} can't be formatted.`, true);
      return;
    }
    const row = current;
    const col = currentCol.index;
    const key = cellKey(row.row, col);
    const cellAddress = `${currentCol.letter}${row.row}`;
    setSaving(key);
    setStatus(`Formatting ${cellAddress}…`);
    const before = style(row.styles?.[col]);
    try {
      await writeFormat(row, col, changes);
      remember({ kind: 'format', rowNumber: row.row, col, changes, before });
      setStatus(`Formatted ${cellAddress} in Excel`);
    } catch (err) {
      setStatus(`${cellAddress}: ${err.message}`, true);
      if (err.status === 403) markRowReadOnly(row.row);
    } finally {
      setSaving(null);
      scrollRef.current?.focus();
    }
  }

  const selectedStyle = current && currentCol ? style(current.styles?.[currentCol.index]) : null;

  // Merge: the selected range. Unmerge: a merged cell selected on its own. Like Excel, the button
  // is always available; `problem` explains why an action can't run on the current selection.
  const selectedMerge = !isRange ? mergeAt(sel.r, sel.c) : null;
  const mergeState = (() => {
    const busy = !!saving || !!editing;
    if (!onMergeCells || !current || !currentCol) return { available: false };
    if (selectedMerge) {
      return { available: true, busy, canMerge: false, canUnmerge: selectedFormattable, problem: selectedFormattable ? null : `${address} can't be changed by you.` };
    }
    if (!isRange) {
      return { available: true, busy, canMerge: false, canUnmerge: false, problem: 'Select two or more cells first: Shift+click, or hold Shift and use the arrow keys.' };
    }
    const selectedRows = rows.slice(range.r1, range.r2 + 1);
    const gap = selectedRows.findIndex((x, i) => i > 0 && x.row !== selectedRows[i - 1].row + 1);
    if (gap > 0) {
      return {
        available: true, busy, canMerge: false, canUnmerge: false,
        problem: `Rows ${selectedRows[gap - 1].row} and ${selectedRows[gap].row} aren't next to each other in the sheet (rows in between are hidden by the Lead filter), so they can't be merged.`,
      };
    }
    const locked = selectedRows.find((x) => x.editable === false);
    if (locked) return { available: true, busy, canMerge: false, canUnmerge: false, problem: `Row ${locked.row} is led by another department.` };
    const ok = canFormat(rows[range.r1], cols[range.c1].index);
    return { available: true, busy, canMerge: ok, canUnmerge: false, problem: ok ? null : `${cols[range.c1].letter}${rows[range.r1].row} can't be changed by you.` };
  })();

  async function mergeCells({ merge, center = false }) {
    if (merge ? !mergeState.canMerge : !mergeState.canUnmerge) {
      setStatus(mergeState.problem || (merge ? 'Select two or more cells to merge.' : 'Select a merged cell to unmerge.'), true);
      return;
    }
    const area = isRange ? range : { r1: selectedMerge.r0, r2: selectedMerge.r1, c1: selectedMerge.c0, c2: selectedMerge.c1 };
    const row = rows[area.r1];
    const lastRow = rows[area.r2];
    const startIdx = cols[area.c1].index;
    const endIdx = cols[area.c2].index;
    const span = `${cols[area.c1].letter}${row.row}:${cols[area.c2].letter}${lastRow.row}`;
    const request = {
      row,
      endRow: lastRow.row,
      identities: rows.slice(area.r1, area.r2 + 1).map((x) => x.identity),
      startCol: startIdx,
      endCol: endIdx,
      merge,
      center,
    };
    const startC = area.c1;

    setSaving(cellKey(row.row, startIdx));
    setStatus(`${merge ? 'Merging' : 'Unmerging'} ${span}…`);
    try {
      let result;
      try {
        result = await onMergeCells({ ...request, confirm: false });
      } catch (err) {
        if (err.code !== 'CONFIRM_MERGE') throw err;
        const ok = await confirmDialog({
          title: 'Merge anyway?',
          text: `Merging keeps only the value in ${cols[startC].letter}${row.row}. These values will be deleted:`,
          items: err.lost.map((l) => `${l.cell} (${l.column}): ${l.value.length > 60 ? `${l.value.slice(0, 60)}…` : l.value}`),
          confirmText: 'Merge and delete',
          tone: 'danger',
        });
        if (!ok) {
          setStatus('Merge cancelled');
          return;
        }
        result = await onMergeCells({ ...request, confirm: true });
      }

      let styleIndex = null;
      if (result.style) {
        const styleKey = JSON.stringify(result.style);
        styleIndex = styles.findIndex((st) => JSON.stringify(st) === styleKey);
        if (styleIndex === -1) {
          styleIndex = styles.length;
          setStyles((all) => [...all, result.style]);
        }
      }
      const endRowNumber = result.endRow ?? lastRow.row;
      setRows((all) => all.map((x) => {
        if (x.row < row.row || x.row > endRowNumber) return x;
        const isTop = x.row === row.row;
        // Merged areas inside the range are replaced by the new one (or removed when unmerging)
        const others = (x.merges || []).filter((m) => m.col + m.span - 1 < startIdx || m.col > endIdx);
        return {
          ...x,
          merges: merge && isTop ? [...others, { col: startIdx, span: endIdx - startIdx + 1, rows: endRowNumber - row.row + 1 }] : others,
          // Merging empties every cell except the top-left one
          cells: merge ? x.cells.map((v, i) => (i >= startIdx && i <= endIdx && !(isTop && i === startIdx) ? '' : v)) : x.cells,
          styles: styleIndex === null || !isTop ? x.styles
            : (x.styles || grid.headers.map(() => null)).map((st, i) => (i === startIdx ? styleIndex : st)),
        };
      }));
      setAnchor(null);
      setSel({ r: area.r1, c: startC });
      // A merge changes several cells at once, so earlier steps can't be safely undone after it
      setHistory({ undo: [], redo: [] });
      setStatus(`${merge ? 'Merged' : 'Unmerged'} ${span} in Excel`);
    } catch (err) {
      setStatus(`${span}: ${err.message}`, true);
    } finally {
      setSaving(null);
      scrollRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (editing) return;
    if (e.key === 'Escape' && copied) { e.preventDefault(); setCopied(null); setStatus(''); return; }
    if (e.key === 'Escape' && expanded) { e.preventDefault(); setExpanded(false); return; }
    // Excel shortcuts: Ctrl+C copies the selection, Ctrl+V pastes (the paste event normally carries the
    // text; if the browser didn't send one, the clipboard is read instead)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'v' && onPasteCells) {
      pasteHandled.current = false;
      setTimeout(() => { if (!pasteHandled.current) pasteFromMenu(); }, 80);
      return;
    }
    // Excel shortcuts: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
    if ((e.ctrlKey || e.metaKey) && (onSaveCell || onFormatCell)) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); step('undo'); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); step('redo'); return; }
    }
    // Excel shortcuts: Ctrl+9 hides the selected rows, Ctrl+Shift+9 unhides rows next to them
    if ((e.ctrlKey || e.metaKey) && e.code === 'Digit9' && onHideRows) {
      e.preventDefault();
      if (!e.shiftKey) {
        setRowsHidden(selectedRowKeys(), true);
      } else {
        const [from, to] = isRange ? [range.r1, range.r2] : [sel.r, sel.r];
        const near = rows.slice(from, to + 2).flatMap((x) => hiddenGaps.before.get(x.key) || []);
        const tail = to >= rows.length - 1 ? hiddenGaps.after : [];
        setRowsHidden([...near, ...tail], false);
      }
      return;
    }
    // Excel shortcuts: Ctrl+B / Ctrl+I / Ctrl+U
    if ((e.ctrlKey || e.metaKey) && onFormatCell && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const prop = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
      applyFormat({ [prop]: !selectedStyle?.[prop] });
      return;
    }
    const keys = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      PageUp: [-10, 0], PageDown: [10, 0],
    };
    if (keys[e.key]) { e.preventDefault(); move(...keys[e.key], e.shiftKey); return; }
    if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return; }
    if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Home') { e.preventDefault(); setAnchor(null); setSel((s) => ({ r: e.ctrlKey ? 0 : s.r, c: 0 })); return; }
    if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      setAnchor(null);
      setSel(snap(rows.length - 1, cols.length - 1));
      return;
    }
    if (e.key === 'F2') { e.preventDefault(); startEdit(); return; }
    // Excel: Alt+Down opens the cell's dropdown list
    if (e.altKey && e.key === 'ArrowDown' && current && currentCol && dropdownAt(current, currentCol.index) && !isReadOnly(current, currentCol.index)) {
      e.preventDefault();
      setListOpen(true);
      return;
    }
    if (e.key === 'Escape' && listOpen) { e.preventDefault(); setListOpen(false); return; }
    // Delete/Backspace start editing an empty cell (Enter confirms), like typing over it
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); startEdit(''); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (currentCol && grid.dateColumns.includes(currentCol.index)) startEdit();
      else startEdit(e.key);
    }
  }

  const formulaText = editing ? draft : current && currentCol ? current.cells[currentCol.index] : '';
  const count = grid.totalRows > grid.rows.length
    ? `${grid.rows.length} of ${grid.totalRows} records found`
    : `${grid.rows.length} rows`;
  const filterSummary = grid.viewingDepartments.length
    ? `${count} (Lead contains ${grid.viewingDepartments.join(', ')})`
    : count;

  const isFull = fullscreen || expanded;

  // Column letters to highlight: the selected range, or the selected (possibly merged) cell
  const selCols = new Set();
  const [colFrom, colTo] = isRange ? [range.c1, range.c2] : [sel.c, mergeAt(sel.r, sel.c)?.c1 ?? sel.c];
  const [rowFrom, rowTo] = isRange ? [range.r1, range.r2] : [sel.r, mergeAt(sel.r, sel.c)?.r1 ?? sel.r];
  for (let c = colFrom; c <= colTo; c++) selCols.add(c);

  return (
    <div ref={containerRef} className={expanded ? 'xl xl--expanded' : 'xl'}>
      <SheetTopBar
        filterSummary={filterSummary}
        hiddenCount={onHideRows ? allRows.length - rows.length : 0}
        onUnhideAll={() => setRowsHidden([], false, { all: true })}
        zoomPct={zoomPct}
        setZoomPct={setZoomPct}
        isFull={isFull}
        toggleFullscreen={toggleFullscreen}
      />
      {columnBusy && (
        <div className="xl-busy" role="status" aria-live="polite">
          <div className="xl-busy__box">
            <span className="loader__spinner" aria-hidden="true" />
            <b>{columnBusy}</b>
            <small>Updating the Excel file for every department. This takes a few seconds; please wait.</small>
          </div>
        </div>
      )}
      {colMenu && (
        <div className="xl-context" role="menu" style={{ left: colMenu.x, top: colMenu.y }}>
          <button type="button" role="menuitem" onClick={copySelection}>Copy column {cols[colMenu.c]?.letter}<kbd>Ctrl+C</kbd></button>
          {onPasteCells && <button type="button" role="menuitem" disabled={!!saving} onClick={pasteFromMenu}>Paste<kbd>Ctrl+V</kbd></button>}
          <div className="xl-context__sep" role="separator" />
          <button type="button" role="menuitem" disabled={!!saving} onClick={() => insertColumn('left')}>Insert column left</button>
          <button type="button" role="menuitem" disabled={!!saving} onClick={() => insertColumn('right')}>Insert column right</button>
          <button type="button" role="menuitem" disabled={!!saving} onClick={addUpdateColumn}>Add this week’s update column</button>
          {grid.canRenameColumns && (
            <button type="button" role="menuitem" disabled={!!saving} onClick={() => renameColumn(colMenu.c)}>Rename header</button>
          )}
          {excelLinkFor && (
            <button type="button" role="menuitem" onClick={() => openInExcel(colMenu.c)}>Open in Excel at column {cols[colMenu.c]?.letter}</button>
          )}
          {grid.canDeleteColumns && (
            <button type="button" role="menuitem" className="xl-context__danger" disabled={!!saving} onClick={deleteColumn}>
              Delete column {cols[colMenu.c]?.letter}
            </button>
          )}
          <p className="xl-context__note">Changes the Excel file for every department.{grid.canDeleteColumns ? '' : ' Only admins can delete columns.'}</p>
        </div>
      )}
      {cellMenu && (
        <div className="xl-context" role="menu" style={{ left: cellMenu.x, top: cellMenu.y }}>
          <button type="button" role="menuitem" onClick={copySelection}>Copy<kbd>Ctrl+C</kbd></button>
          {onPasteCells && <button type="button" role="menuitem" disabled={!!saving} onClick={pasteFromMenu}>Paste<kbd>Ctrl+V</kbd></button>}
          <p className="xl-context__note">Pasting writes the values into the Excel file (formatting is kept). Ctrl+Z undoes it.</p>
        </div>
      )}
      {rowMenu && (
        <div className="xl-context" role="menu" style={{ left: rowMenu.x, top: rowMenu.y }}>
          <button type="button" role="menuitem" onClick={copySelection}>Copy<kbd>Ctrl+C</kbd></button>
          {onPasteCells && <button type="button" role="menuitem" disabled={!!saving} onClick={pasteFromMenu}>Paste<kbd>Ctrl+V</kbd></button>}
          <div className="xl-context__sep" role="separator" />
          <button type="button" role="menuitem" onClick={() => setRowsHidden(rowMenu.keys, true)}>
            Hide {rowMenu.keys.length === 1 ? 'row' : `${rowMenu.keys.length} rows`}
            <kbd>Ctrl+9</kbd>
          </button>
          {allRows.length > rows.length && (
            <button type="button" role="menuitem" onClick={() => setRowsHidden([], false, { all: true })}>
              Unhide all rows ({allRows.length - rows.length})
            </button>
          )}
          <p className="xl-context__note">Hidden only in your view. Other users and the Excel file aren't affected.</p>
        </div>
      )}
      {onFormatCell && (
        <SheetRibbon
          style={selectedStyle}
          disabled={!selectedFormattable || !!saving || !!editing}
          onApply={applyFormat}
          merge={onMergeCells ? { ...mergeState, onMerge: mergeCells } : null}
          history={{
            canUndo: history.undo.length > 0 && !saving && !editing,
            canRedo: history.redo.length > 0 && !saving && !editing,
            onUndo: () => step('undo'),
            onRedo: () => step('redo'),
          }}
        />
      )}
      <div className="xl-formula">
        <div className="xl-namebox" title="Selected cell">{address}</div>
        <span className="xl-fx" aria-hidden="true">fx</span>
        <div
          className="xl-formula__text"
          onClick={() => !editing && startEdit()}
          title={formulaText}
        >
          {formulaText}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="xl-scroll"
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ '--xl-head': `${headerHeight + 20}px` }}
      >
        <table className={format?.showGridLines === false ? 'xl-grid xl-grid--nolines' : 'xl-grid'}>
          <colgroup>
            <col style={{ width: 44 }} />
            {cols.map((h) => <col key={h.letter} style={{ width: widthOf(h) }} />)}
          </colgroup>
          <thead>
            <tr className="xl-letters">
              <th className="xl-corner" title="Select the whole sheet" onMouseDown={(e) => { if (e.button === 0) selectAll(); }} />
              {cols.map((h, c) => (
                <th
                  key={h.letter}
                  className={[
                    'xl-letter',
                    selCols.has(c) && 'xl-letter--sel',
                    drag && drag.from === c && 'xl-letter--dragging',
                    drag && drag.to === c && drag.from !== c && `xl-letter--drop-${drag.side}`,
                  ].filter(Boolean).join(' ')}
                  draggable={!!onColumns && !editing && !saving}
                  onDragStart={(e) => {
                    if (resizing.current) { e.preventDefault(); return; }
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', h.letter);
                    setDrag({ from: c, to: null, side: 'left' });
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    const box = e.currentTarget.getBoundingClientRect();
                    const side = e.clientX < box.left + box.width / 2 ? 'left' : 'right';
                    if (drag.to !== c || drag.side !== side) setDrag((d) => ({ ...d, to: c, side }));
                  }}
                  onDrop={(e) => { e.preventDefault(); dropColumn(); }}
                  onDragEnd={() => setDrag((d) => (d && d.to === null ? null : d))}
                  title={`Select column ${h.letter} (Shift+click to select several columns${onColumns ? ', drag to move it in the Excel file, right-click for more' : ''}; drag its right edge to change the width)`}
                  onMouseDown={(e) => { if (e.button === 0) selectColumns(c, e.shiftKey); }}
                  onContextMenu={(e) => openColMenu(e, c)}
                >
                  {h.letter}
                  <span
                    className="xl-col-resize"
                    title={`Drag to change the width of column ${h.letter}${onColumnWidths ? ' in the Excel file' : ''}. Double-click to fit it to the content.`}
                    onMouseDown={(e) => { if (e.button === 0) startResize(e, 'col', c); }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => autofit(e, 'col', c)}
                  />
                </th>
              ))}
            </tr>
            <tr className="xl-headrow" style={{ height: headerHeight }}>
              <th className="xl-rownum xl-rownum--head">1</th>
              {cols.map((h, c) => {
                const isLead = h.letter === grid.leadColumn;
                return (
                  <th
                    key={h.letter}
                    className={grid.canRenameColumns && onColumns ? 'xl-head xl-head--editable' : 'xl-head'}
                    style={cellCss(style(format?.columns[h.index]?.headerStyle), zoom)}
                    title={grid.canRenameColumns && onColumns ? 'Double-click to rename this column' : undefined}
                    onDoubleClick={() => renameColumn(c)}
                  >
                    <div className="xl-clip" style={{ maxHeight: headerHeight }}>{h.label}</div>
                    <FilterIcon active={isLead && grid.viewingDepartments.length > 0} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const height = rowHeightOf(row);
              return (
                <tr key={row.row} style={{ height }}>
                  <th
                    className={r >= rowFrom && r <= rowTo ? 'xl-rownum xl-rownum--sel' : 'xl-rownum'}
                    title={`Select row ${row.row} (Shift+click to select several${onHideRows ? ', right-click to hide' : ''})`}
                    onMouseDown={(e) => { if (e.button === 0) selectRows(r, e.shiftKey); }}
                    onContextMenu={(e) => openRowMenu(e, r)}
                  >
                    {hiddenGaps.before.has(row.key) && (
                      <button
                        type="button"
                        className="xl-hidden-gap"
                        title={`${hiddenGaps.before.get(row.key).length} hidden row(s) above. Click to unhide.`}
                        onMouseDown={(e) => { e.stopPropagation(); setRowsHidden(hiddenGaps.before.get(row.key), false); }}
                        aria-label="Unhide rows above"
                      />
                    )}
                    {row.row}
                    <span
                      className="xl-row-resize"
                      title={`Drag to change the height of row ${row.row}${onRowHeights ? ' in the Excel file' : ''}. Double-click to fit it to the text.`}
                      onMouseDown={(e) => { if (e.button === 0) startResize(e, 'row', r); }}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => autofit(e, 'row', r)}
                    />
                    {grid.editable && row.editable === false && (
                      <span className="xl-lock" title="View only: you can't change this row" aria-label="View only">🔒</span>
                    )}
                  </th>
                  {cols.map((h, c) => {
                    // Cells covered by a merged area aren't drawn; its top-left cell spans them
                    const merged = mergeAt(r, c);
                    if (merged && (r !== merged.r0 || c !== merged.c0)) return null;
                    const i = h.index;
                    const key = cellKey(row.row, i);
                    const selected = r === sel.r && c === sel.c;
                    const classes = ['xl-cell'];
                    if (row.inherited.includes(i)) classes.push('xl-cell--inherited');
                    if (selected) classes.push('xl-cell--sel');
                    if (inRange(r, c) && !selected) classes.push('xl-cell--range');
                    if (copied && r >= copied.r1 && r <= copied.r2 && c >= copied.c1 && c <= copied.c2) {
                      classes.push('xl-copy');
                      if (r === copied.r1) classes.push('xl-copy--t');
                      if (r === copied.r2 || (merged && merged.r1 >= copied.r2)) classes.push('xl-copy--b');
                      if (c === copied.c1) classes.push('xl-copy--l');
                      if (c === copied.c2 || (merged && merged.c1 >= copied.c2)) classes.push('xl-copy--r');
                    }
                    if (merged) classes.push('xl-cell--merged');
                    if (saving === key) classes.push('xl-cell--saving');
                    if (errors[key]) classes.push('xl-cell--error');
                    return (
                      <td
                        key={h.letter}
                        data-cell={`${r}-${c}`}
                        colSpan={merged && merged.c1 > merged.c0 ? merged.c1 - merged.c0 + 1 : undefined}
                        rowSpan={merged && merged.r1 > merged.r0 ? merged.r1 - merged.r0 + 1 : undefined}
                        className={classes.join(' ')}
                        style={cellCss(cellStyle(row, i), zoom)}
                        title={errors[key] || undefined}
                        onContextMenu={openCellMenu}
                        onMouseDown={(e) => {
                          if (editing) return;
                          // Right-click inside the selection keeps it (for Copy / Paste on the whole range)
                          if (e.button === 2 && (inRange(r, c) || (sel.r === r && sel.c === c))) return;
                          if (e.shiftKey) {
                            e.preventDefault(); // don't select text
                            setAnchor((a) => a || sel);
                          } else {
                            setAnchor(null);
                          }
                          setSel({ r, c });
                        }}
                        onDoubleClick={() => startEdit()}
                      >
                        <div className="xl-clip" style={{ maxHeight: merged ? rows.slice(merged.r0, merged.r1 + 1).reduce((sum, x) => sum + rowHeightOf(x), 0) : height }}>
                          {cellStyle(row, i)?.hideText ? '' : row.cells[i]}
                        </div>
                        {selected && !editing && dropdownAt(row, i) && !isReadOnly(row, i) && (
                          <button
                            type="button"
                            className="xl-dd-btn"
                            title="Choose from the list (Alt+↓)"
                            aria-label="Open the list"
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setListOpen((o) => !o); }}
                          >
                            ▾
                          </button>
                        )}
                        {selected && listOpen && !editing && dropdownAt(row, i) && (
                          <div className="xl-dd-list" role="listbox" onMouseDown={(e) => e.stopPropagation()}>
                            {dropdownAt(row, i).list.map((item) => (
                              <button
                                key={item}
                                type="button"
                                role="option"
                                aria-selected={String(row.cells[i]).trim().toLowerCase() === item.toLowerCase()}
                                className={String(row.cells[i]).trim().toLowerCase() === item.toLowerCase() ? 'xl-dd-item xl-dd-item--on' : 'xl-dd-item'}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setListOpen(false);
                                  scrollRef.current?.focus({ preventScroll: true });
                                  if (String(row.cells[i]) !== item) saveValue(row, i, item, row.cells[i] || '');
                                }}
                              >
                                {item}
                              </button>
                            ))}
                          </div>
                        )}
                        {selected && !editing && clipped && (
                          <div className="xl-peek" role="tooltip">{row.cells[i]}</div>
                        )}
                        {selected && editing && (
                          <CellEditor
                            initial={editing.initial}
                            isDate={grid.dateColumns.includes(i)}
                            minHeight={height}
                            onDraftChange={setDraft}
                            onCommit={commit}
                            onCancel={() => { committed.current = editing; setEditing(null); scrollRef.current?.focus(); }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {onHideRows && hiddenGaps.after.length > 0 && (
              <tr className="xl-hidden-tail">
                <th className="xl-rownum">
                  <button
                    type="button"
                    className="xl-hidden-gap"
                    title={`${hiddenGaps.after.length} hidden row(s) below. Click to unhide.`}
                    onClick={() => setRowsHidden(hiddenGaps.after, false)}
                    aria-label="Unhide rows below"
                  />
                </th>
                <td colSpan={cols.length} className="xl-hidden-tail__note">
                  {hiddenGaps.after.length} hidden row(s) below
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sheets.length > 0 && (
        <div className="xl-tabs" role="tablist">
          {sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.name === grid.sheet}
              className={s.name === grid.sheet ? 'xl-tab xl-tab--active' : 'xl-tab'}
              style={s.tabColor ? { '--tab-color': s.tabColor } : undefined}
              onClick={() => onSheetChange?.(s.name)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="xl-status">
        <span className={status.error ? 'xl-status__msg xl-status__msg--error' : 'xl-status__msg'}>
          {status.text || 'Ready'}
        </span>
      </div>
    </div>
  );
}

// Record count, zoom and full-screen controls shown above the sheet
function SheetTopBar({ filterSummary, hiddenCount, onUnhideAll, zoomPct, setZoomPct, isFull, toggleFullscreen }) {
  return (
    <div className="xl-topbar">
      <span className="xl-topbar__filter">
        {filterSummary}
        {hiddenCount > 0 && (
          <>
            {' · '}{hiddenCount} hidden by you{' '}
            <button type="button" className="xl-link" onClick={onUnhideAll}>Unhide all</button>
          </>
        )}
      </span>
      <span className="xl-zoom">
        <button type="button" onClick={() => setZoomPct((z) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)] ?? z)} aria-label="Zoom out">−</button>
        <span>{zoomPct}%</span>
        <button type="button" onClick={() => setZoomPct((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)] ?? z)} aria-label="Zoom in">+</button>
      </span>
      <button
        type="button"
        className="xl-fullscreen"
        onClick={toggleFullscreen}
        title={isFull ? 'Exit full screen (Esc)' : 'Full screen'}
      >
        {isFull ? (
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        )}
        <span>{isFull ? 'Exit full screen' : 'Full screen'}</span>
      </button>
    </div>
  );
}
