import { NavLink } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/strategy-map', label: 'Strategy Map' },
  { to: '/scorecard', label: 'Strategy Scorecard' },
  { to: '/profile', label: 'Profile' },
];

// Only shown to admins (the pages themselves are admin-only too)
const adminLinks = [
  { to: '/users', label: 'Users' },
  { to: '/departments', label: 'Departments' },
  { to: '/audit-logs', label: 'Audit Logs' },
];

export default function Sidebar({ open, onNavigate }) {
  const { user } = useAuth();
  const renderLink = (link) => (
    <NavLink
      key={link.to}
      to={link.to}
      onClick={onNavigate}
      className={({ isActive }) => (isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link')}
    >
      {link.label}
    </NavLink>
  );

  return (
    <aside className={open ? 'sidebar sidebar--open' : 'sidebar'}>
      <div className="sidebar__brand">
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>MCU Scorecard</span>
      </div>
      <nav className="sidebar__nav">
        {links.map(renderLink)}
        {user?.role === 'admin' && (
          <>
            <span className="sidebar__section">Admin</span>
            {adminLinks.map(renderLink)}
          </>
        )}
      </nav>
    </aside>
  );
}
