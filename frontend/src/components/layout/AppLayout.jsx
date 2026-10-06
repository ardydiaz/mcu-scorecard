import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { logActivity } from '../../api/auditApi';

// Page names recorded in the audit log
const PAGE_NAMES = {
  '/dashboard': 'Dashboard',
  '/strategy-map': 'Strategy Map',
  '/profile': 'Profile',
  '/users': 'Users (admin)',
  '/departments': 'Departments (admin)',
  '/access-rules': 'Access Rules (admin)',
  '/audit-logs': 'Audit Logs (admin)',
};

const COLLAPSED_KEY = 'mcu-scorecard.sidebarCollapsed';
const PHONE = '(max-width: 800px)';

export default function AppLayout() {
  // Phones: the sidebar slides in over the page (menuOpen). Larger screens: the ☰ button hides it so
  // the page gets the full width (collapsed, remembered in this browser).
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const { pathname } = useLocation();
  const lastLogged = useRef(null);

  // Record each page the user opens (once per page change, not on re-renders or filter changes)
  useEffect(() => {
    if (lastLogged.current === pathname) return;
    lastLogged.current = pathname;
    logActivity('page.view', PAGE_NAMES[pathname] || pathname, { path: pathname });
  }, [pathname]);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [collapsed]);

  const toggleMenu = () => {
    if (window.matchMedia(PHONE).matches) setMenuOpen((open) => !open);
    else setCollapsed((c) => !c);
  };

  return (
    <div className={collapsed ? 'layout layout--collapsed' : 'layout'}>
      <Sidebar open={menuOpen} collapsed={collapsed} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="layout__backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="layout__main">
        <Header onMenuClick={toggleMenu} sidebarHidden={collapsed} />
        <main className="layout__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
