import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import Avatar from '../common/Avatar';
import { confirmDialog } from '../../utils/dialog';

const ROLE_LABELS = { admin: 'Admin', manager: 'Department Head' };
const roleLabel = (role) => ROLE_LABELS[role] || (role ? role[0].toUpperCase() + role.slice(1) : '');

// The signed-in user's button; opens a menu with Profile and Sign out
function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const name = user?.displayName || user?.email;
  return (
    <div className="user-menu" ref={box}>
      <button type="button" className={`user-menu__btn${open ? ' user-menu__btn--open' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} />
        <span className="header__name">{name}</span>
        <svg className="user-menu__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__head">
            <Avatar user={user} />
            <div>
              <b>{name}</b>
              {user?.email && <span>{user.email}</span>}
              {user?.role && <em>{roleLabel(user.role)}</em>}
            </div>
          </div>
          <div className="kebab-menu__divider" />
          <Link to="/profile" role="menuitem" className="kebab-menu__item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /></svg>
            Profile
          </Link>
          <div className="kebab-menu__divider" />
          <button type="button" role="menuitem" className="kebab-menu__item kebab-menu__item--danger" onClick={() => { setOpen(false); onSignOut(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" /></svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Header({ onMenuClick, sidebarHidden = false }) {
  const { user, logout } = useAuth();

  async function confirmLogout() {
    const ok = await confirmDialog({
      title: 'Sign out?',
      text: 'You will be signed out of MCU Scorecard and your Microsoft account on this browser. Unsaved edits in an open cell are lost.',
      confirmText: 'Sign out',
      tone: 'warning',
    });
    if (ok) logout();
  }

  return (
    <header className="header">
      <button
        type="button"
        className="header__menu"
        onClick={onMenuClick}
        aria-label={sidebarHidden ? 'Show menu' : 'Hide menu'}
        aria-expanded={!sidebarHidden}
        title={sidebarHidden ? 'Show menu' : 'Hide menu (use the full width)'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {sidebarHidden && (
        <span className="header__brand">
          <img src="/mcu-logo.png" alt="" width="28" height="28" />
          MCU Scoreboard
        </span>
      )}
      <div className="header__spacer" />
      <UserMenu user={user} onSignOut={confirmLogout} />
    </header>
  );
}
