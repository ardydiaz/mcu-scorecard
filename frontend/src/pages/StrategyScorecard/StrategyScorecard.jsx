import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useScorecard, useScorecardSheets } from '../../hooks/useStrategy';
import { buildSheet } from '../../utils/sheetBuilder';
import SheetGrid from '../../components/tables/SheetGrid';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import SheetSelect from '../../components/forms/SheetSelect';
import { plural } from '../../utils/format';

const REPORT_TAB = 'Scorecard Report';
const MAX_ROW_LINES = 6;

const matchesText = (query, ...values) => values.some((v) => String(v || '').toLowerCase().includes(query));

// Client-side search over KPI names, project names and status text; keeps the hierarchy
function searchScorecard(perspectives, rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return perspectives;
  return perspectives.map((p) => ({
    ...p,
    objectives: p.objectives.map((o) => ({
      ...o,
      kras: o.kras.map((k) => ({
        ...k,
        kpis: k.kpis.map((kpi) => {
          if (matchesText(q, kpi.name, k.name, o.name, kpi.statuses[0]?.text)) return kpi;
          return { ...kpi, projects: kpi.projects.filter((pr) => matchesText(q, pr.name, pr.statuses[0]?.text)) };
        }).filter((kpi) => kpi.projects.length || matchesText(q, kpi.name, k.name, o.name, kpi.statuses[0]?.text)),
      })).filter((k) => k.kpis.length),
    })).filter((o) => o.kras.length),
  })).filter((p) => p.objectives.length);
}

/**
 * One row per KPI and per project, with the targets of the last two school years and only the
 * newest status update. Rows keep their real Excel row numbers. Perspective/Objective/KRA/KPI
 * repeated from the row above are shown grey (as carried-down values), like the Excel tab.
 */
function reportSheet(data, perspectives) {
  const targetLabels = data.targetLabels.slice(-2);
  const columns = [
    { label: 'Perspectives', width: 16 },
    { label: 'Objectives', width: 20 },
    { label: 'Key Result Area', width: 24 },
    { label: 'KPI', width: 34 },
    ...targetLabels.map((label) => ({ label, width: 11, center: true })),
    { label: 'Projects', width: 40, header: 'project' },
    { label: 'Lead', width: 10, header: 'project', center: true },
    { label: 'Support', width: 10, header: 'project', center: true },
    { label: 'Launch Date', width: 10, header: 'project', center: true },
    { label: 'Completion Date', width: 11, header: 'project', center: true },
    { label: 'Latest Update', width: 16, header: 'project', fill: 'white' },
    { label: 'Status', width: 60, header: 'project', fill: 'white' },
  ];
  const kpiCol = 3;
  const leadCol = 4 + targetLabels.length + 1;

  const rows = [];
  let previous = [];
  const push = (cells, { row, linkCell, carryKpi }) => {
    // Grey out hierarchy values repeated from the row above (and the KPI on its own project rows)
    const inherited = [0, 1, 2].filter((i) => cells[i] && cells[i] === previous[i]);
    if (carryKpi) inherited.push(kpiCol);
    rows.push({ cells, row, linkCell, inherited });
    previous = cells;
  };
  const latest = (item) => [item.statuses[0]?.label || '', item.statuses[0]?.text || ''];

  for (const p of perspectives) {
    for (const o of p.objectives) {
      for (const k of o.kras) {
        for (const kpi of k.kpis) {
          const context = [p.name, o.name, k.name];
          const targets = targetLabels.map((label) => kpi.targets.find((t) => t.label === label)?.value || '');
          const noTargets = targetLabels.map(() => '');
          // In the sheet, a KPI and its first project can share one row
          const sharedRow = kpi.name && kpi.projects[0]?.row === kpi.row;

          // A KPI led by another department is only the parent of this department's projects:
          // its own row isn't shown (its name still appears greyed on the project rows)
          if (kpi.name && !sharedRow && !kpi.contextOnly) {
            push([...context, kpi.name, ...targets, '', kpi.lead.join('/'), kpi.support.join('/'), '', '', ...latest(kpi)],
              { row: kpi.row, linkCell: kpi.cell });
          }
          kpi.projects.forEach((pr, i) => {
            const ownsKpi = sharedRow && i === 0;
            push([
              ...context,
              kpi.name,
              ...(ownsKpi ? targets : noTargets),
              pr.name,
              pr.lead.join('/'),
              pr.support.join('/'),
              pr.launchDate,
              pr.completionDate,
              ...latest(pr),
            ], { row: pr.row, linkCell: pr.cell, carryKpi: !ownsKpi && !!kpi.name });
          });
        }
      }
    }
  }

  return buildSheet(REPORT_TAB, columns, rows, {
    zoom: 80,
    maxLines: MAX_ROW_LINES,
    leadColumn: String.fromCharCode(65 + leadCol),
    viewingDepartments: data.viewingDepartments,
    excelSheet: data.sheet,
  });
}

export default function StrategyScorecard() {
  const [params, setParams] = useSearchParams();
  const sheet = params.get('sheet') || '';
  const department = params.get('department') || '';
  const [query, setQuery] = useState('');

  const sheets = useScorecardSheets();
  const { data, loading, error, reload } = useScorecard({ sheet, department });

  const perspectives = useMemo(() => (data ? searchScorecard(data.perspectives, query) : []), [data, query]);
  const report = useMemo(() => (data ? reportSheet(data, perspectives) : null), [data, perspectives]);

  function updateParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const noDepartment = data && !data.canViewAll && data.viewingDepartments.length === 0;

  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Strategy Scorecard</h1>
        {data && (
          <p className="muted">
            {data.canViewAll && !department ? 'All departments' : `Showing ${data.viewingDepartments.join(', ') || 'no department'}`}
            {' · '}{plural(data.counts.kpis, 'KPI')} · {plural(data.counts.projects, 'project')}
          </p>
        )}
      </div>

      <div className="toolbar">
        <SheetSelect
          sheets={sheets.data || []}
          value={data?.sheet || sheet}
          onChange={(name) => updateParam('sheet', name)}
        />
        {data?.canViewAll && (
          <label className="field">
            <span className="field__label">Department</span>
            <select className="input" value={department} onChange={(e) => updateParam('department', e.target.value)}>
              <option value="">All departments</option>
              {data.departments.map((d) => (
                <option key={d.code} value={d.code}>{d.name ? `${d.code} – ${d.name}` : d.code}</option>
              ))}
            </select>
          </label>
        )}
        <input
          type="search"
          className="input toolbar__search"
          placeholder="Search KPIs, projects, updates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn btn--ghost" onClick={() => reload(true)} disabled={loading}>
          Refresh from Excel
        </button>
      </div>

      <ErrorMessage>{error || sheets.error}</ErrorMessage>
      {loading && <Loader label="Reading the scorecard from Excel…" />}

      {!loading && noDepartment && (
        <div className="alert alert--info">
          Your account is not linked to a department yet, so there are no scorecard items to show.
          Please ask the ICT office to assign your department.
        </div>
      )}

      {!loading && data && !noDepartment && perspectives.length === 0 && (
        <p className="muted">{query ? 'No KPIs or projects match your search.' : 'No scorecard items for this department.'}</p>
      )}

      {!loading && report && perspectives.length > 0 && (
        <div className="sheet-view">
          <SheetGrid grid={report} />
          <p className="muted sheet-view__help">
            Read-only report with each KPI and project's latest update; select a cell to see its full text in the formula
            bar. Row numbers are the rows in “{data.sheet}”. To edit, use Strategy Map → Excel.
          </p>
        </div>
      )}
    </div>
  );
}
