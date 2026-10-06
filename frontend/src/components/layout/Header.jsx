import { Link } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import Avatar from '../common/Avatar';
import { confirmDialog } from '../../utils/dialog';

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
      <Link to="/profile" className="header__user">
        <Avatar user={user} />
        <span className="header__name">{user?.displayName || user?.email}</span>
      </Link>
      <button type="button" className="btn btn--ghost" onClick={confirmLogout}>
        Sign out
      </button>
    </header>
  );
}
