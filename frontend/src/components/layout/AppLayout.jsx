import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

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
