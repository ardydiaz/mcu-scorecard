import { useEffect, useRef, useState } from 'react';

// Must match the fonts the backend accepts (routes/strategy.routes.js)
const FONTS = ['Calibri', 'Cambria', 'Aptos', 'Arial', 'Segoe UI', 'Times New Roman', 'Verdana', 'Tahoma'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36];

// Office theme colors, the scorecard template's own fills, and Excel's standard colors
const PALETTE = [
  ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'],
  ['#E2EFDA', '#C6E0B4', '#9BC2E6', '#DDEBF7', '#F4B084', '#FCE4D6', '#FFF2CC', '#FFE699', '#F8CBAD', '#D9D9D9'],
  ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'],
];

const Icon = {
  alignLeft: <svg viewBox="0 0 16 16"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8" /></svg>,
  alignCenter: <svg viewBox="0 0 16 16"><path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8" /></svg>,
  alignRight: <svg viewBox="0 0 16 16"><path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8" /></svg>,
  alignTop: <svg viewBox="0 0 16 16"><path d="M2 2h12M8 5v9M5 8l3-3 3 3" /></svg>,
  alignMiddle: <svg viewBox="0 0 16 16"><path d="M2 8h12M8 1v4M6 3l2 2 2-2M8 15v-4M6 13l2-2 2 2" /></svg>,
  alignBottom: <svg viewBox="0 0 16 16"><path d="M2 14h12M8 2v9M5 8l3 3 3-3" /></svg>,
  wrap: <svg viewBox="0 0 16 16"><path d="M2 3h12M2 7h10a2 2 0 010 4H8M9.5 9.5L8 11l1.5 1.5M2 11h3M2 14h12" /></svg>,
  merge: <svg viewBox="0 0 16 16"><path d="M1.5 3.5h13v9h-13zM4 8h8M6 6l-2 2 2 2M10 6l2 2-2 2" /></svg>,
  fill: <svg viewBox="0 0 16 16"><path d="M3 8l5-5 5 5-5 5z M11 10.5c0 1 1 2 1 2.5a1 1 0 01-2 0c0-.5 1-1.5 1-2.5" /></svg>,
};

