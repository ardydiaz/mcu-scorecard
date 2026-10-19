import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES, STAGE_LABEL, TREND_GROUPS, category, fmtWhen, shares, shortName, stageColor, tierOrder, trendSeries,
} from './scoreboardData';

export const fmtLong = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
export const snapLabel = (s) => (s.date ? fmtLong(new Date(`${s.date}T00:00:00`)) : s.label);
const shortDate = (s) => (s.date
  ? `${new Date(`${s.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ’${s.date.slice(2, 4)}`
  : s.label);
const activate = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

// ---------- Drill-down dialog ----------
function ProjectItem({ d, open }) {
  const cat = CATEGORIES.find((c) => c.key === category(d));
  const team = [d.lead && `Lead ${d.lead}`, d.support && `with ${d.support}`].filter(Boolean).join(' ');
  const showPct = d.pct !== null && d.pct !== undefined && d.pct > 0;
  return (
    <details className="sb-item" open={open}>
      <summary>
        <span className={`sb-tier sb-tier--${d.tier}`} title={`Class ${d.tier}`}>{d.tier}</span>
        <span className="sb-item__name">{shortName(d.name)}<small>{team}</small></span>
        <span className="sb-item__badges">
          <span className="sb-flag" style={{ '--c': cat.color }}>{d.status || 'No traffic light'}</span>
          <span className="sb-stage" style={{ background: stageColor(d.stage) }}>
            {STAGE_LABEL[d.stage] || d.stage}{showPct && d.pct < 100 ? ` ${d.pct}%` : ''}
          </span>
        </span>
      </summary>
      <div className="sb-item__body">
        <div className="sb-meta">
          <div><span>Perspective</span><b>{d.persp}</b></div>
          <div><span>KPI</span><b>{d.kpi || 'Not set'}</b></div>
          <div><span>Target</span><b>{(d.target || 'Not set').replace(/\n/g, ', ')}</b></div>
          <div><span>Timeline</span><b>{d.launch ? `${fmtWhen(d.launch)} to ${fmtWhen(d.done)}` : 'Not set'}</b></div>
          {showPct && (
            <div style={{ '--sc': stageColor(d.stage) }}>
              <span>Progress</span><b>{d.pct}% complete{d.pctInNote === null && d.pct < 100 ? ' (last reported)' : ''}</b>
              <div className="sb-progress"><i style={{ width: `${d.pct}%` }} /></div>
            </div>
          )}
          <div><span>Stage</span><b>{d.stage}{d.stageEstimated ? ' (estimated from the note)' : ''}</b></div>
        </div>
        <div className="sb-label">Latest note{d.noteFrom ? ` (from the ${d.noteFrom} update)` : ''}</div>
        <div className="sb-note">{d.note || 'No note recorded.'}</div>
        {d.execomNotes && (
          <>
            <div className="sb-label">Execom notes</div>
            <div className="sb-note">{d.execomNotes}</div>
          </>
        )}
        <div className="sb-rowref">Excel row {d.row}{d.rowId ? ` · ${d.rowId}` : ''}</div>
      </div>
    </details>
  );
}

export function DetailDialog({ detail, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dlg = ref.current;
    if (detail && !dlg.open) dlg.showModal();
    if (!detail && dlg.open) dlg.close();
  }, [detail]);

  const list = detail ? [...detail.list].sort((a, b) => tierOrder(a.tier, b.tier) || a.row - b.row) : [];
  const perspectives = [...new Set(list.map((d) => d.persp))];
  // Legend of the two tags on each project, drawn with the same tag styles: traffic light (status
  // colors, as in Overall Status) and stage. Only the values in this list are shown.
  const lights = CATEGORIES.filter((c) => list.some((d) => category(d) === c.key));
  const stages = [...new Set(list.map((d) => d.stage))];
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog ref={ref} className="sb-dialog" aria-labelledby="sb-dialog-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {detail && (
        <>
          <div className="sb-dialog__head">
            <div>
              <h3 id="sb-dialog-title">{detail.title}</h3>
              {detail.sub && <p>{detail.sub}</p>}
            </div>
            <button type="button" className="sb-dialog__close" onClick={onClose}>Close</button>
          </div>
          {list.length > 0 && (
            <div className="sb-dialog__legend" aria-label="What the tag colors mean">
              <b>Traffic light</b>
              {lights.map((c) => <span key={c.key} className="sb-flag" style={{ '--c': c.color }}>{c.label}</span>)}
              <b>Stage</b>
              {stages.map((s) => <span key={s} className="sb-stage" style={{ background: stageColor(s) }}>{STAGE_LABEL[s] || s}</span>)}
            </div>
          )}
          <div className="sb-dialog__body">
            {!list.length && <p className="sb-empty">{detail.empty || 'No projects to show.'}</p>}
            {list.length > 8
              ? perspectives.map((p) => {
                const group = list.filter((d) => d.persp === p);
                return (
                  <div key={p}>
                    <div className="sb-group">{p}<span>{group.length} project{group.length === 1 ? '' : 's'}</span></div>
                    {group.map((d) => <ProjectItem key={d.row} d={d} open={false} />)}
                  </div>
                );
              })
              : list.map((d) => <ProjectItem key={d.row} d={d} open={list.length <= 2} />)}
          </div>
        </>
      )}
    </dialog>
  );
}

// ---------- 01 Overall status ----------
// Status colors as a legend (shown right of the section's description); the same colors mark these
// statuses across the dashboard (cards, tier rings, project tags). "No traffic light" only when used.
export function StatusLegend({ projects }) {
  const shown = CATEGORIES.filter((c) => c.key !== 'unreported' || projects.some((d) => category(d) === 'unreported'));
  return (
    <div className="sb-chartlegend sb-statuslegend" aria-label="Status colors">
      {shown.map((c) => <span key={c.key}><i style={{ background: c.color }} />{c.label}</span>)}
    </div>
  );
}

export function StatusCards({ projects, onOpen }) {
  const total = projects.length;
  const lists = Object.fromEntries(CATEGORIES.map((c) => [c.key, projects.filter((d) => category(d) === c.key)]));
  const shown = CATEGORIES.filter((c) => c.key !== 'unreported' || lists.unreported.length);
  const pct = shares(shown.map((c) => lists[c.key].length), total);
  return (
    <>
    <div className="sb-cards">
      <button type="button" className="sb-card sb-card--total" onClick={() => onOpen({ title: 'All projects', sub: `${total} projects`, list: projects })}>
        <span className="sb-card__n">{total}</span>
        <span className="sb-card__l">Total projects</span>
      </button>
      {shown.map((c, i) => {
        const n = lists[c.key].length;
        return (
          <button key={c.key} type="button" className="sb-card" style={{ '--c': c.color }}
            onClick={() => onOpen({ title: c.label, sub: `${n} of ${total} projects`, list: lists[c.key], empty: c.empty })}>
            <span className="sb-card__n">{pct[i]}%</span>
            <span className="sb-card__l">{c.label}</span>
            <span className="sb-card__sub"><b>{n}</b> of {total} projects</span>
          </button>
        );
      })}
    </div>
    </>
  );
}

// ---------- 02 Status by tier: see TierBars.jsx ----------

// ---------- 03 Worth raising at Execom ----------
// Horizontal bars, one per issue, in order of urgency (not sorted by size). Each bar sits on a light
// track that stands for all `total` projects in view, so its length is its share of the projects;
// the count and share are in a right-aligned column. Color shows urgency (act now / watch / for
// information), always with a legend and a label, never color alone. The whole row is the click
// target and opens the projects behind the bar. A project can have several issues, so the shares
// don't add up to 100%.
export const WATCH_LEVELS = [
  { key: 'now', label: 'Act now', tones: ['stop'] },
  { key: 'watch', label: 'Watch', tones: ['warn', 'waiting', 'sourcing', 'china'] },
  { key: 'info', label: 'For information', tones: ['testing', 'note', 'muted'] },
];
export const levelOf = (tone) => (WATCH_LEVELS.find((l) => l.tones.includes(tone)) || WATCH_LEVELS[2]).key;

// Urgency colors used by the bars, as a legend (shown right of the section's description)
export function WatchLegend({ items }) {
  const levels = WATCH_LEVELS.filter((l) => items.some((w) => levelOf(w.tone) === l.key));
  if (!levels.length) return null;
  return (
    <div className="sb-chartlegend sb-watchlegend" aria-label="Urgency colors">
      {levels.map((l) => <span key={l.key}><i style={{ background: `var(--bar-${l.key})` }} />{l.label}</span>)}
    </div>
  );
}

// ---------- 04 Trend over time ----------
const SERIES = 8; // validated categorical slots
const seriesColor = (i) => (i < SERIES ? `var(--sb-series-${i + 1})` : 'var(--sb-series-other)');
const fmtPct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v)}%`);
// Fixed colors for the perspectives (matched by name, so a perspective keeps its color in every file)
const PERSPECTIVE_COLORS = [
  [/profitab/i, 'var(--sb-persp-profitability)'],
  [/quality/i, 'var(--sb-persp-quality)'],
  [/innovat/i, 'var(--sb-persp-innovation)'],
];
const perspectiveColor = (name) => PERSPECTIVE_COLORS.find(([re]) => re.test(name))?.[1];

export function TrendChart({ snapshots, selected, onSelect, onOpen }) {
  const [group, setGroup] = useState('persp');
  const [hidden, setHidden] = useState(() => new Set());
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const boxRef = useRef(null);
  const [width, setWidth] = useState(760);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !window.ResizeObserver) return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.max(Math.floor(el.clientWidth), 280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { rows, excluded } = useMemo(() => trendSeries(snapshots, group), [snapshots, group]);
  // Colors: up to 8 lines each get one. With more, the lines whose completion changed between updates
  // get the colors (in sheet order) and the others are gray, drawn behind them: gray = no change.
  const movedKeys = new Set(rows.filter((r) => {
    const v = r.values.filter((x) => x !== null).map(Math.round);
    return v.some((x, i) => i && x !== v[i - 1]);
  }).map((r) => r.key));
  const fewLines = rows.length <= SERIES;
  let slot = 0;
  const colored = rows.map((r, i) => {
    const fixed = group === 'persp' && perspectiveColor(r.key);
    if (fixed) return { ...r, color: fixed, moved: movedKeys.has(r.key) };
    if (fewLines) return { ...r, color: seriesColor(i), moved: movedKeys.has(r.key) };
    const moved = movedKeys.has(r.key);
    return { ...r, color: moved ? seriesColor(slot++) : 'var(--sb-series-other)', moved };
  });
  const grayMeaning = !fewLines;
  const groupDef = TREND_GROUPS.find((g) => g.key === group);
  const H = 320; const ml = 46; const mr = 24; const mt = 14; const mb = 42;
  const n = snapshots.length;
  const times = snapshots.map((s, i) => (s.date ? new Date(`${s.date}T00:00:00`).getTime() : i));
  const t0 = Math.min(...times); const t1 = Math.max(...times);
  // Every line starts at 0% on the left ("Start"); the update columns follow, spaced by their dates
  const startX = ml + 24; const right = width - mr - 24;
  const left = startX + Math.min(110, Math.max(48, (right - startX) * 0.12));
  const xs = times.map((t) => (n === 1 || t1 === t0 ? (n === 1 ? right : left) : left + ((t - t0) / (t1 - t0)) * (right - left)));
  const y = (v) => mt + (1 - v / 100) * (H - mt - mb);
  // Gray (unchanged) lines first, so the colored ones are drawn on top
  // With many lines (KRA / KPI / Project) only the ones that changed are drawn, unless the user asks
  // for the unchanged (gray) ones too; those are drawn first, so the colored lines stay on top
  const unchangedCount = grayMeaning ? colored.filter((r) => !r.moved).length : 0;
  const visible = colored
    .filter((r) => !hidden.has(r.key) && (!grayMeaning || r.moved || showUnchanged))
    .sort((a, b) => (grayMeaning ? Number(a.moved) - Number(b.moved) : 0));
  const selIdx = Math.max(0, snapshots.findIndex((s) => s.label === selected));

  const openRow = (row) => onOpen({
    title: row.name,
    sub: `Reported completion ${fmtPct(row.values[selIdx])} as of ${snapLabel(snapshots[selIdx])}.`,
    list: snapshots[selIdx].projects.filter((d) => groupDef.of(d) === row.key),
  });
  const toggle = (key) => setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const tipRows = hoverIdx === null ? [] : visible.filter((r) => r.values[hoverIdx] !== null).sort((a, b) => b.values[hoverIdx] - a.values[hoverIdx]);
  const changed = colored.filter((r) => r.moved);

  return (
    <div className="sb-trend">
      <div className="sb-seg" role="group" aria-label="Group the trend by">
        {TREND_GROUPS.map((g) => (
          <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => { setGroup(g.key); setHidden(new Set()); setShowUnchanged(false); }}>
            {g.label}
          </button>
        ))}
      </div>
      <p className="sb-trend__note">
        {group === 'project'
          ? `Completion of each project, taken from the percentage stated in its notes.${excluded ? ` ${excluded} other projects have not reported a percentage yet, so they are not shown.` : ''}`
          : `Average completion of the projects in each ${groupDef.label === 'Perspective' ? 'perspective' : groupDef.label}. Projects that state no percentage count as 0% until they report one, and completed projects count as 100%.`}
        {' Every line starts at 0% and keeps the highest percentage reported so far, so it only goes up: a week whose note gives no percentage keeps the previous one.'}
        {' To report progress, start the week’s update with the percentage, e.g. “40% - Ongoing coordination with PLDT”.'}
        {' For cost-reduction projects whose KPI target is a percentage, the savings reported count against that target: “5% reduction” with a “>10%” target is 50%.'}
        {grayMeaning && ` Only the ${groupDef.plural} whose completion changed between updates are drawn (listed in the table below).`}
        {n === 1 && ' The sheet has one dated update so far; the trend fills in as weekly update columns are added.'}
      </p>

      {rows.length === 0 ? (
        <p className="sb-empty">No project has reported a completion percentage yet.</p>
      ) : (
        <>
          {/* Line legend only for Perspective (a few lines); KRA / KPI / Project have too many to list here,
              so their lines are named in the hover tooltip and the table below the chart */}
          {group === 'persp' && rows.length > 1 && (
            <div className="sb-legend" role="group" aria-label="Show or hide lines">
              {colored.map((r) => (
                <button key={r.key} type="button" aria-pressed={!hidden.has(r.key)} onClick={() => toggle(r.key)}>
                  <i style={{ background: r.color }} />{r.name}
                </button>
              ))}
            </div>
          )}
          {grayMeaning && unchangedCount > 0 && (
            <label className="sb-unchanged">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              Also show the {unchangedCount} unchanged {unchangedCount === 1 ? groupDef.label : groupDef.plural} (in gray)
            </label>
          )}
          <div className="sb-plot" ref={boxRef}>
            <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label="Reported completion over time">
              {[0, 20, 40, 60, 80, 100].map((v) => (
                <g key={v}>
                  <line className="sb-gridline" x1={ml} x2={width - mr} y1={y(v)} y2={y(v)} />
                  <text className="sb-axis" x={ml - 8} y={y(v) + 4} textAnchor="end">{v}%</text>
                </g>
              ))}
              <text className="sb-axis" x={startX} y={H - mb + 22} textAnchor="middle">Start</text>
              {snapshots.map((s, i) => (
                <text key={s.label} className="sb-axis" x={xs[i]} y={H - mb + 22} textAnchor="middle">{shortDate(s)}</text>
              ))}
              <line className="sb-selline" x1={xs[selIdx]} x2={xs[selIdx]} y1={mt} y2={H - mb} />
              {hoverIdx !== null && <line className="sb-hoverline" x1={xs[hoverIdx]} x2={xs[hoverIdx]} y1={mt} y2={H - mb} />}
              {snapshots.map((s, i) => {
                const lb = i ? (xs[i - 1] + xs[i]) / 2 : (startX + xs[0]) / 2;
                const rb = i < n - 1 ? (xs[i] + xs[i + 1]) / 2 : width - mr;
                return (
                  <rect key={s.label} className="sb-hit" x={lb} y={mt} width={Math.max(rb - lb, 12)} height={H - mt - mb}
                    tabIndex={0} role="button" aria-label={`${snapLabel(s)}. Select to view this update`}
                    onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}
                    onFocus={() => setHoverIdx(i)} onBlur={() => setHoverIdx(null)}
                    onClick={() => onSelect(s.label)} onKeyDown={activate(() => onSelect(s.label))} />
                );
              })}
              {visible.map((r) => {
                const pts = r.values.map((v, i) => (v === null ? null : [xs[i], y(v)])).filter(Boolean);
                const d = [[startX, y(0)], ...pts].map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
                const last = fmtPct(r.values.filter((v) => v !== null).at(-1));
                return (
                  <g key={r.key} className="sb-line" tabIndex={0} role="button" aria-label={`${r.name}, ${last}. Select to see its projects`}
                    onClick={() => openRow(r)} onKeyDown={activate(() => openRow(r))}>
                    <title>{`${r.name}: ${last}. Select to see its projects`}</title>
                    <path className="sb-line__hit" d={d} />
                    <path className="sb-line__vis" d={d} stroke={r.color} />
                    {pts.map((p) => <circle key={p[0]} cx={p[0]} cy={p[1]} r="4" fill={r.color} className="sb-line__dot" />)}
                  </g>
                );
              })}
            </svg>
            {hoverIdx !== null && (
              <div className="sb-tip" style={{ left: Math.min(Math.max(4, xs[hoverIdx] + 14), Math.max(4, width - 250)) }}>
                <b>{snapLabel(snapshots[hoverIdx])}</b>
                {tipRows.slice(0, 8).map((r) => (
                  <div key={r.key} className="sb-tip__row"><span><i style={{ background: r.color }} />{r.name}</span><strong>{fmtPct(r.values[hoverIdx])}</strong></div>
                ))}
                {tipRows.length > 8 && <div className="sb-tip__more">+ {tipRows.length - 8} more</div>}
                <small>{snapshots[hoverIdx].label === selected ? 'Currently viewing' : 'Select to view this update'}</small>
              </div>
            )}
          </div>
          <div className="sb-table">
            <p className="sb-table__cap">
              {changed.length
                ? `Showing ${changed.length} of ${rows.length} ${groupDef.plural} whose reported completion changed between updates.`
                : `No ${groupDef.label === 'KPI' || groupDef.label === 'KRA' ? groupDef.label : groupDef.label.toLowerCase()} has changed its reported completion between updates yet.`}
            </p>
            {changed.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th scope="col">{groupDef.label}</th>
                    {snapshots.map((s) => (
                      <th key={s.label} scope="col" className={s.label === selected ? 'is-selected' : ''}>
                        <button type="button" onClick={() => onSelect(s.label)} title={`View ${snapLabel(s)}`}>{shortDate(s)}</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {changed.map((r) => (
                    <tr key={r.key}>
                      <td><span className="sb-table__name"><i style={{ background: r.color }} />{r.name}</span></td>
                      {r.values.map((v, j) => <td key={snapshots[j].label} className={snapshots[j].label === selected ? 'is-selected' : ''}>{fmtPct(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
