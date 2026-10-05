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

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const lastLogged = useRef(null);

  // Record each page the user opens (once per page change, not on re-renders or filter changes)
  useEffect(() => {
    if (lastLogged.current === pathname) return;
    lastLogged.current = pathname;
    logActivity('page.view', PAGE_NAMES[pathname] || pathname, { path: pathname });
  }, [pathname]);

  return (
    <div className="layout">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="layout__backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="layout__main">
        <Header onMenuClick={() => setMenuOpen((open) => !open)} />
        <main className="layout__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
