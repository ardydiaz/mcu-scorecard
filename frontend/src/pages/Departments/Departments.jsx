import { useCallback, useEffect, useState } from 'react';
import { createDepartment, deleteDepartment, getDepartments, restoreDepartment, updateDepartment } from '../../api/departmentApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import { confirmDialog, toastSuccess } from '../../utils/dialog';

const EMPTY = { code: '', name: '', description: '', aliases: '', otherNames: '', viewAll: false, leadCodes: '' };

// Form fields hold lists as text: codes comma-separated, M365 names one per line
const splitCodes = (text) => text.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
const splitLines = (text) => text.split('\n').map((n) => n.trim()).filter(Boolean);

function toForm(d) {
  return {
    code: d.code || '',
    name: d.name || '',
    description: d.description || '',
    aliases: (d.aliases || []).join(', '),
    otherNames: (d.otherNames || []).join('\n'),
    viewAll: !!d.viewAll,
    leadCodes: (d.leadCodes || []).join(', '),
  };
}

function toPayload(form) {
  return {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    aliases: splitCodes(form.aliases),
    otherNames: splitLines(form.otherNames),
    viewAll: form.viewAll,
    leadCodes: splitCodes(form.leadCodes),
  };
}

function DepartmentForm({ initial, isNew, saving, error, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <form
      className="dept-form"
      onSubmit={(e) => { e.preventDefault(); onSave(toPayload(form)); }}
    >
      <div className="dept-form__grid">
        <label className="form-field">
          <span>Code</span>
          <input className="input" value={form.code} onChange={set('code')} placeholder="ITD" maxLength={12} required autoFocus={isNew} />
          <small>Used in the scorecard's Lead column.</small>
        </label>
        <label className="form-field form-field--wide">
          <span>Name</span>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Information Technology" maxLength={100} required />
          <small>Also matched against the Department field in Microsoft 365.</small>
        </label>
        <label className="form-field">
          <span>Aliases</span>
          <input className="input" value={form.aliases} onChange={set('aliases')} placeholder="IT" />
          <small>Other spellings of the code, comma-separated (e.g. IT for ITD).</small>
        </label>
        <label className="form-field form-field--wide">
          <span>Other Microsoft 365 names</span>
          <textarea className="input" rows={3} value={form.otherNames} onChange={set('otherNames')} placeholder={'Office of the President\nBoard of Trustees'} />
          <small>One per line. Users whose M365 Department is any of these join this department.</small>
        </label>
        <label className="form-field form-field--wide">
          <span>Description</span>
          <input className="input" value={form.description} onChange={set('description')} maxLength={200} />
        </label>
        <label className="form-check">
          <input type="checkbox" checked={form.viewAll} onChange={set('viewAll')} />
          <span>
            <strong>View all rows</strong>
            <small>Members see every department's rows without the Lead filter (like EXECOM). They still only edit rows they lead.</small>
          </span>
        </label>
        <label className="form-field">
          <span>Extra Lead codes they can edit</span>
          <input className="input" value={form.leadCodes} onChange={set('leadCodes')} placeholder="EVP, BOT, OP" />
          <small>Rows with these Lead codes are editable by members too.</small>
        </label>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="dept-form__actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add department' : 'Save changes'}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

// Admin page: departments and how they're matched (Lead codes, M365 names, view-all access)
export default function Departments() {
  const [departments, setDepartments] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // 'new' | department id
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getDepartments().then(setDepartments).catch((err) => setError(getErrorMessage(err)));
  }, []);
  useEffect(load, [load]);

  async function save(payload) {
    setSaving(true);
    setFormError('');
    try {
      if (editing === 'new') await createDepartment(payload);
      else await updateDepartment(editing, payload);
      toastSuccess(`${payload.code} saved. The change applies right away; users are re-matched at their next sign-in or user sync.`);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(d) {
    const users = d.users ? `${d.users} user(s) in it will see no scorecard rows while it's deleted.\n\n` : '';
    if (!(await confirmDialog({
      title: `Delete department ${d.code} – ${d.name}?`,
      text: `${users}You can restore it later from “Deleted departments”.`,
      confirmText: 'Delete department',
      tone: 'danger',
    }))) return;
    setError('');
    try {
      const result = await deleteDepartment(d.id);
      toastSuccess(`${result.deleted} deleted. It can be restored below.`);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function restore(d) {
    setError('');
    try {
      await restoreDepartment(d.id);
      toastSuccess(`${d.code} restored with its settings${d.users ? ` and ${d.users} user(s)` : ''}.`);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const active = departments?.filter((d) => !d.deletedAt) || [];
  const deleted = departments?.filter((d) => d.deletedAt) || [];

  const startEdit = (id) => { setEditing(id); setFormError(''); };

  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Departments</h1>
        <p className="muted">
          Who sees which scorecard rows. A user's Microsoft 365 Department is matched to a department here at sign-in,
          and they see rows whose Lead contains its code or aliases.
        </p>
      </div>

      <ErrorMessage>{error}</ErrorMessage>

      {editing === 'new' ? (
        <Card title="New department">
          <DepartmentForm initial={EMPTY} isNew saving={saving} error={formError} onSave={save} onCancel={() => setEditing(null)} />
        </Card>
      ) : (
        <div className="toolbar">
          <button type="button" className="btn btn--primary" onClick={() => startEdit('new')}>+ Add department</button>
        </div>
      )}

      {!departments ? <Loader /> : (
        <Card>
          <div className="dept-table-wrap">
            <table className="dept-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Aliases</th>
                  <th>Other M365 names</th>
                  <th>Access</th>
                  <th>Users</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {active.map((d) => (editing === d.id ? (
                  <tr key={d.id} className="dept-table__editing">
                    <td colSpan={7}>
                      <DepartmentForm initial={toForm(d)} saving={saving} error={formError} onSave={save} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id}>
                    <td><span className="code-chip">{d.code}</span></td>
                    <td>
                      {d.name}
                      {d.description && <div className="muted dept-table__desc">{d.description}</div>}
                    </td>
                    <td>{(d.aliases || []).map((a) => <span key={a} className="code-chip code-chip--light">{a}</span>)}</td>
                    <td className="dept-table__names">{(d.otherNames || []).join(', ') || <span className="muted">—</span>}</td>
                    <td>
                      {d.viewAll ? <span className="badge">View all</span> : <span className="muted">Own rows</span>}
                      {(d.leadCodes || []).length > 0 && (
                        <div className="dept-table__desc muted">Also edits: {d.leadCodes.join(', ')}</div>
                      )}
                    </td>
                    <td>{d.users}</td>
                    <td className="dept-table__actions">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(d.id)}>Edit</button>
                      <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => remove(d)}>Delete</button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {deleted.length > 0 && (
        <Card title={`Deleted departments (${deleted.length})`}>
          <p className="muted">
            Deleted departments don't match anyone. Restoring brings back their settings and members.
          </p>
          <div className="dept-table-wrap">
            <table className="dept-table dept-table--deleted">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Deleted</th>
                  <th>Users</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {deleted.map((d) => (
                  <tr key={d.id}>
                    <td><span className="code-chip code-chip--muted">{d.code}</span></td>
                    <td>{d.name}</td>
                    <td>{new Date(d.deletedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{d.users}</td>
                    <td className="dept-table__actions">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => restore(d)}>Restore</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
