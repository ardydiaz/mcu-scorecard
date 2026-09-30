import { NavLink } from 'react-router-dom';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/strategy-map', label: 'Strategy Map' },
  { to: '/scorecard', label: 'Strategy Scorecard' },
  { to: '/profile', label: 'Profile' },
];

export default function Sidebar({ open, onNavigate }) {
  return (
    <aside className={open ? 'sidebar sidebar--open' : 'sidebar'}>
      <div className="sidebar__brand">
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>MCU Scorecard</span>
      </div>
      <nav className="sidebar__nav">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            onClick={onNavigate}
            className={({ isActive }) => (isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link')}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
