import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useScorecard, useScorecardSheets, useWorkbook } from '../../hooks/useStrategy';
import { excelUrl } from '../../utils/excelLinks';
import { EXCEL_WINDOW } from '../../components/common/ExcelEmbed';
import SheetViewHint from '../../components/common/SheetViewHint';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import SheetSelect from '../../components/forms/SheetSelect';
import KpiCard from './KpiCard';
import { plural } from '../../utils/format';

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

export default function StrategyScorecard() {
  const [params, setParams] = useSearchParams();
  const sheet = params.get('sheet') || '';
  const department = params.get('department') || '';
  const [query, setQuery] = useState('');

  const sheets = useScorecardSheets();
  const workbook = useWorkbook();
  const { data, loading, error, reload } = useScorecard({ sheet, department });

  // Link that opens the real workbook at a cell of the current sheet
  const docUrl = workbook.data?.docUrl;
  const excelLinkFor = (cell) => (docUrl && data ? excelUrl(docUrl, { sheet: data.sheet, cell }) : '');

  const perspectives = useMemo(() => (data ? searchScorecard(data.perspectives, query) : []), [data, query]);

  function updateParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const highlight = data?.viewingDepartments || [];
  const noDepartment = data && !data.canViewAll && data.viewingDepartments.length === 0;

  return (
    <div className="page">
      <div className="page__heading">
        <h1 className="page__title">Strategy Scorecard</h1>
        {data && (
          <p className="muted">
            {data.canViewAll && !department ? 'All departments' : `Showing ${highlight.join(', ') || 'no department'}`}
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
        {excelLinkFor('A1') && (
          <a className="btn btn--primary" href={excelLinkFor('A1')} target={EXCEL_WINDOW} rel="noreferrer">
            Open in Excel ↗
          </a>
        )}
      </div>
      {docUrl && <SheetViewHint />}

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

      {!loading && perspectives.map((p) => (
        <section key={p.name} className="perspective">
          <h2 className="perspective__title">{p.name}</h2>
          {p.objectives.map((o, oi) => (
            <details key={`${oi}-${o.name}`} className="objective" open>
              <summary className="objective__summary">
                <span className="objective__label">Objective</span>
                <span className="objective__name">{o.name}</span>
              </summary>
              {o.kras.map((k, ki) => (
                <div key={`${ki}-${k.name}`} className="kra">
                  <h3 className="kra__title">{k.name}</h3>
                  <div className="kra__kpis">
                    {k.kpis.map((kpi) => (
                      <KpiCard key={kpi.row} kpi={kpi} highlight={highlight} excelLinkFor={excelLinkFor} />
                    ))}
                  </div>
                </div>
              ))}
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
