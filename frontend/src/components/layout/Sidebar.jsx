import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

// Menu icons (24×24 line drawings, drawn with the text color)
const ICONS = {
  operations: <path d="M3 3v18h18M7 15l4-4 3 3 6-6M17 8h3v3" />,
  dashboard: <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />,
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  sheet: <path d="M3 5h18v14H3zM3 10h18M3 15h18M9 5v14" />,
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />,
  users: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3" />,
  departments: <path d="M4 21V6l8-3 8 3v15M2 21h20M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2" />,
  workbooks: <path d="M14 3H6v18h12V7zM14 3v4h4M8 12h8M8 16h8M12 10v8" />,
  rules: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4" />,
  audit: <path d="M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8 11h8M8 15h5" />,
};
const Icon = ({ name }) => <svg className="sidebar__icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;

const links = [
  { to: '/operational-dashboard', label: 'Operational Dashboard', icon: 'operations' },
  { to: '/dashboard', label: 'Strategy Scoreboard', icon: 'dashboard' },
  { to: '/strategy-map', label: 'Scoredcard - Live Agenda', icon: 'sheet' },
  { to: '/strategy', label: 'Strategy Map', icon: 'map' },
  
];

// Dropdown groups (after the main links): a heading that opens and closes its sub-pages
const groups = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home',
    base: '/home',
    items: [
      { to: '/home/about', label: 'About MCU' },
      { to: '/home/history', label: 'History' },
      { to: '/home/purpose', label: 'Purpose, Vision, Mission and Values' },
    ],
  },
];

// Shown by role (the pages check the role too). "manager" = Department Head.
const adminLinks = [
  { to: '/users', label: 'Users', icon: 'users', roles: ['admin'] },
  { to: '/departments', label: 'Departments', icon: 'departments', roles: ['admin'] },
  { to: '/workbooks', label: 'Workbooks', icon: 'workbooks', roles: ['admin'] },
  { to: '/access-rules', label: 'Access Rules', icon: 'rules', roles: ['admin', 'manager'] },
  { to: '/audit-logs', label: 'Audit Logs', icon: 'audit', roles: ['admin'] },
];

const linkClass = ({ isActive }) => (isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link');

// A dropdown group; on each page change it opens if the page is one of its own and closes otherwise
function SidebarGroup({ group, onNavigate }) {
  const { pathname } = useLocation();
  const inside = pathname.startsWith(group.base);
  const [open, setOpen] = useState(inside);
  useEffect(() => { setOpen(pathname.startsWith(group.base)); }, [pathname, group.base]);

  return (
    <div className={['sidebar__group', open && 'sidebar__group--open', inside && 'sidebar__group--current'].filter(Boolean).join(' ')}>
      <button type="button" className="sidebar__group-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={group.icon} />
        <span>{group.label}</span>
        <svg className="sidebar__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div className="sidebar__group-items" hidden={!open}>
        {group.items.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={onNavigate} className={({ isActive }) => (isActive ? 'sidebar__sublink sidebar__sublink--active' : 'sidebar__sublink')}>
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

// `open`: slid in over the page (phones). `collapsed`: hidden to give the page the full width (larger screens).
export default function Sidebar({ open, collapsed = false, onNavigate }) {
  const { user } = useAuth();
  const renderLink = (link) => (
    <NavLink key={link.to} to={link.to} onClick={onNavigate} className={linkClass}>
      <Icon name={link.icon} />
      <span>{link.label}</span>
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
        {groups.map((g) => <SidebarGroup key={g.id} group={g} onNavigate={onNavigate} />)}
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
