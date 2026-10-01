import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login/Login';
import Dashboard from './pages/Dashboard/Dashboard';
import StrategyMap from './pages/StrategyMap/StrategyMap';
import StrategyScorecard from './pages/StrategyScorecard/StrategyScorecard';
import Profile from './pages/Profile/Profile';
import Departments from './pages/Departments/Departments';
import Users from './pages/Users/Users';
import AuditLogs from './pages/AuditLogs/AuditLogs';
import AccessRules from './pages/AccessRules/AccessRules';
import Workbooks from './pages/Workbooks/Workbooks';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/strategy-map" element={<StrategyMap />} />
          <Route path="/scorecard" element={<StrategyScorecard />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['admin']} />}>
        <Route element={<AppLayout />}>
          <Route path="/users" element={<Users />} />
          <Route path="/departments" element={<Departments />} />
          <Route path="/workbooks" element={<Workbooks />} />
          <Route path="/audit-logs" element={<AuditLogs />} />
        </Route>
      </Route>

      {/* Department Heads ("manager") manage access rules for their own department's rows */}
      <Route element={<ProtectedRoute roles={['admin', 'manager']} />}>
        <Route element={<AppLayout />}>
          <Route path="/access-rules" element={<AccessRules />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
