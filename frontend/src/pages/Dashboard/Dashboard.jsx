import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { useScorecard, useWorkbooks } from '../../hooks/useStrategy';
import Card from '../../components/common/Card';
import ErrorMessage from '../../components/common/ErrorMessage';
import ExcelIcon from '../../components/common/ExcelIcon';
import Loader from '../../components/common/Loader';
import { capitalize } from '../../utils/format';

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const files = useWorkbooks();

  // Re-read the profile so role/department changes show without signing in again
  useEffect(() => { refreshUser(); }, [refreshUser]);
  const scorecard = useScorecard({ sheet: '', department: '' });

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

      <Card title="Scorecard files">
        <ErrorMessage>{files.error || scorecard.error}</ErrorMessage>
        {files.loading && !files.data && <Loader label="Loading files…" />}
        {files.data && files.data.length === 0 && <p className="muted">No scorecard files have been published yet.</p>}
        {files.data && files.data.length > 0 && (
          <ul className="file-list">
            {files.data.map((w) => (
              <li key={w.id}>
                <Link to={`/strategy-map?workbook=${w.id}`} className="file-list__item">
                  <ExcelIcon />
                  <span className="file-list__body">
                    <span className="file-list__name">
                      {w.name.replace(/\.xlsx$/i, '')}
                      {w.isDefault && <span className="badge">Default</span>}
                      {w.status === 'draft' && <span className="badge badge--draft">Draft</span>}
                    </span>
                    <span className="file-list__meta muted">
                      Excel workbook{w.lastModifiedAt ? ` · Updated ${new Date(w.lastModifiedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                    </span>
                  </span>
                  <span className="file-list__open" aria-hidden="true">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
