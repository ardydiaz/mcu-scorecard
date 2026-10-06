import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Small line icons for menu items (stroke = currentColor)
const ICONS = {
  publish: <path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14" />,
  unpublish: <path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />,
  ids: <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />,
  hide: <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.6 12.6 0 0 1-2.8 3.6M6.4 7.4C4.4 8.7 3 10.6 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />,
  open: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
};

/**
 * "⋮" button with a dropdown menu of actions. `items`: [{ label, icon, onClick, href, danger, divider }]
 * (falsy entries are skipped). The menu opens below the button (above it when there's no room),
 * and closes on a click outside, Escape, scrolling or resizing.
 */
export default function ActionMenu({ items, label = 'Actions', disabled = false, busy = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const list = items.filter(Boolean);

  // Fixed position from the button, so the menu isn't clipped by a scrolling table
  useLayoutEffect(() => {
    if (!open) return;
    const b = buttonRef.current.getBoundingClientRect();
    const h = menuRef.current?.offsetHeight || 0;
    const below = b.bottom + 6 + h <= window.innerHeight;
    setPos({ top: below ? b.bottom + 6 : Math.max(8, b.top - 6 - h), right: Math.max(8, window.innerWidth - b.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e) => { if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); buttonRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const choose = (item) => { setOpen(false); item.onClick?.(); };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'kebab kebab--open' : 'kebab'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <span className="kebab__spinner" aria-hidden="true" /> : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
        )}
        <svg className="kebab__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      {open && (
        <div ref={menuRef} className="kebab-menu" role="menu" style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}>
          {list.map((item, i) => {
            if (item.divider) return <div key={`d${i}`} className="kebab-menu__divider" role="separator" />;
            const content = (
              <>
                {item.icon && <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[item.icon]}</svg>}
                <span>{item.label}</span>
              </>
            );
            const cls = item.danger ? 'kebab-menu__item kebab-menu__item--danger' : 'kebab-menu__item';
            return item.href ? (
              <a key={item.label} className={cls} role="menuitem" href={item.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{content}</a>
            ) : (
              <button key={item.label} type="button" className={cls} role="menuitem" onClick={() => choose(item)}>{content}</button>
            );
          })}
        </div>
      )}
    </>
  );
}
