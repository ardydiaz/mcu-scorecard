import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { useScorecard, useScorecardSheets } from '../../hooks/useStrategy';
import Card from '../../components/common/Card';
import ErrorMessage from '../../components/common/ErrorMessage';
import { syncUsers } from '../../api/userApi';
import { getErrorMessage } from '../../api/axios';
import { capitalize } from '../../utils/format';

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const sheets = useScorecardSheets();

  // Re-read the profile so role/department changes show without signing in again
  useEffect(() => { refreshUser(); }, [refreshUser]);
  const scorecard = useScorecard({ sheet: '', department: '' });
  const [syncState, setSyncState] = useState({ running: false, message: '', error: '' });

  async function handleSync() {
    setSyncState({ running: true, message: '', error: '' });
    try {
      const result = await syncUsers();
      setSyncState({ running: false, message: `Synced ${result.synced} of ${result.total} users.`, error: '' });
    } catch (err) {
      setSyncState({ running: false, message: '', error: getErrorMessage(err) });
    }
  }

  const firstName = (user.displayName || '').split(' ')[0];
  const departments = (user.departments || []).map((d) => d.code || d.name);
  const counts = scorecard.data?.counts;
  // Admins and view-all departments (EXECOM) get counts for every department
  const scope = scorecard.data?.canViewAll ? 'All' : 'My';

  return (
    <div className="page">
      <h1 className="page__title">Welcome{firstName ? `, ${firstName}` : ''}</h1>

      {user.role !== 'admin' && departments.length === 0 && (
        <div className="alert alert--info">
          Your account is not linked to a department yet. Ask the ICT office to assign one so you can see your scorecard items.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Department</span>
          <span className="stat__value stat__value--text">{departments.join(', ') || '—'}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Role</span>
          <span className="stat__value stat__value--text">{capitalize(user.role)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{scope} KPIs</span>
          <span className="stat__value">{counts ? counts.kpis : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{scope} projects</span>
          <span className="stat__value">{counts ? counts.projects : '—'}</span>
        </div>
      </div>

      <Card title="Scorecard sheets">
        <ErrorMessage>{sheets.error || scorecard.error}</ErrorMessage>
        {sheets.data && sheets.data.length === 0 && <p className="muted">The workbook has no scorecard sheets yet.</p>}
        {sheets.data && sheets.data.length > 0 && (
          <ul className="link-list">
            {sheets.data.map((s, i) => (
              <li key={s.id}>
                <Link to={`/scorecard?sheet=${encodeURIComponent(s.name)}`}>{s.name}</Link>
                {i === 0 && <span className="badge">Current</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {user.role === 'admin' && (
        <Card
          title="Administration"
          actions={(
            <button type="button" className="btn btn--primary" onClick={handleSync} disabled={syncState.running}>
              {syncState.running ? 'Syncing…' : 'Sync users from Microsoft 365'}
            </button>
          )}
        >
          <p className="muted">Imports every account and department from Microsoft Entra ID.</p>
          {syncState.message && <div className="alert alert--success">{syncState.message}</div>}
          <ErrorMessage>{syncState.error}</ErrorMessage>
        </Card>
      )}
    </div>
  );
}
