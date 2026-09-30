import { Link } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { initials } from '../../utils/format';

export default function Header({ onMenuClick }) {
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <button type="button" className="header__menu" onClick={onMenuClick} aria-label="Toggle menu">
        ☰
      </button>
      <div className="header__spacer" />
      <Link to="/profile" className="header__user">
        <span className="avatar">{initials(user?.displayName || user?.email)}</span>
        <span className="header__name">{user?.displayName || user?.email}</span>
      </Link>
      <button type="button" className="btn btn--ghost" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}
