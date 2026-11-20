import { useEffect, useRef } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, shortName } from './scoreboardData';

// Colors for the progress chart (ApexCharts needs real colors, not CSS variables)
const COMPLETED = '#1b5e20';
const MUTED = '#6b6478';
const FONT = 'Roboto, "Segoe UI", system-ui, sans-serif';

const tierName = (tier) => (tier === '–' ? 'No tier' : `Class ${tier}`);
const isDone = (d) => category(d) === 'completed';
// A project's progress for the average: completed = 100%, otherwise its reported % (none yet = 0%)
const progressOf = (d) => (isDone(d) ? 100 : Math.max(0, Math.min(100, d.pct || 0)));
const round = (x) => Math.round(x);
const snapShort = (s) => (s?.date
  ? new Date(`${s.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  : s?.label || '');

/**
 * Everything that explains a tier's "completed" share in one update: the counts, the change since
 * the update before, what the next completions would bring, and the tier's average progress.
 * `history` = the snapshots up to the one being viewed (oldest first); the last one is "now".
 */
export function tierStats(tier, history) {
  const now = history.at(-1)?.projects.filter((d) => d.tier === tier) || [];
  const prevSnap = history.length > 1 ? history.at(-2) : null;
  const prev = prevSnap ? prevSnap.projects.filter((d) => d.tier === tier) : null;
  const n = now.length;
  const done = now.filter(isDone);
  const pct = n ? round((done.length / n) * 100) : 0;
  const prevDone = prev ? prev.filter(isDone).length : null;
  const prevPct = prev && prev.length ? round((prevDone / prev.length) * 100) : null;
  // The next round 10% above the current share, and how many more completions it takes
  const goal = Math.min(100, (Math.floor(pct / 10) + 1) * 10);
  const forGoal = Math.max(0, Math.ceil((goal / 100) * n - 1e-9) - done.length);
  return {
    name: tierName(tier),
    list: now,
    n,
    done,
    pct,
    exact: n ? (done.length / n) * 100 : 0,
    prevSnap,
    prevDone,
    prevPct,
    nextPct: n && done.length < n ? round(((done.length + 1) / n) * 100) : null,
    goal,
    forGoal,
    avg: n ? round(now.reduce((sum, d) => sum + progressOf(d), 0) / n) : 0,
    // The status of the tier's projects now (only statuses that have projects)
    statuses: CATEGORIES.map((c) => ({ ...c, list: now.filter((d) => category(d) === c.key) })).filter((c) => c.list.length),
    // The completed share of every update so far, oldest first (the last 8 are shown)
    weekly: history.map((s) => {
      const list = s.projects.filter((d) => d.tier === tier);
      const k = list.filter(isDone).length;
      return { snap: s, label: snapShort(s), done: k, pct: list.length ? round((k / list.length) * 100) : 0 };
    }),
  };
}

/**
 * The "Why 9%?" card shown when hovering the tier's completed share: the formula, the status of the
 * tier's projects (with the completed ones by name), the completed share week by week, the change
 * since the last update and what the next completion brings.
 */
export function TierWhy({ stats, snapLabel }) {
  const { name, n, done, pct, exact, prevSnap, prevDone, prevPct, nextPct, goal, forGoal, avg, statuses, weekly } = stats;
  const diff = prevDone === null ? null : done.length - prevDone;
  const weeks = weekly.slice(-8);
  return (
    <div className="sb-why" role="tooltip">
      <div className="sb-why__title">Why {pct}% completed?</div>
      <p><b>{done.length}</b> of <b>{n}</b> {name} project{n === 1 ? ' is' : 's are'} completed.</p>
      <div className="sb-why__math">{done.length} ÷ {n} = {exact.toFixed(1)}% → <b>{pct}%</b></div>

      <div className="sb-why__sub">Project status</div>
      <div className="sb-why__stack" aria-hidden="true">
        {statuses.map((c) => <i key={c.key} style={{ flexGrow: c.list.length, background: c.color }} />)}
      </div>
      <ul className="sb-why__status">
        {statuses.map((c) => (
          <li key={c.key}><i style={{ background: c.color }} /><span>{c.label}</span><b>{c.list.length}</b><em>{round((c.list.length / n) * 100)}%</em></li>
        ))}
      </ul>
      {done.length > 0 && (
        <div className="sb-why__done">
          {done.slice(0, 3).map((d) => <span key={d.row}>✓ {shortName(d.name)}</span>)}
          {done.length > 3 && <span>+{done.length - 3} more completed</span>}
        </div>
      )}

      {weeks.length > 1 && (
        <>
          <div className="sb-why__sub">Completed each week</div>
          <div className="sb-why__weeks" aria-label="Completed share each week">
            {weeks.map((w, i) => (
              <div key={w.snap.label} className={i === weeks.length - 1 ? 'is-now' : ''} title={`${snapLabel(w.snap)}: ${w.pct}% (${w.done} completed)`}>
                <b>{w.pct}%</b>
                <span><i style={{ height: `${Math.max(w.pct, 2)}%` }} /></span>
                <small>{w.label}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {diff !== null && (
        <p className={`sb-why__delta${diff > 0 ? ' is-up' : ''}`}>
          {diff > 0 ? `▲ +${diff} completed since ${snapLabel(prevSnap)} (was ${prevPct}%)`
            : diff < 0 ? `▼ ${diff} since ${snapLabel(prevSnap)} (was ${prevPct}%)`
              : `No new completions since ${snapLabel(prevSnap)}`}
        </p>
      )}
      {nextPct !== null && (
        <p>Next: <b>1 more</b> completion → <b>{nextPct}%</b>{forGoal > 1 ? <> · <b>{forGoal} more</b> to reach {goal}%</> : null}</p>
      )}
      <p>Average progress of the tier: <b>{avg}%</b> <small>(completed = 100%, others as reported)</small></p>
      <div className="sb-why__hint">Click for the full progress story</div>
    </div>
  );
}

/**
 * "Tier progress" window: how the tier's completed share and average progress moved over the
 * updates, which projects were completed (and in which update), which are closest to completion,
 * and the status breakdown. Selecting a project list opens it in the project dialog (onOpen).
 */
export function TierInsight({ tier, history, onClose, onOpen, snapLabel }) {
  const ref = useRef(null);
  useEffect(() => {
    const dlg = ref.current;
    if (tier && !dlg.open) dlg.showModal();
    if (!tier && dlg.open) dlg.close();
  }, [tier]);

  const stats = tier ? tierStats(tier, history) : null;
  const points = tier ? history.map((s) => {
    const list = s.projects.filter((d) => d.tier === tier);
    return {
      snap: s,
      label: snapShort(s),
      pct: list.length ? round((list.filter(isDone).length / list.length) * 100) : 0,
      done: list.filter(isDone).length,
      n: list.length,
      // That week's status of every project in the tier (for the tooltip)
      statuses: CATEGORIES.map((c) => ({ ...c, list: list.filter((d) => category(d) === c.key) })).filter((c) => c.list.length),
    };
  }) : [];
  // Tooltip of a week: the completed share, then the status of all the tier's projects that week
  const weekTip = ({ dataPointIndex }) => {
    const p = points[dataPointIndex];
    if (!p) return '';
    const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const prev = points[dataPointIndex - 1];
    const diff = prev ? p.done - prev.done : null;
    const change = diff === null ? 'First update'
      : diff > 0 ? `▲ ${diff} more completed than ${prev.label}` : diff < 0 ? `▼ ${-diff} fewer than ${prev.label}` : `No new completions since ${prev.label}`;
    const bar = p.statuses.map((c) => `<i style="flex-grow:${c.list.length};background:${c.color}"></i>`).join('');
    const rows = p.statuses.map((c) => `<li><i style="background:${c.color}"></i><span>${esc(c.label)}</span><b>${c.list.length}</b><em>${p.n ? round((c.list.length / p.n) * 100) : 0}%</em></li>`).join('');
    const done = p.statuses.find((c) => c.key === 'completed');
    const names = done ? `<div class="sb-weektip__done">✓ ${done.list.slice(0, 4).map((d) => esc(shortName(d.name))).join('<br>✓ ')}${done.list.length > 4 ? `<br>+${done.list.length - 4} more` : ''}</div>` : '';
    return `<div class="sb-weektip"><b class="sb-weektip__date">${esc(snapLabel(p.snap))}</b>`
      + `<div class="sb-weektip__pct"><b>${p.pct}%</b> completed · ${p.done} of ${p.n} projects</div>`
      + `<div class="sb-weektip__change">${esc(change)}</div>`
      + `<div class="sb-weektip__bar">${bar}</div><ul>${rows}</ul>${names}</div>`;
  };
  // The update in which each completed project first showed as completed
  const completedIn = (d) => {
    const k = history.findIndex((s) => s.projects.some((p) => p.row === d.row && isDone(p)));
    return k >= 0 ? history[k] : null;
  };
  const closest = stats ? stats.list.filter((d) => !isDone(d)).sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 6) : [];
  const breakdown = stats ? CATEGORIES.map((c) => ({ ...c, list: stats.list.filter((d) => category(d) === c.key) })).filter((c) => c.list.length) : [];

  const options = {
    chart: { type: 'area', toolbar: { show: false }, zoom: { enabled: false }, fontFamily: FONT, animations: { speed: 500 } },
    colors: [COMPLETED],
    stroke: { curve: 'smooth', width: 3 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.04 } },
    markers: { size: 5, strokeColors: '#ffffff', strokeWidth: 2, hover: { size: 7 } },
    // Each week's completed share on its point
    dataLabels: {
      enabled: true,
      formatter: (v) => `${v}%`,
      offsetY: -6,
      // A green label with white text (foreColor is the text color on the label's background)
      style: { fontSize: '11.5px', fontWeight: 800, colors: [COMPLETED] },
      background: { enabled: true, foreColor: '#ffffff', borderWidth: 0, borderRadius: 4, padding: 4, opacity: 1 },
    },
    xaxis: { categories: points.map((p) => p.label), labels: { style: { colors: MUTED, fontSize: '11px' } }, axisTicks: { show: false } },
    yaxis: { min: 0, max: 100, tickAmount: 4, labels: { formatter: (v) => `${round(v)}%`, style: { colors: MUTED, fontSize: '11px' } } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3 },
    legend: { show: false },
    tooltip: { custom: weekTip },
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog ref={ref} className="sb-dialog sb-insight" aria-labelledby="sb-insight-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {stats && (
        <>
          <div className="sb-dialog__head">
            <div className="sb-insight__head">
              <div className="sb-insight__ring" style={{ '--p': stats.exact }}><b>{stats.pct}%</b><small>completed</small></div>
              <div>
                <h3 id="sb-insight-title">{stats.name}: progress</h3>
                <p>{stats.done.length} of {stats.n} projects completed ({stats.done.length} ÷ {stats.n} = {stats.exact.toFixed(1)}%) · average progress {stats.avg}%</p>
              </div>
            </div>
            <button type="button" className="sb-dialog__close" onClick={onClose}>Close</button>
          </div>
          <div className="sb-dialog__body">
            <div className="sb-insight__kpis">
              <div><span>Completed</span><b>{stats.done.length}</b><small>of {stats.n}</small></div>
              <div><span>Next completion</span><b>{stats.nextPct === null ? '—' : `${stats.nextPct}%`}</b><small>{stats.nextPct === null ? 'all completed' : '1 more project'}</small></div>
              <div><span>Average progress</span><b>{stats.avg}%</b><small>all projects</small></div>
            </div>

            {points.length > 1 && (
              <div className="sb-insight__card">
                <div className="sb-insight__label">Completed projects every week <span>share of the tier&apos;s projects completed</span></div>
                <Chart type="area" height={240} options={options}
                  series={[{ name: 'Completed', data: points.map((p) => p.pct) }]} />
              </div>
            )}

            <div className="sb-insight__cols">
              <div className="sb-insight__card">
                <div className="sb-insight__label">Completed projects <span>{stats.done.length}</span></div>
                {stats.done.length === 0 && <p className="sb-insight__empty">None yet in {stats.name}.</p>}
                <ul className="sb-insight__list">
                  {stats.done.map((d) => {
                    const when = completedIn(d);
                    return (
                      <li key={d.row}>
                        <button type="button" onClick={() => onOpen({ title: shortName(d.name), sub: `${stats.name} · completed`, list: [d] })}>
                          <span className="sb-insight__check">✓</span>
                          <span className="sb-insight__name">{shortName(d.name)}<small>{d.lead ? `Lead ${d.lead}` : ''}</small></span>
                          <small className="sb-insight__when">{when ? `Completed by ${snapLabel(when)}` : ''}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="sb-insight__card">
                <div className="sb-insight__label">Closest to completion <span>next to move the %</span></div>
                {closest.length === 0 && <p className="sb-insight__empty">Every project in {stats.name} is completed.</p>}
                <ul className="sb-insight__list">
                  {closest.map((d) => {
                    const c = CATEGORIES.find((x) => x.key === category(d));
                    return (
                      <li key={d.row}>
                        <button type="button" onClick={() => onOpen({ title: shortName(d.name), sub: `${stats.name} · ${c.label}`, list: [d] })}>
                          <span className="sb-insight__name">{shortName(d.name)}<small>{c.label}{d.lead ? ` · Lead ${d.lead}` : ''}</small></span>
                          <span className="sb-insight__prog" style={{ '--c': c.color }}>
                            <i style={{ width: `${d.pct || 0}%` }} /><b>{d.pct ? `${d.pct}%` : 'no % yet'}</b>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className="sb-insight__card">
              <div className="sb-insight__label">Status of the {stats.n} projects</div>
              <div className="sb-insight__stack" aria-hidden="true">
                {breakdown.map((c) => <i key={c.key} style={{ flexGrow: c.list.length, background: c.color }} />)}
              </div>
              <div className="sb-insight__chips">
                {breakdown.map((c) => (
                  <button key={c.key} type="button" className="sb-chip"
                    onClick={() => onOpen({ title: `${stats.name}: ${c.label.toLowerCase()}`, sub: `${c.list.length} of ${stats.n} ${stats.name} projects`, list: c.list })}>
                    <i style={{ background: c.color }} />{c.label} <b>{c.list.length}</b>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