// Color button with an Excel-style palette dropdown. `emptyLabel` is "Automatic" / "No Fill".
function ColorPicker({ label, icon, value, emptyLabel, disabled, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (color) => { setOpen(false); onPick(color); };

  return (
    <div className="rb-color" ref={ref}>
      <button type="button" className="rb-btn rb-btn--color" title={label} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span className="rb-swatch-bar" style={{ background: value || 'transparent' }} />
        <span className="rb-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="rb-palette" role="dialog" aria-label={label}>
          <button type="button" className="rb-palette__empty" onClick={() => pick(null)}>{emptyLabel}</button>
          {PALETTE.map((row, i) => (
            <div key={i} className="rb-palette__row">
              {row.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={value?.toUpperCase() === color ? 'rb-swatch rb-swatch--on' : 'rb-swatch'}
                  style={{ background: color }}
                  title={color}
                  aria-label={color}
                  onClick={() => pick(color)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Split button like Excel's "Merge & Center": the main part merges & centers the selection (or
 * unmerges a merged cell), the ▾ opens Merge & Center / Merge Cells / Unmerge Cells.
 * `merge`: { available, busy, canMerge, canUnmerge, problem, onMerge({ merge, center }) }.
 * Always clickable, like Excel; when the selection can't be merged, onMerge reports why.
 */
function MergeMenu({ merge }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = (options) => { setOpen(false); merge.onMerge(options); };
  const disabled = !merge.available || merge.busy;
  const main = merge.canUnmerge ? { merge: false } : { merge: true, center: true };
  const title = merge.canUnmerge ? 'Unmerge Cells' : merge.canMerge ? 'Merge & Center' : merge.problem || 'Merge & Center';

  return (
    <div className="rb-color rb-split" ref={ref}>
      <button
        type="button"
        className={`rb-btn rb-btn--wide rb-split__main ${merge.canUnmerge ? 'rb-btn--on' : ''}`}
        title={title}
        disabled={disabled}
        onClick={() => run(main)}
      >
        {Icon.merge}<span>Merge &amp; Center</span>
      </button>
      <button
        type="button"
        className="rb-btn rb-split__caret"
        title="More merge options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div className="rb-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => run({ merge: true, center: true })}>Merge &amp; Center</button>
          <button type="button" role="menuitem" onClick={() => run({ merge: true, center: false })}>Merge Cells</button>
          <button type="button" role="menuitem" onClick={() => run({ merge: false })}>Unmerge Cells</button>
          <p className="rb-menu__note">
            {merge.problem || 'Merging keeps only the top-left value. Lead, Projects and KPI can\'t be merged down.'}
          </p>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, title, disabled, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      className={`rb-btn ${on ? 'rb-btn--on' : ''} ${className}`}
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Home-tab style formatting controls for the selected cell. `style` is the cell's current style
 * (from the workbook), `onApply(changes)` saves a change like { bold: true } to the Excel file.
 */
export default function SheetRibbon({ style, disabled, onApply, merge }) {
  const s = style || {};
  const font = s.font || 'Calibri';
  const size = s.size || 11;
  const h = s.h && s.h !== 'general' ? s.h : 'left';
  const v = s.v === 'center' ? 'middle' : s.v || 'bottom';
  const fonts = FONTS.includes(font) ? FONTS : [font, ...FONTS];
  const sizes = SIZES.includes(size) ? SIZES : [...SIZES, size].sort((a, b) => a - b);

  return (
    <div className="xl-ribbon" role="toolbar" aria-label="Formatting">
      <div className="rb-group">
        <select
          className="rb-select rb-select--font"
          value={font}
          disabled={disabled}
          title="Font"
          onChange={(e) => onApply({ fontName: e.target.value })}
        >
          {fonts.map((f) => <option key={f} value={f} disabled={!FONTS.includes(f)}>{f}</option>)}
        </select>
        <select
          className="rb-select rb-select--size"
          value={size}
          disabled={disabled}
          title="Font size"
          onChange={(e) => onApply({ fontSize: Number(e.target.value) })}
        >
          {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="rb-group">
        <Toggle on={s.bold} title="Bold (Ctrl+B)" disabled={disabled} onClick={() => onApply({ bold: !s.bold })} className="rb-btn--b">B</Toggle>
        <Toggle on={s.italic} title="Italic (Ctrl+I)" disabled={disabled} onClick={() => onApply({ italic: !s.italic })} className="rb-btn--i">I</Toggle>
        <Toggle on={s.underline} title="Underline (Ctrl+U)" disabled={disabled} onClick={() => onApply({ underline: !s.underline })} className="rb-btn--u">U</Toggle>
      </div>

      <div className="rb-group">
        <ColorPicker
          label="Fill color"
          icon={Icon.fill}
          value={s.bg}
          emptyLabel="No Fill"
          disabled={disabled}
          onPick={(color) => onApply({ fillColor: color })}
        />
        <ColorPicker
          label="Font color"
          icon={<span className="rb-letter-a">A</span>}
          value={s.color || '#000000'}
          emptyLabel="Automatic"
          disabled={disabled}
          onPick={(color) => onApply({ fontColor: color || '#000000' })}
        />
      </div>

      <div className="rb-group">
        <Toggle on={v === 'top'} title="Top align" disabled={disabled} onClick={() => onApply({ vAlign: 'top' })}>{Icon.alignTop}</Toggle>
        <Toggle on={v === 'middle'} title="Middle align" disabled={disabled} onClick={() => onApply({ vAlign: 'middle' })}>{Icon.alignMiddle}</Toggle>
        <Toggle on={v === 'bottom'} title="Bottom align" disabled={disabled} onClick={() => onApply({ vAlign: 'bottom' })}>{Icon.alignBottom}</Toggle>
        <span className="rb-sep" />
        <Toggle on={h === 'left'} title="Align left" disabled={disabled} onClick={() => onApply({ hAlign: 'left' })}>{Icon.alignLeft}</Toggle>
        <Toggle on={h === 'center'} title="Center" disabled={disabled} onClick={() => onApply({ hAlign: 'center' })}>{Icon.alignCenter}</Toggle>
        <Toggle on={h === 'right'} title="Align right" disabled={disabled} onClick={() => onApply({ hAlign: 'right' })}>{Icon.alignRight}</Toggle>
      </div>

      <div className="rb-group">
        <Toggle on={s.wrap} title="Wrap text" disabled={disabled} onClick={() => onApply({ wrap: !s.wrap })} className="rb-btn--wide">
          {Icon.wrap}<span>Wrap</span>
        </Toggle>
        {merge && <MergeMenu merge={merge} />}
      </div>
    </div>
  );
}
