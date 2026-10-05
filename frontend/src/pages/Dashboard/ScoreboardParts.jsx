import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES, STAGE_LABEL, TREND_GROUPS, category, fmtWhen, shares, shortName, stageColor, trendSeries,
} from './scoreboardData';

export const fmtLong = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
export const snapLabel = (s) => (s.date ? fmtLong(new Date(`${s.date}T00:00:00`)) : s.label);
const shortDate = (s) => (s.date
  ? `${new Date(`${s.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ’${s.date.slice(2, 4)}`
  : s.label);
const TIER_ORDER = { S: 0, A: 1, B: 2 };
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
              <span>Progress</span><b>{d.pct}% complete</b>
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

  const list = detail ? [...detail.list].sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.row - b.row) : [];
  const perspectives = [...new Set(list.map((d) => d.persp))];
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
export function StatusCards({ projects, onOpen }) {
  const total = projects.length;
  const lists = Object.fromEntries(CATEGORIES.map((c) => [c.key, projects.filter((d) => category(d) === c.key)]));
  const shown = CATEGORIES.filter((c) => c.key !== 'unreported' || lists.unreported.length);
  const pct = shares(shown.map((c) => lists[c.key].length), total);
  return (
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
  );
}

// ---------- 02 Status by tier ----------
const R = 76;
const CIRC = 2 * Math.PI * R;

export function TierRing({ tier, projects, total, onOpen }) {
  const [hover, setHover] = useState(null);
  const list = projects.filter((d) => d.tier === tier);
  const n = list.length;
  const segs = CATEGORIES.map((c) => ({ ...c, list: list.filter((d) => category(d) === c.key) })).filter((s) => s.list.length);
  const pct = shares(segs.map((s) => s.list.length), n);
  const completed = list.filter((d) => category(d) === 'completed').length;
  const flagged = list.filter((d) => ['behind', 'atrisk'].includes(category(d)));
  const name = tier === '–' ? 'No tier' : `Class ${tier}`;

  let offset = 0;
  const arcs = segs.map((s, i) => {
    const len = (s.list.length / n) * CIRC;
    const draw = segs.length > 1 ? Math.max(len - 2.5, 1) : len;
    const arc = { ...s, pct: pct[i], draw, offset: -offset };
    offset += len;
    return arc;
  });
  const active = arcs.find((a) => a.key === hover);
  const open = (s) => onOpen({ title: `${name}: ${s.label.toLowerCase()}`, sub: `${s.list.length} of ${n} ${name} projects`, list: s.list });

  return (
    <div className={`sb-tiercard${flagged.length ? ' sb-tiercard--attn' : ''}`}>
      <div className={`sb-ring${hover ? ' sb-ring--hover' : ''}`}>
        <svg viewBox="0 0 200 200" role="group" aria-label={`${name} status`}>
          <circle className="sb-ring__bg" cx="100" cy="100" r={R} />
          {arcs.map((a) => (
            <circle key={a.key} className={`sb-ring__seg${hover === a.key ? ' is-active' : ''}`} cx="100" cy="100" r={R}
              stroke={a.color} strokeDasharray={`${a.draw} ${CIRC - a.draw}`} strokeDashoffset={a.offset} transform="rotate(-90 100 100)"
              tabIndex={0} role="button" aria-label={`${name}, ${a.label.toLowerCase()}, ${a.list.length} of ${n} projects`}
              onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(a.key)} onBlur={() => setHover(null)}
              onClick={() => open(a)} onKeyDown={activate(() => open(a))}>
              <title>{`${a.label}: ${a.list.length}`}</title>
            </circle>
          ))}
        </svg>
        <div className="sb-ring__center">
          {active ? (
            <><b style={{ color: active.color }}>{active.pct}%</b><span>{active.label}</span><em>{active.list.length} of {n}</em></>
          ) : (
            <><b>{n ? Math.round((completed / n) * 100) : 0}%</b><span>completed</span><em>{completed} of {n}</em></>
          )}
        </div>
      </div>
      <button type="button" className="sb-tiername" onClick={() => onOpen({ title: `${name} projects`, sub: `${n} of ${total} projects`, list })}>
        <span>{name}</span><small>{n} project{n === 1 ? '' : 's'}</small>
      </button>
      <div className="sb-chips">
        {arcs.map((a) => (
          <button key={a.key} type="button" className="sb-chip" onClick={() => open(a)}
            onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: a.color }} />{a.label} <b>{a.list.length}</b>
          </button>
        ))}
      </div>
      {flagged.length > 0 && (
        <div className="sb-attn"><b>Needs attention:</b> {flagged.map((d) => `${shortName(d.name)} (${d.status.toLowerCase()})`).join(', ')}</div>
      )}
    </div>
  );
}

// ---------- 04 Trend over time ----------
const SERIES = 8; // validated categorical slots; further lines are neutral gray (named in the legend and table)
const seriesColor = (i) => (i < SERIES ? `var(--sb-series-${i + 1})` : 'var(--sb-series-other)');
const fmtPct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v)}%`);

export function TrendChart({ snapshots, selected, onSelect, onOpen }) {
  const [group, setGroup] = useState('persp');
  const [hidden, setHidden] = useState(() => new Set());
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
  const colored = rows.map((r, i) => ({ ...r, color: seriesColor(i) }));
  const groupDef = TREND_GROUPS.find((g) => g.key === group);
  const H = 320; const ml = 46; const mr = 24; const mt = 14; const mb = 42;
  const n = snapshots.length;
  const times = snapshots.map((s, i) => (s.date ? new Date(`${s.date}T00:00:00`).getTime() : i));
  const t0 = Math.min(...times); const t1 = Math.max(...times);
  const left = ml + 24; const right = width - mr - 24;
  const xs = times.map((t) => (n === 1 || t1 === t0 ? (left + right) / 2 : left + ((t - t0) / (t1 - t0)) * (right - left)));
  const y = (v) => mt + (1 - v / 100) * (H - mt - mb);
  const visible = colored.filter((r) => !hidden.has(r.key));
  const selIdx = Math.max(0, snapshots.findIndex((s) => s.label === selected));

  const openRow = (row) => onOpen({
    title: row.name,
    sub: `Reported completion ${fmtPct(row.values[selIdx])} as of ${snapLabel(snapshots[selIdx])}.`,
    list: snapshots[selIdx].projects.filter((d) => groupDef.of(d) === row.key),
  });
  const toggle = (key) => setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const tipRows = hoverIdx === null ? [] : visible.filter((r) => r.values[hoverIdx] !== null).sort((a, b) => b.values[hoverIdx] - a.values[hoverIdx]);
  const changed = colored.filter((r) => {
    const v = r.values.filter((x) => x !== null).map(Math.round);
    return v.some((x, i) => i && x !== v[i - 1]);
  });

  return (
    <div className="sb-trend">
      <div className="sb-seg" role="group" aria-label="Group the trend by">
        {TREND_GROUPS.map((g) => (
          <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => { setGroup(g.key); setHidden(new Set()); }}>
            {g.label}
          </button>
        ))}
      </div>
      <p className="sb-trend__note">
        {group === 'project'
          ? `Reported completion of each project, taken from the percentage stated in its note.${excluded ? ` ${excluded} other projects have not reported a percentage yet, so they are not shown.` : ''}`
          : `Average reported completion of the projects in each ${groupDef.label === 'Perspective' ? 'perspective' : groupDef.label}. Projects that state no percentage count as 0% until they report one, and completed projects count as 100%.`}
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
          <div className="sb-plot" ref={boxRef}>
            <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label="Reported completion over time">
              {[0, 20, 40, 60, 80, 100].map((v) => (
                <g key={v}>
                  <line className="sb-gridline" x1={ml} x2={width - mr} y1={y(v)} y2={y(v)} />
                  <text className="sb-axis" x={ml - 8} y={y(v) + 4} textAnchor="end">{v}%</text>
                </g>
              ))}
              {snapshots.map((s, i) => (
                <text key={s.label} className="sb-axis" x={xs[i]} y={H - mb + 22} textAnchor="middle">{shortDate(s)}</text>
              ))}
              <line className="sb-selline" x1={xs[selIdx]} x2={xs[selIdx]} y1={mt} y2={H - mb} />
              {hoverIdx !== null && <line className="sb-hoverline" x1={xs[hoverIdx]} x2={xs[hoverIdx]} y1={mt} y2={H - mb} />}
              {snapshots.map((s, i) => {
                const lb = i ? (xs[i - 1] + xs[i]) / 2 : ml;
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
                const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
                const last = fmtPct(r.values.filter((v) => v !== null).at(-1));
                return (
                  <g key={r.key} className="sb-line" tabIndex={0} role="button" aria-label={`${r.name}, ${last}. Select to see its projects`}
                    onClick={() => openRow(r)} onKeyDown={activate(() => openRow(r))}>
                    <title>{`${r.name}: ${last}. Select to see its projects`}</title>
                    {pts.length > 1 && <path className="sb-line__hit" d={d} />}
                    {pts.length > 1 && <path className="sb-line__vis" d={d} stroke={r.color} />}
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
