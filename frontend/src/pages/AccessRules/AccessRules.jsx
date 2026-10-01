import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assignRowIds, createAccessRule, deleteAccessRule, getAccessRules, getRowIdStatus, getRuleOptions, getRuleRows, updateAccessRule,
} from '../../api/accessRuleApi';
import { getUsers } from '../../api/userApi';
import useAuth from '../../hooks/useAuth';
import { getDepartments } from '../../api/departmentApi';
import { getSheets, getWorkbooks } from '../../api/strategyApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';

const MATCH_TYPES = [
  { value: 'rowId', label: 'Specific rows (Row ID)' },
  { value: 'lead', label: 'Lead contains' },
  { value: 'support', label: 'Support contains' },
  { value: 'perspective', label: 'Perspective is' },
  { value: 'objective', label: 'Objective is' },
  { value: 'kra', label: 'Key Result Area is' },
];
const matchLabel = (type) => MATCH_TYPES.find((m) => m.value === type)?.label || type;

const PERMISSIONS = [
  { value: 'view', label: 'View only', help: 'They can see these rows but not change them, even rows their department leads.' },
  { value: 'edit', label: 'View + edit', help: 'They can see and edit these rows, including formatting and merging.' },
  { value: 'hide', label: 'Hide', help: "They can't see these rows, even rows their department leads." },
];

const EMPTY_RULE = {
  subjectType: 'department', userId: '', departmentCode: '', workbookId: '', sheet: '', matchType: 'rowId', matchValues: [], permission: 'view', note: '',
};

const fileName = (w) => w.name.replace(/\.xlsx$/i, '');
const STATUS_SUFFIX = { draft: ' (Draft)', hidden: ' (Hidden)' };

// Visible scorecard sheets of one file (id '' = the default file); null while loading
function useFileSheets(workbook) {
  const [sheets, setSheets] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    getSheets({ workbook }).then((s) => { if (!cancelled) setSheets(s); }).catch(() => { if (!cancelled) setSheets([]); });
    return () => { cancelled = true; };
  }, [workbook]);
  return sheets;
}

