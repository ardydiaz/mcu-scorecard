import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { excelUrl } from '../../utils/excelLinks';
import { EXCEL_WINDOW } from '../common/ExcelEmbed';

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
export default function SheetGrid({ grid, docUrl, onSaveCell, sheets = [], onSheetChange }) {
  const format = grid.format;
  const [zoomPct, setZoomPct] = useState(() => readZoom(format?.zoom || 100));
  const zoom = zoomPct / 100;
  const [rows, setRows] = useState(grid.rows);
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
    setSel({ r: 0, c: 0 });
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
  const style = (index) => (index === null || index === undefined ? null : format?.styles[index]);
  const widthOf = (i) => colPx(format?.columns[i]?.width ?? format?.defaultColWidth) * zoom;
  const rowHeightOf = (row) => ptPx(row.height || format?.defaultRowHeight || DEFAULT_HEIGHT_PT) * zoom;
  const headerHeight = ptPx(format?.headerHeight || 30) * zoom;

  const current = rows[sel.r];
  const currentCol = cols[sel.c];
  const address = current && currentCol ? `${currentCol.letter}${current.row}` : '';
  const cellKey = (row, i) => `${row}:${i}`;
  const isReadOnly = (row, i) => !grid.editable || !onSaveCell || row.inherited.includes(i) || row.formulas.includes(i);

  const move = useCallback((dr, dc) => {
    setSel((s) => ({
      r: Math.max(0, Math.min(rows.length - 1, s.r + dr)),
      c: Math.max(0, Math.min(cols.length - 1, s.c + dc)),
    }));
  }, [rows.length, cols.length]);

  // Keep the selected cell visible
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  function startEdit(initialOverride) {
    if (!current || !currentCol) return;
    if (isReadOnly(current, currentCol.index)) {
      setStatus(current.formulas.includes(currentCol.index)
        ? `${address} is calculated by a formula and can't be edited here.`
        : current.inherited.includes(currentCol.index)
          ? `${address} is carried down from a row above. Edit it on the row where it starts.`
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
    } finally {
      setSaving(null);
    }
  }

  function onKeyDown(e) {
    if (editing) return;
    if (e.key === 'Escape' && expanded) { e.preventDefault(); setExpanded(false); return; }
    const keys = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      PageUp: [-10, 0], PageDown: [10, 0],
    };
    if (keys[e.key]) { e.preventDefault(); move(...keys[e.key]); return; }
    if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return; }
    if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Home') { e.preventDefault(); setSel((s) => ({ r: e.ctrlKey ? 0 : s.r, c: 0 })); return; }
    if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setSel({ r: rows.length - 1, c: cols.length - 1 }); return; }
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
  const filterSummary = grid.viewingDepartments.length
    ? `${grid.rows.length} of ${grid.totalRows} records found (Lead contains ${grid.viewingDepartments.join(', ')})`
    : `${grid.totalRows} rows`;

  const isFull = fullscreen || expanded;

  return (
    <div ref={containerRef} className={expanded ? 'xl xl--expanded' : 'xl'}>
      <SheetTopBar
        filterSummary={filterSummary}
        zoomPct={zoomPct}
        setZoomPct={setZoomPct}
        isFull={isFull}
        toggleFullscreen={toggleFullscreen}
      />
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
                <th key={h.letter} className={c === sel.c ? 'xl-letter xl-letter--sel' : 'xl-letter'}>{h.letter}</th>
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
                  <th className={r === sel.r ? 'xl-rownum xl-rownum--sel' : 'xl-rownum'}>
                    {docUrl ? (
                      <a
                        href={excelUrl(docUrl, { sheet: grid.sheet, cell: `${grid.leadColumn}${row.row}` })}
                        target={EXCEL_WINDOW}
                        rel="noreferrer"
                        title={`Open row ${row.row} in Excel`}
                      >
                        {row.row}
                      </a>
                    ) : row.row}
                  </th>
                  {cols.map((h, c) => {
                    const i = h.index;
                    const key = cellKey(row.row, i);
                    const selected = r === sel.r && c === sel.c;
                    const classes = ['xl-cell'];
                    if (row.inherited.includes(i)) classes.push('xl-cell--inherited');
                    if (selected) classes.push('xl-cell--sel');
                    if (saving === key) classes.push('xl-cell--saving');
                    if (errors[key]) classes.push('xl-cell--error');
                    return (
                      <td
                        key={h.letter}
                        data-cell={`${r}-${c}`}
                        className={classes.join(' ')}
                        style={cellCss(style(row.styles?.[i]), zoom)}
                        title={errors[key] || undefined}
                        onMouseDown={() => { if (!editing) setSel({ r, c }); }}
                        onDoubleClick={() => startEdit()}
                      >
                        <div className="xl-clip" style={{ maxHeight: height }}>{row.cells[i]}</div>
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
function SheetTopBar({ filterSummary, zoomPct, setZoomPct, isFull, toggleFullscreen }) {
  return (
    <div className="xl-topbar">
      <span className="xl-topbar__filter">{filterSummary}</span>
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
