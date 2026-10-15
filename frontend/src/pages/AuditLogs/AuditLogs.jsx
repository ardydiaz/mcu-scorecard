import { useEffect, useRef, useState } from 'react';
import { downloadAuditCsv, getAuditLogs } from '../../api/auditApi';
import { getUsers } from '../../api/userApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import Pagination from '../../components/common/Pagination';

const DEFAULT_PAGE_SIZE = 50;
const FIELD_LABELS = {
  code: 'Code', name: 'Name', description: 'Description', aliases: 'Aliases',
  otherNames: 'M365 names', viewAll: 'View all', leadCodes: 'Extra Lead codes',
};
// Role names as shown on the Users page ("manager" is the Department Head role)
const ROLE_LABELS = { user: 'User', manager: 'Department Head', admin: 'Admin' };
const FORMAT_LABELS = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', fontName: 'Font', fontSize: 'Size',
  fontColor: 'Font color', fillColor: 'Fill', hAlign: 'Align', vAlign: 'Vertical align', wrap: 'Wrap',
};

const show = (v) => {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(none)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

function ValueChange({ from, to }) {
  return (
    <span className="audit-change">
      <span className="audit-change__from">{show(from)}</span>
      <span aria-hidden="true"> → </span>
      <span className="audit-change__to">{show(to)}</span>
    </span>
  );
}

// Human-readable details for each kind of action
function Details({ entry }) {
  const d = entry.details || {};
  switch (entry.action) {
    case 'sheet.cell_edit':
      return <><strong>{d.column}</strong>: <ValueChange from={d.oldValue} to={d.newValue} /></>;
    case 'sheet.cell_format':
      return (
        <><strong>{d.column}</strong>: {Object.entries(d.format || {})
          .map(([k, v]) => `${FORMAT_LABELS[k] || k} ${v === null ? 'none' : show(v)}`).join(', ')}</>
      );
    case 'user.role_change':
      return <ValueChange from={ROLE_LABELS[d.from] || d.from} to={ROLE_LABELS[d.to] || d.to} />;
    case 'department.update':
      return (
        <ul className="audit-list">
          {Object.entries(d.changes || {}).map(([field, c]) => (
            <li key={field}><strong>{FIELD_LABELS[field] || field}</strong>: <ValueChange from={c.from} to={c.to} /></li>
          ))}
        </ul>
      );
    case 'department.create':
      return <>{d.name}{d.viewAll ? ' · View all' : ''}{d.aliases?.length ? ` · Aliases: ${d.aliases.join(', ')}` : ''}</>;
    case 'department.delete':
      return d.affectedUsers ? <>{d.affectedUsers} user(s) affected</> : null;
    case 'auth.login':
      return <>Department {show(d.department)} · {show(d.role)}</>;
    case 'auth.login_denied':
    case 'auth.login_failed':
      return <>{d.reason}</>;
    case 'sheet.view':
      return (
        <>
          {d.view} · Lead: {show(d.department)}
          {d.rows !== undefined && <> · {d.rows} rows</>}
          {d.kpis !== undefined && <> · {d.kpis} KPIs, {d.projects} projects</>}
          {d.refreshed && <> · <strong>refreshed from Excel</strong></>}
        </>
      );
    case 'sheet.merge':
      return (
        <>
          {d.center ? 'Merge & Center' : 'Merge'}
          {d.deletedValues?.length > 0 && (
            <> · deleted {d.deletedValues.map((v) => `${v.cell}: "${v.value.length > 40 ? `${v.value.slice(0, 40)}…` : v.value}"`).join(', ')}</>
          )}
        </>
      );
    case 'sheet.unmerge':
      return null;
    case 'sheet.column_move':
      return <><strong>{d.header}</strong>: <ValueChange from={`column ${d.from}`} to={`column ${d.to}`} /> ({d.position})</>;
    case 'sheet.column_width':
      return <>Column{d.columns?.length > 1 ? 's' : ''} {(d.columns || []).join(', ')}: {d.autofit ? 'fit to content' : `${d.width} px wide`}</>;
    case 'sheet.row_height':
      return <>{d.rows} row{d.rows === 1 ? '' : 's'}: {d.autofit ? 'fit to content' : `${d.height} px high`}</>;
    case 'sheet.edit_denied':
      return <>Tried to {d.attempted}: {d.reason}</>;
    case 'audit.export':
      return Object.keys(d).length ? <>Filters: {Object.entries(d).map(([k, v]) => `${k}=${v}`).join(', ')}</> : <>All entries</>;
    case 'page.view':
    case 'excel.open':
    case 'auth.logout':
      return null;
    case 'user.sync':
      return <>{d.synced} of {d.total} synced · {d.linked} linked{d.unmatchedDepartments?.length ? ` · Unmatched: ${d.unmatchedDepartments.join(', ')}` : ''}</>;
    default:
      return entry.details ? <code>{JSON.stringify(entry.details)}</code> : null;
  }
}

const actionGroup = (action) => action.split('.')[0]; // auth / page / sheet / excel / user / department / audit

// Admin page: who did what and when (sign-ins, Excel edits, user and department changes)
export default function AuditLogs() {
  const [filters, setFilters] = useState({ q: '', action: '', userId: '', from: '', to: '' });
  const [users, setUsers] = useState([]);

  // Users for the "User" filter
  useEffect(() => {
    getUsers({ limit: 200 }).then((r) => setUsers(r.data)).catch(() => {});
  }, []);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const tableRef = useRef(null);
  const [actions, setActions] = useState({});
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  // Wait until typing pauses before searching
  useEffect(() => {
    const t = setTimeout(() => { setQuery(filters.q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const active = { q: query, action: filters.action, userId: filters.userId, from: filters.from, to: filters.to };

  // Server-side pagination: only the requested page is fetched; the API returns the total count
  useEffect(() => {
    let cancelled = false;
    setError('');
    setLoadingPage(true);
    getAuditLogs({ page, limit: pageSize, ...active })
      .then((r) => {
        if (cancelled) return;
        // A filter can shrink the result below the current page; jump to its last page
        const lastPage = Math.max(1, Math.ceil(r.total / pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setResult(r);
        setActions(r.actions || {});
      })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err)); })
      .finally(() => { if (!cancelled) setLoadingPage(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, query, filters.action, filters.userId, filters.from, filters.to]);

  function changePage(p) {
    setPage(p);
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    if (key !== 'q') setPage(1);
  };
  const clear = () => { setFilters({ q: '', action: '', userId: '', from: '', to: '' }); setPage(1); };

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadAuditCsv(active);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = filters.q || filters.action || filters.userId || filters.from || filters.to;

  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Audit Logs</h1>
        <p className="muted">Sign-ins, Excel edits and formatting, and changes to users and departments, newest first.</p>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="input toolbar__search"
          placeholder="Search user, cell, department or value…"
          value={filters.q}
          onChange={setFilter('q')}
        />
        <label className="field">
          <span className="field__label">User</span>
          <select className="input" value={filters.userId} onChange={setFilter('userId')}>
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.email}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Action</span>
          <select className="input" value={filters.action} onChange={setFilter('action')}>
            <option value="">All actions</option>
            {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">From</span>
          <input type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={setFilter('from')} />
        </label>
        <label className="field">
          <span className="field__label">To</span>
          <input type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={setFilter('to')} />
        </label>
        {hasFilters && <button type="button" className="btn btn--ghost" onClick={clear}>Clear</button>}
        <button type="button" className="btn btn--primary" onClick={exportCsv} disabled={exporting || !result?.total}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <ErrorMessage>{error}</ErrorMessage>

      {!result ? (!error && <Loader />) : (
        <Card>
          <div ref={tableRef} className={loadingPage ? 'dept-table-wrap is-loading' : 'dept-table-wrap'} aria-busy={loadingPage}>
            <table className="dept-table audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {result.data.length === 0 && (
                  <tr><td colSpan={6} className="muted">{hasFilters ? 'No entries match these filters.' : 'Nothing recorded yet.'}</td></tr>
                )}
                {result.data.map((e) => (
                  <tr key={e.id}>
                    <td className="audit-table__time">
                      {new Date(e.createdAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' })}
                    </td>
                    <td>{e.userEmail || <span className="muted">System</span>}</td>
                    <td>
                      <span className={`audit-pill audit-pill--${actionGroup(e.action)}`}>{actions[e.action] || e.action}</span>
                    </td>
                    <td className="audit-table__target">{e.target || <span className="muted">—</span>}</td>
                    <td className="audit-table__details"><Details entry={e} /></td>
                    <td className="muted" title={e.userAgent || undefined}>{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={result.total}
            onPageChange={changePage}
            onPageSizeChange={changePageSize}
            noun="entries"
          />
        </Card>
      )}
    </div>
  );
}
