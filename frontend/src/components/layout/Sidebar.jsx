import { NavLink } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/strategy-map', label: 'Strategy Map' },
  { to: '/scorecard', label: 'Strategy Scorecard' },
  { to: '/profile', label: 'Profile' },
];

// Shown by role (the pages check the role too). "manager" = Department Head.
const adminLinks = [
  { to: '/users', label: 'Users', roles: ['admin'] },
  { to: '/departments', label: 'Departments', roles: ['admin'] },
  { to: '/access-rules', label: 'Access Rules', roles: ['admin', 'manager'] },
  { to: '/audit-logs', label: 'Audit Logs', roles: ['admin'] },
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
  const manageLinks = adminLinks.filter((l) => l.roles.includes(user?.role));

  return (
    <aside className={open ? 'sidebar sidebar--open' : 'sidebar'}>
      <div className="sidebar__brand">
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>MCU Scorecard</span>
      </div>
      <nav className="sidebar__nav">
        {links.map(renderLink)}
        {manageLinks.length > 0 && (
          <>
            <span className="sidebar__section">{user?.role === 'admin' ? 'Admin' : 'Department Head'}</span>
            {manageLinks.map(renderLink)}
          </>
        )}
      </nav>
    </aside>
  );
}