// Searchable list of checkboxes; `items` are { value, label, hint }. The values already chosen when
// the list opens (e.g. editing a rule) are shown first and as chips, so they're easy to find.
function CheckList({ items, selected, onChange, emptyText }) {
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [pinned] = useState(() => new Set(selected)); // chosen when opened: listed first, not re-sorted on each click
  const chosen = new Set(selected);
  const q = query.trim().toLowerCase();
  const ordered = useMemo(
    () => [...items.filter((i) => pinned.has(i.value)), ...items.filter((i) => !pinned.has(i.value))],
    [items, pinned]
  );
  const shown = ordered
    .filter((i) => !selectedOnly || chosen.has(i.value))
    .filter((i) => !q || `${i.value} ${i.label} ${i.hint || ''}`.toLowerCase().includes(q));
  const toggle = (value) => onChange(chosen.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const labelOf = (value) => items.find((i) => i.value === value)?.label || value;

  if (!items.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="checklist">
      {selected.length > 0 && (
        <div className="checklist__chips" aria-label="Selected">
          {selected.map((value) => (
            <span key={value} className="chip">
              {labelOf(value)}
              <button type="button" className="chip__remove" onClick={() => toggle(value)} aria-label={`Remove ${value}`}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="checklist__bar">
        <input type="search" className="input input--sm" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted">{selected.length} selected</span>
        <label className="checklist__toggle">
          <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />
          Selected only
        </label>
        {shown.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([...new Set([...selected, ...shown.map((i) => i.value)])])}>
            Select shown
          </button>
        )}
        {selected.length > 0 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([])}>Clear</button>}
      </div>
      <div className="checklist__items">
        {shown.map((i) => (
          <label key={i.value} className="checklist__item">
            <input type="checkbox" checked={chosen.has(i.value)} onChange={() => toggle(i.value)} />
            <span>
              <strong>{i.label}</strong>
              {i.hint && <small className="muted"> {i.hint}</small>}
            </span>
          </label>
        ))}
        {!shown.length && <p className="muted">{selectedOnly && !selected.length ? 'Nothing selected yet.' : `Nothing matches “${query}”.`}</p>}
      </div>
    </div>
  );
}

// `onDelete` is given when editing an existing rule. `defaultWorkbook` is the id of the file that
// opens first; it supplies the sheets and values to choose from for "All files" rules.
function RuleForm({ initial, workbooks, defaultWorkbook, users, departments, saving, error, onSave, onCancel, onDelete }) {
  const [rule, setRule] = useState(initial);
  const [options, setOptions] = useState(null);
  const [rows, setRows] = useState(null);
  const set = (key, value) => setRule((r) => ({ ...r, [key]: value }));

  // Sheets and values come from the chosen file (or the default file for "All files")
  const sourceWorkbook = rule.workbookId || defaultWorkbook;
  const sheets = useFileSheets(sourceWorkbook);
  const sheetList = sheets || [];

  // Row ID rules need one sheet of the file: pick its first sheet when none (or another file's) is chosen
  useEffect(() => {
    if (sheets && rule.matchType === 'rowId' && !sheets.some((s) => s.name === rule.sheet)) {
      setRule((r) => ({ ...r, sheet: sheets[0]?.name || '', matchValues: [] }));
    }
  }, [sheets, rule.matchType, rule.sheet]);

  // Values to choose from come from the chosen sheet (or the file's first one for "All sheets")
  const sourceSheet = sheets && (sheets.some((s) => s.name === rule.sheet) ? rule.sheet : sheets[0]?.name);
  useEffect(() => {
    if (!sourceSheet) return;
    setOptions(null);
    setRows(null);
    getRuleOptions({ workbook: sourceWorkbook, sheet: sourceSheet }).then(setOptions).catch(() => setOptions({}));
    if (rule.sheet) getRuleRows({ workbook: sourceWorkbook, sheet: rule.sheet }).then(setRows).catch(() => setRows([]));
  }, [sourceWorkbook, sourceSheet, rule.sheet]);

  const items = useMemo(() => {
    if (rule.matchType === 'rowId') {
      return (rows || []).map((r) => ({
        value: r.rowId,
        label: `${r.rowId} · ${r.name}`,
        hint: `Row ${r.row} · ${r.type} · Lead ${r.lead.join('/') || '—'}${r.kra ? ` · ${r.kra}` : ''}`,
      }));
    }
    const list = options?.[rule.matchType] || [];
    const all = [...new Set([...list, ...rule.matchValues])]; // keep saved values even if not in this sheet
    return all.map((v) => ({ value: v, label: v, hint: list.includes(v) ? '' : '(not in this sheet)' }));
  }, [rule.matchType, rule.matchValues, options, rows]);

  // Row IDs are per file and sheet, so a Row ID rule always names both; other rules start on "All files"
  const changeType = (type) => setRule((r) => ({
    ...r,
    matchType: type,
    matchValues: [],
    workbookId: type === 'rowId' ? r.workbookId || defaultWorkbook : r.matchType === 'rowId' ? '' : r.workbookId,
    sheet: type === 'rowId' && !r.sheet ? sheetList[0]?.name || '' : r.sheet,
  }));
  const changeWorkbook = (id) => setRule((r) => ({ ...r, workbookId: id, ...(r.matchType === 'rowId' && { matchValues: [] }) }));

  function submit(e) {
    e.preventDefault();
    onSave({
      subjectType: rule.subjectType,
      userId: rule.subjectType === 'user' ? Number(rule.userId) || null : null,
      departmentCode: rule.subjectType === 'department' ? rule.departmentCode || null : null,
      workbookId: Number(rule.workbookId || (rule.matchType === 'rowId' ? defaultWorkbook : 0)) || null,
      sheet: rule.sheet || null,
      matchType: rule.matchType,
      matchValues: rule.matchValues,
      permission: rule.permission,
      note: rule.note || null,
    });
  }

  return (
    <form className="dept-form" onSubmit={submit}>
      <div className="dept-form__grid">
        <div className="form-field">
          <span>Who</span>
          <div className="segmented segmented--sm" role="group">
            {['department', 'user'].map((t) => (
              <button key={t} type="button" className={rule.subjectType === t ? 'segmented__btn segmented__btn--active' : 'segmented__btn'} onClick={() => set('subjectType', t)}>
                {t === 'user' ? 'A user' : 'A department'}
              </button>
            ))}
          </div>
          {rule.subjectType === 'user' ? (
            <select className="input" value={rule.userId} onChange={(e) => set('userId', e.target.value)} required>
              <option value="">Choose a user…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.email} ({u.email})</option>)}
            </select>
          ) : (
            <select className="input" value={rule.departmentCode} onChange={(e) => set('departmentCode', e.target.value)} required>
              <option value="">Choose a department…</option>
              {departments.map((d) => <option key={d.code} value={d.code}>{d.code} – {d.name}</option>)}
            </select>
          )}
        </div>

        {workbooks.length > 1 && (
          <label className="form-field">
            <span>File</span>
            <select className="input" value={rule.workbookId} onChange={(e) => changeWorkbook(e.target.value)}>
              {rule.matchType !== 'rowId' && <option value="">All files</option>}
              {workbooks.map((w) => (
                <option key={w.id} value={String(w.id)}>{fileName(w)}{STATUS_SUFFIX[w.status] || ''}</option>
              ))}
            </select>
            <small>{rule.matchType === 'rowId' ? 'Row IDs belong to one file.' : 'Leave on “All files” to apply in every scorecard file.'}</small>
          </label>
        )}

        <label className="form-field">
          <span>Sheet</span>
          <select className="input" value={rule.sheet} onChange={(e) => setRule((r) => ({ ...r, sheet: e.target.value, ...(r.matchType === 'rowId' && { matchValues: [] }) }))}>
            {rule.matchType !== 'rowId' && <option value="">All scorecard sheets</option>}
            {sheetList.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            {rule.sheet && sheets && !sheetList.some((s) => s.name === rule.sheet) && <option value={rule.sheet}>{rule.sheet}</option>}
          </select>
          <small>{rule.matchType === 'rowId' ? 'Row IDs belong to one sheet.' : 'Leave on “All” to apply in every year’s sheet.'}</small>
        </label>

        <label className="form-field">
          <span>Which rows</span>
          <select className="input" value={rule.matchType} onChange={(e) => changeType(e.target.value)}>
            {MATCH_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <div className="form-field">
          <span>Access</span>
          <div className="segmented segmented--sm" role="group">
            {PERMISSIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={rule.permission === p.value ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
                onClick={() => set('permission', p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <small>{PERMISSIONS.find((p) => p.value === rule.permission)?.help}</small>
        </div>
      </div>

      <div className="form-field">
        <span>{matchLabel(rule.matchType)}</span>
        {!options || (rule.matchType === 'rowId' && !rows) ? <Loader label="Loading from Excel…" /> : (
          <CheckList
            items={items}
            selected={rule.matchValues}
            onChange={(values) => set('matchValues', values)}
            emptyText={rule.matchType === 'rowId'
              ? 'This sheet has no Row IDs yet. Use “Assign Row IDs” above first.'
              : 'Nothing to choose in this sheet.'}
          />
        )}
      </div>

      <label className="form-field">
        <span>Note (optional)</span>
        <input className="input" value={rule.note} maxLength={255} onChange={(e) => set('note', e.target.value)} placeholder="Why this access was given" />
      </label>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="dept-form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving || !rule.matchValues.length}
          title={!rule.matchValues.length ? 'Select at least one value first' : undefined}
        >
          {saving ? 'Saving…' : 'Save rule'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        {onDelete && (
          <button type="button" className="btn btn--ghost btn--danger dept-form__delete" onClick={onDelete} disabled={saving}>
            Delete rule
          </button>
        )}
      </div>
      {!rule.matchValues.length && (
        <p className="form-hint">
          {rule.matchType === 'rowId' ? 'Select at least one row' : 'Choose at least one value'} to save this rule.
          {onDelete && ' To remove this access completely, use Delete rule.'}
        </p>
      )}
    </form>
  );
}

function RowIdPanel({ workbooks, defaultWorkbook }) {
  const [workbook, setWorkbook] = useState('');
  const fileId = workbook || defaultWorkbook;
  const fileSheets = useFileSheets(fileId);
  const sheets = useMemo(() => fileSheets || [], [fileSheets]);
  const [sheet, setSheet] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sheets.length && !sheets.some((s) => s.name === sheet)) setSheet(sheets[0].name);
  }, [sheets, sheet]);
  const load = useCallback(() => {
    if (!sheets.some((s) => s.name === sheet)) return;
    setStatus(null);
    setError('');
    getRowIdStatus({ workbook: fileId, sheet }).then(setStatus).catch((err) => setError(getErrorMessage(err)));
  }, [fileId, sheet, sheets]);
  useEffect(load, [load]);

  async function assign() {
    const toAssign = status.missing.length + status.duplicates.reduce((n, d) => n + d.rows.length - 1, 0);
    const firstTime = !status.hasColumn
      ? `\n\nThe first time, a new "Row ID" column is added in column ${status.column} and hidden in Excel. No existing cells are changed.`
      : '';
    if (!window.confirm(`Write Row IDs into "${sheet}"?\n\n${toAssign} row(s) will get a new ID. Existing IDs are kept.${firstTime}`)) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await assignRowIds({ workbook: fileId, sheet });
      setNotice(`${result.assigned} Row ID(s) assigned in column ${result.column}${result.createdColumn ? ' (created and hidden)' : ''}.`);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsWork = status && (!status.hasColumn || status.missing.length || status.duplicates.length);

  return (
    <Card title="Row IDs">
      <p className="muted">
        A permanent ID for every row (e.g. SC-0001), kept in a hidden “Row ID” column of the sheet. Rules for specific rows
        use these IDs, so they stay on the right rows even when rows are inserted or moved in Excel.
      </p>
      <div className="toolbar">
        {workbooks.length > 1 && (
          <label className="field">
            <span className="field__label">File</span>
            <select className="input" value={fileId} onChange={(e) => { setWorkbook(e.target.value); setNotice(''); }}>
              {workbooks.map((w) => <option key={w.id} value={String(w.id)}>{fileName(w)}{STATUS_SUFFIX[w.status] || ''}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field__label">Sheet</span>
          <select className="input" value={sheet} onChange={(e) => setSheet(e.target.value)}>
            {sheets.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        {status && (
          <button type="button" className="btn btn--primary" onClick={assign} disabled={busy || !needsWork}>
            {busy ? 'Writing to Excel…' : 'Assign Row IDs'}
          </button>
        )}
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {notice && <div className="alert alert--success">{notice}</div>}
      {!status && !error && <Loader label="Checking the sheet…" />}
      {status && (
        <ul className="rowid-status">
          <li>
            <strong>Column:</strong> {status.hasColumn ? `${status.column} (hidden “Row ID” column)` : `not created yet — will be column ${status.column}`}
          </li>
          <li><strong>{status.withId}</strong> of {status.dataRows} rows have an ID</li>
          {status.missing.length > 0 && (
            <li className="rowid-status--warn">
              {status.missing.length} row(s) without an ID{status.hasColumn ? ` (e.g. rows ${status.missing.slice(0, 8).join(', ')}${status.missing.length > 8 ? '…' : ''}) — probably new rows` : ''}
            </li>
          )}
          {status.duplicates.length > 0 && (
            <li className="rowid-status--warn">
              Duplicate IDs (usually a copied row): {status.duplicates.map((d) => `${d.id} on rows ${d.rows.join(', ')}`).join('; ')}.
              Assigning gives the copies new IDs.
            </li>
          )}
          {!needsWork && <li className="rowid-status--ok">Every row has a unique ID.</li>}
        </ul>
      )}
    </Card>
  );
}

// Access rules for users/departments, and the Row IDs those rules can use. Admins manage every
// rule; a Department Head ("manager") manages rules limited to rows their department leads.
export default function AccessRules() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const myCodes = (user?.departments || []).map((d) => d.code).filter(Boolean);
  const [rules, setRules] = useState(null);
  const [workbooks, setWorkbooks] = useState(null);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [editing, setEditing] = useState(null); // 'new' | rule id
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    getAccessRules().then(setRules).catch((err) => setError(getErrorMessage(err)));
  }, []);
  useEffect(() => {
    load();
    getWorkbooks().then(setWorkbooks).catch((err) => { setWorkbooks([]); setError(getErrorMessage(err)); });
    getUsers({ limit: 200, status: 'active' }).then((r) => setUsers(r.data)).catch(() => {});
    getDepartments().then((d) => setDepartments(d.filter((x) => !x.deletedAt))).catch(() => {});
  }, [load]);

  async function save(payload) {
    setSaving(true);
    setFormError('');
    try {
      if (editing === 'new') await createAccessRule(payload);
      else await updateAccessRule(editing, payload);
      setNotice('Rule saved. It applies immediately.');
      setEditing(null);
      load();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule) {
    const effect = rule.permission === 'hide'
      ? 'The hidden rows become visible to them again (if their department leads them).'
      : rule.permission === 'view'
        ? 'They lose the read-only limit / extra access this rule gave, immediately.'
        : 'They lose the edit access this rule gave, immediately.';
    if (!window.confirm(`Delete this rule for ${rule.subjectLabel}?\n\n${effect}`)) return;
    try {
      await deleteAccessRule(rule.id);
      setEditing(null);
      setNotice('Rule deleted.');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const toForm = (r) => ({
    subjectType: r.subjectType,
    userId: r.userId ? String(r.userId) : '',
    departmentCode: r.departmentCode || '',
    workbookId: r.workbookId ? String(r.workbookId) : '',
    sheet: r.sheet || '',
    matchType: r.matchType,
    matchValues: r.matchValues || [],
    permission: r.permission,
    note: r.note || '',
  });
  const start = (id) => { setEditing(id); setFormError(''); setNotice(''); };
  const fileList = workbooks || [];
  const defaultWorkbook = String(fileList.find((w) => w.isDefault)?.id ?? fileList[0]?.id ?? '');
  const manyFiles = fileList.length > 1;

  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Access Rules</h1>
        <p className="muted">
          Everyone automatically sees and edits the rows their department leads. A rule sets a user’s or department’s access
          to the rows it matches (specific rows, other departments’ rows, or whole Perspectives, Objectives or KRAs), overriding
          that default: <strong>View + edit</strong>, <strong>View only</strong> (read-only, even their own rows) or
          <strong> Hide</strong>. If rules overlap, the strictest wins (Hide, then View only, then Edit). Rules apply immediately;
          admins always see and edit everything, so check a rule by signing in as that user.
        </p>
      </div>

      {isAdmin ? (workbooks && <RowIdPanel workbooks={fileList} defaultWorkbook={defaultWorkbook} />) : (
        <div className="alert alert--info">
          As <strong>Department Head</strong>, your rules only affect rows led by{' '}
          <strong>{myCodes.join(', ') || 'your department'}</strong>, even if they match more (e.g. a whole Perspective).
          You can give anyone View / View + edit on those rows, or Hide them.
        </div>
      )}

      <ErrorMessage>{error}</ErrorMessage>
      {notice && <div className="alert alert--success">{notice}</div>}

      {editing === 'new' ? (
        <Card title="New access rule">
          <RuleForm
            initial={{ ...EMPTY_RULE, workbookId: defaultWorkbook }}
            workbooks={fileList} defaultWorkbook={defaultWorkbook} users={users} departments={departments}
            saving={saving} error={formError} onSave={save} onCancel={() => setEditing(null)}
          />
        </Card>
      ) : (
        <div className="toolbar">
          <button type="button" className="btn btn--primary" onClick={() => start('new')} disabled={!fileList.length}>+ Add rule</button>
        </div>
      )}

      {!rules ? (!error && <Loader />) : (
        <Card title={`Rules (${rules.length})`}>
          <div className="dept-table-wrap">
            <table className="dept-table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>{manyFiles ? 'File / Sheet' : 'Sheet'}</th>
                  <th>Rows</th>
                  <th>Access</th>
                  <th>Note</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && <tr><td colSpan={6} className="muted">No rules yet — everyone sees only their department’s Lead rows.</td></tr>}
                {rules.map((r) => (editing === r.id ? (
                  <tr key={r.id} className="dept-table__editing">
                    <td colSpan={6}>
                      <RuleForm
                        initial={toForm(r)}
                        workbooks={fileList} defaultWorkbook={defaultWorkbook} users={users} departments={departments}
                        saving={saving} error={formError} onSave={save} onCancel={() => setEditing(null)}
                        onDelete={() => remove(r)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td>
                      {r.subjectType === 'department' ? <span className="code-chip">{r.subjectLabel}</span> : r.subjectLabel}
                      {r.subjectEmail && <div className="muted dept-table__desc">{r.subjectEmail}</div>}
                      {r.scopeCodes?.length > 0 && (
                        <div className="muted dept-table__desc" title="Made by a Department Head: only affects these departments' rows">
                          Only {r.scopeCodes.join(', ')} rows · by {r.createdByEmail || 'a Department Head'}
                        </div>
                      )}
                    </td>
                    <td>
                      {manyFiles && (
                        <div className="dept-table__desc">{r.workbookName ? r.workbookName.replace(/\.xlsx$/i, '') : <span className="muted">All files</span>}</div>
                      )}
                      {r.sheet || <span className="muted">All sheets</span>}
                    </td>
                    <td>
                      <div>{matchLabel(r.matchType)}</div>
                      {r.rows ? (
                        <ul className="rule-rows">
                          {r.rows.slice(0, 5).map((x) => (
                            <li key={x.rowId}>
                              <strong>{x.rowId}</strong> · {x.name}{x.row ? <span className="muted"> (Row {x.row})</span> : null}
                            </li>
                          ))}
                          {r.rows.length > 5 && <li className="muted">+{r.rows.length - 5} more</li>}
                        </ul>
                      ) : (
                        <div className="muted dept-table__desc">
                          {r.matchValues.slice(0, 6).join(', ')}{r.matchValues.length > 6 ? ` +${r.matchValues.length - 6} more` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`status-pill ${r.permission === 'edit' ? 'status-pill--on' : r.permission === 'hide' ? 'status-pill--off' : ''}`}>
                        {PERMISSIONS.find((p) => p.value === r.permission)?.label || r.permission}
                      </span>
                    </td>
                    <td className="muted">{r.note || '—'}</td>
                    <td className="dept-table__actions">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => start(r.id)}>Edit</button>
                      <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => remove(r)}>Delete</button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
