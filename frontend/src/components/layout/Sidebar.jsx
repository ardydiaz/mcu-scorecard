import { NavLink } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/strategy', label: 'Strategy Map' },
  { to: '/strategy-map', label: 'Strategy Scoreboard' },
  { to: '/profile', label: 'Profile' },
];

// Shown by role (the pages check the role too). "manager" = Department Head.
const adminLinks = [
  { to: '/users', label: 'Users', roles: ['admin'] },
  { to: '/departments', label: 'Departments', roles: ['admin'] },
  { to: '/workbooks', label: 'Workbooks', roles: ['admin'] },
  { to: '/access-rules', label: 'Access Rules', roles: ['admin', 'manager'] },
  { to: '/audit-logs', label: 'Audit Logs', roles: ['admin'] },
];

// `open`: slid in over the page (phones). `collapsed`: hidden to give the page the full width (larger screens).
export default function Sidebar({ open, collapsed = false, onNavigate }) {
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
    <aside className={['sidebar', open && 'sidebar--open', collapsed && 'sidebar--collapsed'].filter(Boolean).join(' ')} aria-hidden={collapsed && !open ? true : undefined}>
      <div className="sidebar__brand">
        <img src="/mcu-logo.png" alt="Manila Central University" width="40" height="40" className="sidebar__logo" />
        <span>MCU Scoreboard</span>
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
