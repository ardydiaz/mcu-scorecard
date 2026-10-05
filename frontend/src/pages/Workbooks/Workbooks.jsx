import { useCallback, useEffect, useRef, useState } from 'react';
import { assignWorkbookRowIds, getAdminWorkbooks, setDefaultWorkbook, setWorkbookStatus } from '../../api/workbookApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import ActionMenu from '../../components/common/ActionMenu';
import { confirmDialog, toastSuccess } from '../../utils/dialog';

const STATUS = {
  draft: { label: 'Draft', className: 'badge badge--draft', help: 'Only admins see it' },
  published: { label: 'Published', className: 'badge badge--published', help: 'Everyone can open it' },
  hidden: { label: 'Hidden', className: 'badge badge--hidden', help: 'Taken out of the system' },
};

const POLL_MS = 15 * 1000;

// " Row IDs: Sheet1 – 102 assigned (new column AF); …" for the notice after Publish / Assign Row IDs
function rowIdSummary(rowIds) {
  if (!rowIds?.length) return rowIds ? ' No scorecard sheets were found, so no Row IDs were added.' : '';
  const parts = rowIds.map((s) => {
    if (s.error) return `${s.sheet} – not done (${s.error})`;
    if (!s.assigned && !s.createdColumn) return `${s.sheet} – already complete`;
    return `${s.sheet} – ${s.assigned} assigned${s.createdColumn ? ` (new hidden column ${s.column})` : ''}`;
  });
  return ` Row IDs: ${parts.join('; ')}.`;
}

const formatDate =(value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Admin page: Excel files in the SharePoint Strategy → Scorecard folder. New files arrive as Draft;
// publishing releases them to users (rows still filtered by department and access rules).
export default function Workbooks() {
  const [workbooks, setWorkbooks] = useState(null);
  const [error, setError] = useState('');
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

  // `message` is text, or a function of the action's result
  async function run(w, action, message) {
    setBusy(w.id);
    setError('');
    try {
      const result = await action();
      toastSuccess(typeof message === 'function' ? message(result) : message);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(null);
    }
  }

  const changeStatus = async (w, status) => {
    if (status === 'hidden' && !(await confirmDialog({
      title: `Hide “${w.name}”?`,
      text: "Users will no longer see it in the File list. The file in SharePoint isn't changed, and you can publish it again later.",
      confirmText: 'Hide file',
      tone: 'danger',
    }))) return;
    if (status === 'published' && w.status !== 'published' && !(await confirmDialog({
      title: `Publish “${w.name}”?`,
      text: 'Users will be able to open it. Its scorecard sheets also get Row IDs (SC-0001, …) in a hidden “Row ID” column, '
        + 'like the other files, so access rules can target specific rows. No existing cells are changed.',
      confirmText: 'Publish',
    }))) return;
    const what = { published: 'published. Users can now open it', draft: 'moved back to Draft. Only admins see it now', hidden: 'hidden' }[status];
    run(w, () => setWorkbookStatus(w.id, status), (result) => `“${w.name}” ${what}.${rowIdSummary(result?.rowIds)}`);
  };
  const assignIds = async (w) => {
    if (!(await confirmDialog({
      title: `Assign Row IDs in “${w.name}”?`,
      text: 'Every scorecard sheet gets a hidden “Row ID” column (created the first time) and rows without an ID get one. '
        + 'Existing IDs and cells are not changed.',
      confirmText: 'Assign Row IDs',
      tone: 'warning',
    }))) return;
    run(w, () => assignWorkbookRowIds(w.id), (result) => `Row IDs checked in “${w.name}”.${rowIdSummary(result.rowIds)}`);
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
          Draft within about half a minute (this list updates by itself); publish it to make it available on the Dashboard and in Strategy Map.
          The default file opens first. Use the ⋮ menu on a file for its actions.
        </p>
      </div>

      <div className="toolbar">
        <button type="button" className="btn btn--ghost" onClick={() => load(true)} disabled={busy !== null}>
          {busy === 'refresh' ? 'Checking…' : 'Check folder now'}
        </button>
      </div>

      <ErrorMessage>{error}</ErrorMessage>

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
                        <ActionMenu
                          label={`Actions for ${w.name}`}
                          disabled={busy !== null}
                          busy={busy === w.id}
                          items={[
                            w.status !== 'published' && { label: 'Publish', icon: 'publish', onClick: () => changeStatus(w, 'published') },
                            w.status === 'published' && !w.isDefault && { label: 'Make default', icon: 'star', onClick: () => makeDefault(w) },
                            w.status === 'published' && { label: 'Unpublish', icon: 'unpublish', onClick: () => changeStatus(w, 'draft') },
                            w.status !== 'hidden' && { label: 'Assign Row IDs', icon: 'ids', onClick: () => assignIds(w) },
                            w.webUrl && { label: 'Open in Excel', icon: 'open', href: w.webUrl },
                            w.status !== 'hidden' && { divider: true },
                            w.status !== 'hidden' && { label: 'Hide file', icon: 'hide', danger: true, onClick: () => changeStatus(w, 'hidden') },
                          ]}
                        />
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
