import { useEffect, useState } from 'react';
import useAuth from '../../hooks/useAuth';
import { getUsers, updateUser } from '../../api/userApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import Pagination from '../../components/common/Pagination';
import { formatDate, initials } from '../../utils/format';

const DEFAULT_PAGE_SIZE = 50;
const ROLES = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

// Admin page: every user who has signed in (or was synced from Microsoft 365), with role and status
export default function Users() {
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ q: '', role: '', status: '' });
  const [query, setQuery] = useState(''); // debounced copy of filters.q
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Wait until typing pauses before searching
  useEffect(() => {
    const t = setTimeout(() => { setQuery(filters.q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  // Server-side pagination: only the requested page is fetched; the API returns the total count
  useEffect(() => {
    let cancelled = false;
    getUsers({ page, limit: pageSize, q: query, role: filters.role, status: filters.status })
      .then((r) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(r.total / pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setResult(r);
      })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err)); });
    return () => { cancelled = true; };
  }, [page, pageSize, query, filters.role, filters.status]);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    if (key !== 'q') setPage(1);
  };

  async function change(u, changes, message) {
    setBusyId(u.id);
    setError('');
    setNotice('');
    try {
      const updated = await updateUser(u.id, changes);
      setResult((r) => ({ ...r, data: r.data.map((x) => (x.id === u.id ? updated : x)) }));
      setNotice(message);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function toggleActive(u) {
    const name = u.displayName || u.email;
    if (u.isActive && !window.confirm(`Deactivate ${name}?\n\nThey are signed out right away and can't sign in until reactivated.`)) return;
    change(u, { isActive: !u.isActive }, `${name} ${u.isActive ? 'deactivated' : 'reactivated'}.`);
  }


  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Users</h1>
        <p className="muted">
          Everyone who has signed in or was synced from Microsoft 365. Admins can manage users and departments and see
          all rows; changes take effect immediately.
        </p>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="input toolbar__search"
          placeholder="Search name or email…"
          value={filters.q}
          onChange={setFilter('q')}
        />
        <label className="field">
          <span className="field__label">Role</span>
          <select className="input" value={filters.role} onChange={setFilter('role')}>
            <option value="">All</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select className="input" value={filters.status} onChange={setFilter('status')}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </label>
      </div>

      <ErrorMessage>{error}</ErrorMessage>
      {notice && <div className="alert alert--success">{notice}</div>}

      {!result ? <Loader /> : (
        <Card>
          <div className="dept-table-wrap">
            <table className="dept-table user-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {result.data.length === 0 && (
                  <tr><td colSpan={6} className="muted">No users match.</td></tr>
                )}
                {result.data.map((u) => {
                  const isMe = u.id === me?.id;
                  const busy = busyId === u.id;
                  const roles = ROLES.some((r) => r.value === u.role) ? ROLES : [...ROLES, { value: u.role, label: u.role }];
                  const linked = (u.departments || []).map((d) => d.code).join(', ');
                  return (
                    <tr key={u.id} className={u.isActive ? '' : 'user-table__inactive'}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">{initials(u.displayName || u.email)}</span>
                          <div>
                            <div className="user-cell__name">
                              {u.displayName || u.email}
                              {isMe && <span className="badge">You</span>}
                            </div>
                            <div className="muted user-cell__email">{u.email}</div>
                            {u.jobTitle && <div className="muted user-cell__email">{u.jobTitle}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {linked ? <span className="code-chip">{linked}</span> : <span className="muted">None</span>}
                        {u.department && u.department !== linked && (
                          <div className="muted user-cell__email" title="Department field in Microsoft 365">M365: {u.department}</div>
                        )}
                      </td>
                      <td>
                        <select
                          className="input input--sm"
                          value={u.role}
                          disabled={isMe || busy}
                          title={isMe ? "You can't change your own role" : 'Role'}
                          onChange={(e) => change(u, { role: e.target.value }, `${u.displayName || u.email} is now ${e.target.value === 'admin' ? 'an admin' : 'a user'}.`)}
                        >
                          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <span className={u.isActive ? 'status-pill status-pill--on' : 'status-pill status-pill--off'}>
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="muted">{formatDate(u.lastLoginAt)}</td>
                      <td className="dept-table__actions">
                        <button
                          type="button"
                          className={u.isActive ? 'btn btn--ghost btn--sm btn--danger' : 'btn btn--ghost btn--sm'}
                          disabled={isMe || busy}
                          title={isMe ? "You can't deactivate your own account" : undefined}
                          onClick={() => toggleActive(u)}
                        >
                          {busy ? 'Saving…' : u.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={result.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            noun="users"
          />
        </Card>
      )}
    </div>
  );
}
