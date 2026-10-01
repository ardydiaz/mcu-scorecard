import { useEffect, useMemo, useRef, useState } from 'react';
import SheetRibbon from './SheetRibbon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150];
const ZOOM_KEY = 'mcu-scorecard-grid-zoom';
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
export default function SheetGrid({ grid, onSaveCell, onFormatCell, onMergeCells, onHideRows, sheets = [], onSheetChange }) {
  const format = grid.format;
  const [zoomPct, setZoomPct] = useState(() => readZoom(format?.zoom || 100));
  const zoom = zoomPct / 100;
  // allRows: every row the user may see; rows: minus the ones they hid in their own view
  const [allRows, setRows] = useState(grid.rows);
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set(grid.hiddenKeys || []));
  const rows = useMemo(() => allRows.filter((x) => !hiddenKeys.has(x.key)), [allRows, hiddenKeys]);
  const [rowMenu, setRowMenu] = useState(null); // { x, y, keys } for the row-number right-click menu
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
    setRowMenu(null);
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

  // Columns hidden in the workbook stay hidden here
  const cols = useMemo(
    () => grid.headers.map((h, i) => ({ ...h, index: i })).filter((h) => !format?.columns[h.index]?.hidden),
    [grid.headers, format]
  );
  const style = (index) => (index === null || index === undefined ? null : styles[index]);
  const widthOf = (i) => colPx(format?.columns[i]?.width ?? format?.defaultColWidth) * zoom;
  const rowHeightOf = (row) => ptPx(row.height || format?.defaultRowHeight || DEFAULT_HEIGHT_PT) * zoom;
  const headerHeight = ptPx(format?.headerHeight || 30) * zoom;

  // Merged areas as grid positions { r0, c0, r1, c1 }. row.merges ({ col, span, rows }) is on the
  // area's top row; an area only spans down over rows shown consecutively (filters can hide some).
  const mergeLayout = useMemo(() => {
    const cover = new Map(); // "r-c" -> area, for every cell inside an area
    rows.forEach((row, r) => {
      for (const m of row.merges || []) {
        const inside = cols.map((h, c) => ({ h, c })).filter(({ h }) => h.index >= m.col && h.index < m.col + m.span);
        if (!inside.length) continue;
        let r1 = r;
        while (r1 + 1 < rows.length && rows[r1 + 1].row === rows[r1].row + 1 && rows[r1 + 1].row < row.row + (m.rows || 1)) r1++;
        const area = { r0: r, c0: inside[0].c, r1, c1: inside[inside.length - 1].c };
        for (let rr = area.r0; rr <= area.r1; rr++) {
          for (let cc = area.c0; cc <= area.c1; cc++) cover.set(`${rr}-${cc}`, area);
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
  function selectRows(r, extend) {
    if (editing) return;
    const startRow = extend && anchor ? anchor.r : extend ? sel.r : r;
    setAnchor({ r: startRow, c: 0 });
    setSel({ r, c: cols.length - 1 });
    scrollRef.current?.focus();
  }

  function selectColumns(c, extend) {
    if (editing) return;
    const startCol = extend && anchor ? anchor.c : extend ? sel.c : c;
    setAnchor({ r: 0, c: startCol });
    setSel({ r: rows.length - 1, c });
    scrollRef.current?.focus();
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
    if (!rowMenu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.xl-context')) setRowMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [rowMenu]);

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

  // Keep the selected cell visible
  useEffect(() => {
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

  async function commit(value, direction) {
    const edit = editing;
    setEditing(null);
    const moves = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] };
    if (direction) move(...moves[direction]);
    scrollRef.current?.focus();
    if (!edit || !current || !currentCol) return;

    const col = currentCol.index;
    const previous = edit.original;
    const isDate = grid.dateColumns.includes(col);
    if (value === previous || (isDate && value === toMonthInput(previous))) return;

    const row = current;
    const key = cellKey(row.row, col);
    const cellAddress = `${currentCol.letter}${row.row}`;
    setSaving(key);
    setStatus(`Saving ${cellAddress}…`);
    setErrors((e) => ({ ...e, [key]: undefined }));
    try {
      const result = await onSaveCell({ row, col, value, previous });
      setRows((all) => all.map((x) => (x.row !== row.row ? x : {
        ...x,
        cells: x.cells.map((c, i) => (i === col ? result.text : c)),
        identity: result.identity,
      })));
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
    try {
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
        const list = err.lost.map((l) => `• ${l.cell} (${l.column}): ${l.value.length > 60 ? `${l.value.slice(0, 60)}…` : l.value}`).join('\n');
        if (!window.confirm(`Merging keeps only the value in ${cols[startC].letter}${row.row}.\n\nThese values will be deleted:\n${list}\n\nMerge anyway?`)) {
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
    if (e.key === 'Escape' && expanded) { e.preventDefault(); setExpanded(false); return; }
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
      {rowMenu && (
        <div className="xl-context" role="menu" style={{ left: rowMenu.x, top: rowMenu.y }}>
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
            {cols.map((h) => <col key={h.letter} style={{ width: widthOf(h.index) }} />)}
          </colgroup>
          <thead>
            <tr className="xl-letters">
              <th className="xl-corner" />
              {cols.map((h, c) => (
                <th
                  key={h.letter}
                  className={selCols.has(c) ? 'xl-letter xl-letter--sel' : 'xl-letter'}
                  title={`Select column ${h.letter} (Shift+click to select several columns)`}
                  onMouseDown={(e) => selectColumns(c, e.shiftKey)}
                >
                  {h.letter}
                </th>
              ))}
            </tr>
            <tr className="xl-headrow" style={{ height: headerHeight }}>
              <th className="xl-rownum xl-rownum--head">1</th>
              {cols.map((h) => {
                const isLead = h.letter === grid.leadColumn;
                return (
                  <th key={h.letter} className="xl-head" style={cellCss(style(format?.columns[h.index]?.headerStyle), zoom)}>
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
                        style={cellCss(style(row.styles?.[i]), zoom)}
                        title={errors[key] || undefined}
                        onMouseDown={(e) => {
                          if (editing) return;
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
                          {row.cells[i]}
                        </div>
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
                            onCancel={() => { setEditing(null); scrollRef.current?.focus(); }}
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
