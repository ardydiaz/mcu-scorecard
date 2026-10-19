import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { useScoreboard, useScorecardSheets } from '../../hooks/useStrategy';
import useSelectedWorkbook from '../../hooks/useSelectedWorkbook';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import SheetSelect from '../../components/forms/SheetSelect';
import WorkbookSelect from '../../components/forms/WorkbookSelect';
import { CATEGORIES, category, expandSnapshots, snapshotDate, tiersOf, watchItems } from './scoreboardData';
import { DetailDialog, StatusCards, StatusLegend, TierRing, TrendChart, WatchBars, WatchLegend, fmtLong, snapLabel } from './ScoreboardParts';

/**
 * Dashboard: the scoreboard of the selected scorecard file and sheet (the default file first),
 * read live from Excel and filtered to the rows the user may see (department + access rules).
 * Each dated update column in the sheet is one "Status as of" date.
 */
export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const sheet = params.get('sheet') || '';
  const department = params.get('department') || '';
  const asOfParam = params.get('asof') || '';
  const files = useSelectedWorkbook();
  const workbook = files.workbook;
  const sheets = useScorecardSheets({ workbook });
  const { data, loading, error, reload } = useScoreboard({ workbook, sheet, department });
  const [detail, setDetail] = useState(null);

  // Re-read the profile so role/department changes show without signing in again
  useEffect(() => { refreshUser(); }, [refreshUser]);

  function updateParams(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const snapshots = useMemo(() => (data ? expandSnapshots(data) : []), [data]);
  const latest = snapshots.at(-1);
  const snap = snapshots.find((s) => s.label === asOfParam) || latest;
  const projects = snap?.projects || [];
  const isOld = Boolean(snap && latest && snap !== latest);
  const asOf = snapshotDate(snap);
  const watch = useMemo(() => (snap ? watchItems(snap.projects, snapshotDate(snap)) : []), [snap]);
  const tiers = tiersOf(projects);
  const select = (label) => updateParams({ asof: label === latest?.label ? '' : label });
  const fileName = (data?.workbookName || '').replace(/\.xlsx$/i, '');
  const noDepartment = data && !data.canViewAll && data.viewingDepartments.length === 0;

  // "Information Technology Scoreboard" when one department is shown, otherwise the university's
  const viewing = data?.viewingDepartments || [];
  const deptName = (code) => data?.departments.find((d) => d.code === code)?.name || code;
  const preparedBy = viewing.length === 1 ? deptName(viewing[0]) : viewing.length ? viewing.join(', ') : 'All departments';
  const title = viewing.length === 1 ? `${deptName(viewing[0])} Scoreboard` : 'Strategy Scoreboard';
  const firstName = (user.displayName || '').split(' ')[0];

  return (
    <div className="page sb">
      <header className="sb-mast">
        <div className="sb-mast__in">
          <img src="/mcu-logo.png" alt="Manila Central University logo" />
          <div>
            <div className="sb-eyebrow"><i />{preparedBy}{data?.academicYear ? ` · Academic Year ${data.academicYear}` : ''}</div>
            <h1 className="sb-title">{title}</h1>
            <p className="sb-subtitle">
              {firstName ? `Welcome, ${firstName}. ` : ''}Status of every project against the University scorecard, grouped by perspective and KPI,
              with traffic lights, stages and the latest notes, read live from {fileName ? `“${fileName}”` : 'the Excel file'}.
            </p>
          </div>
        </div>
      </header>

      <div className="sb-metabar">
        <div className="sb-metaitem"><div className="k">Prepared by</div><div className="v">{preparedBy}</div></div>
        <div className="sb-metaitem">
          <label className="k" htmlFor="sb-asof">Status as of</label>
          <div className="v">
            {snapshots.length > 0 ? (
              <select id="sb-asof" className="sb-asof" value={snap?.label || ''} onChange={(e) => select(e.target.value)}>
                {[...snapshots].reverse().map((s) => (
                  <option key={s.label} value={s.label}>{snapLabel(s)}{s === latest ? ' (latest)' : ''}</option>
                ))}
              </select>
            ) : '—'}
          </div>
        </div>
        <div className="sb-metaitem"><div className="k">Academic year</div><div className="v">{data?.academicYear || '—'}</div></div>
        <div className="sb-metaitem"><div className="k">Projects tracked</div><div className="v">{data ? projects.length : '—'}</div></div>
      </div>

      <div className="toolbar">
        <WorkbookSelect workbooks={files.workbooks} value={workbook}
          onChange={(id) => updateParams({ workbook: id, sheet: '', department: '', asof: '' })} />
        <SheetSelect sheets={sheets.data || []} value={data?.sheet || sheet} onChange={(name) => updateParams({ sheet: name, asof: '' })} />
        {(data?.canFilterLead ?? data?.canViewAll) && data.departments?.length > 0 && (
          <label className="field">
            <span className="field__label">Lead</span>
            <select className="input" value={department} onChange={(e) => updateParams({ department: e.target.value })}>
              <option value="">{data.canViewAll ? 'All departments' : 'All my rows'}</option>
              {data.departments.map((d) => <option key={d.code} value={d.code}>{d.name ? `${d.code} – ${d.name}` : d.code}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => reload(true)} disabled={loading}>Refresh from Excel</button>
      </div>

      {isOld && (
        <div className="sb-history" role="status">
          <span>You are viewing the data as of <b>{snapLabel(snap)}</b>. The latest update is <b>{snapLabel(latest)}</b>.</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => select(latest.label)}>Go to latest</button>
        </div>
      )}

      <ErrorMessage>{files.error || error || sheets.error}</ErrorMessage>
      {loading && <Loader center label="Building the scoreboard from Excel…" />}

      {!loading && noDepartment && (
        <div className="alert alert--info">
          Your account is not linked to a department yet, so there are no projects to show. Please ask the ICT office to assign your department.
        </div>
      )}
      {!loading && data && !noDepartment && projects.length === 0 && (
        <p className="sb-empty">No projects in “{data.sheet}”{viewing.length ? ` with ${viewing.join(', ')} as Lead` : ''}.</p>
      )}

      {!loading && data && projects.length > 0 && (
        <>
          <section className="sb-section">
            <div className="sb-head"><span>01</span><h2>Overall Status</h2></div>
            <div className="sb-subrow">
              <p className="sb-sub">Projects counted by the traffic light reported in the sheet. Select a card to see the projects behind it.</p>
              <StatusLegend projects={projects} />
            </div>
            <StatusCards projects={projects} onOpen={setDetail} />
          </section>

          <section className="sb-section">
            <div className="sb-head"><span>02</span><h2>Status by Tier</h2></div>
            <p className="sb-sub">
              Projects in each tier, colored by reported status. Each ring is one tier. The centre shows that tier’s completed projects as a share
              of the tier, and hovering a segment shows its share of the tier. Select a ring segment, a status count or a tier name to see its projects.
            </p>
            <div className="sb-charttop">
              <div className="sb-charttitle">Projects per tier</div>
              <div className="sb-chartlegend">
                {CATEGORIES.filter((c) => projects.some((d) => category(d) === c.key)).map((c) => (
                  <span key={c.key}><i style={{ background: c.color }} />{c.label}</span>
                ))}
              </div>
            </div>
            <div className="sb-tiers">
              {tiers.map((t) => <TierRing key={t} tier={t} projects={projects} total={projects.length} onOpen={setDetail} />)}
            </div>
          </section>

          <section className="sb-section">
            <div className="sb-head"><span>03</span><h2>Worth Raising at Execom</h2></div>
            <div className="sb-subrow">
              <p className="sb-sub">Traffic lights show status as reported. These notes point to risks and dependencies worth discussing, as of {fmtLong(asOf)}.</p>
              {watch.length > 0 && <WatchLegend items={watch} />}
            </div>
            {watch.length === 0 ? <p className="sb-empty">Nothing stands out: no project is behind, due soon, waiting or stalled.</p> : (
              <WatchBars items={watch} total={projects.length} onOpen={setDetail} />
            )}
          </section>

          <section className="sb-section">
            <div className="sb-head"><span>04</span><h2>Trend Over Time</h2></div>
            <p className="sb-sub">
              Reported completion of projects from one weekly update to the next. Select a line to see its projects. Hover or tap a date to compare,
              and select it to view that week’s data.
            </p>
            <TrendChart snapshots={snapshots} selected={snap.label} onSelect={select} onOpen={setDetail} />
          </section>
        </>
      )}

      <DetailDialog detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
