import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdminWorkbooks, setDefaultWorkbook, setWorkbookStatus } from '../../api/workbookApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';

const STATUS = {
  draft: { label: 'Draft', className: 'badge badge--draft', help: 'Only admins see it' },
  published: { label: 'Published', className: 'badge badge--published', help: 'Everyone can open it' },
  hidden: { label: 'Hidden', className: 'badge badge--hidden', help: 'Taken out of the system' },
};

const POLL_MS = 15 * 1000;

const formatDate =(value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Admin page: Excel files in the SharePoint Strategy → Scorecard folder. New files arrive as Draft;
// publishing releases them to users (rows still filtered by department and access rules).
export default function Workbooks() {
  const [workbooks, setWorkbooks] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null); // workbook id, or 'refresh'

  const load = useCallback((refresh = false) => {
    setError('');
    if (refresh) setBusy('refresh');
    return getAdminWorkbooks({ refresh })
      .then(setWorkbooks)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setBusy(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live updates: re-read the list in the background while the page is open (the server checks the
  // SharePoint folder at most every 20 s), and right away when the tab becomes visible again.
  // Skipped while an action is running so it doesn't overwrite its result.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const poll = () => {
      if (document.hidden || busyRef.current !== null) return;
      getAdminWorkbooks().then(setWorkbooks).catch(() => { /* keep the last list; the next poll retries */ });
    };
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function run(w, action, message) {
    setBusy(w.id);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(null);
    }
  }

  const changeStatus = (w, status) => {
    if (status === 'hidden' && !window.confirm(`Hide “${w.name}”?\n\nUsers will no longer see it in the File list. The file in SharePoint isn't changed.`)) return;
    const what = { published: 'published. Users can now open it', draft: 'moved back to Draft. Only admins see it now', hidden: 'hidden' }[status];
    run(w, () => setWorkbookStatus(w.id, status), `“${w.name}” ${what}.`);
  };
  const makeDefault = (w) => run(w, () => setDefaultWorkbook(w.id), `“${w.name}” now opens first for everyone.`);

  const present = workbooks?.filter((w) => !w.missing) || [];
  const missing = workbooks?.filter((w) => w.missing) || [];

  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Workbooks</h1>
        <p className="muted">
          Excel files in SharePoint (Strategy → Documents → Scorecard). A file uploaded there shows up here as a
          Draft within about half a minute (this list updates by itself); publish it to make it available in Strategy Map and Strategy Scorecard. The default
          file opens first.
        </p>
      </div>

      <div className="toolbar">
        <button type="button" className="btn btn--ghost" onClick={() => load(true)} disabled={busy !== null}>
          {busy === 'refresh' ? 'Checking…' : 'Check folder now'}
        </button>
      </div>

      <ErrorMessage>{error}</ErrorMessage>
      {notice && <div className="alert alert--success">{notice}</div>}

      {!workbooks ? <Loader /> : (
        <Card>
          {present.length === 0 ? (
            <p className="muted">No Excel files found in the scorecard folder.</p>
          ) : (
            <div className="dept-table-wrap">
              <table className="dept-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Last modified</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {present.map((w) => (
                    <tr key={w.id}>
                      <td>
                        {w.name}
                        {!!w.isDefault && <span className="badge">Default</span>}
                        {w.webUrl && (
                          <div className="dept-table__desc">
                            <a href={w.webUrl} target="_blank" rel="noreferrer">Open in Excel</a>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={STATUS[w.status].className}>{STATUS[w.status].label}</span>
                        <div className="muted dept-table__desc">{STATUS[w.status].help}</div>
                      </td>
                      <td>{formatDate(w.lastModifiedAt)}</td>
                      <td className="dept-table__actions">
                        {w.status !== 'published' && (
                          <button type="button" className="btn btn--primary btn--sm" disabled={busy !== null} onClick={() => changeStatus(w, 'published')}>
                            Publish
                          </button>
                        )}
                        {w.status === 'published' && !w.isDefault && (
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => makeDefault(w)}>
                            Make default
                          </button>
                        )}
                        {w.status === 'published' && (
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => changeStatus(w, 'draft')}>
                            Unpublish
                          </button>
                        )}
                        {w.status !== 'hidden' && (
                          <button type="button" className="btn btn--ghost btn--sm btn--danger" disabled={busy !== null} onClick={() => changeStatus(w, 'hidden')}>
                            Hide
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {present.length > 0 && !present.some((w) => w.isDefault) && (
            <p className="muted">
              No default file is set, so the most recently modified published file opens first.
            </p>
          )}
        </Card>
      )}

      {missing.length > 0 && (
        <Card title={`No longer in the folder (${missing.length})`}>
          <p className="muted">
            These files were moved out of the folder or deleted in SharePoint. Their access rules are kept
            and apply again if the file comes back.
          </p>
          <ul className="plain-list">
            {missing.map((w) => <li key={w.id}>{w.name} <span className="muted">· last seen {formatDate(w.updatedAt)}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
