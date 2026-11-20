import { useEffect, useRef } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, shortName, stageColor, STAGE_LABEL } from './scoreboardData';
import { shownWeeks, snapShort } from './TierInsight';

const MUTED = '#6b6478';
const FONT = 'Roboto, "Segoe UI", system-ui, sans-serif';
const round = (x) => Math.round(x);
const clampPct = (v) => (v === null || v === undefined ? null : Math.max(0, Math.min(100, round(v))));
const catOf = (d) => CATEGORIES.find((c) => c.key === category(d));
const stageName = (s) => STAGE_LABEL[s] || s || '—';
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * One WIG week by week: its progress %, status and stage in every update up to the one being viewed
 * (oldest first; skipped weeks left out), plus the change since the update before.
 * `history` = the snapshots up to "Status as of"; `d` = the WIG as of that update.
 */
export function wigStats(d, history) {
  const weeks = shownWeeks(history).map((s) => {
    const p = s.projects.find((x) => x.row === d.row) || null;
    return p && { snap: s, label: snapShort(s), pct: clampPct(p.pct), cat: catOf(p), stage: p.stage, note: p.note, noteFrom: p.noteFrom };
  }).filter(Boolean);
  const now = weeks.at(-1) || null;
  const prev = weeks.length > 1 ? weeks.at(-2) : null;
  const pct = clampPct(d.pct) ?? 0;
  const diff = prev ? pct - (prev.pct ?? 0) : null;
  // The last week the % went up
  let movedIn = null;
  for (let i = weeks.length - 1; i > 0; i -= 1) {
    if ((weeks[i].pct ?? 0) > (weeks[i - 1].pct ?? 0)) { movedIn = weeks[i]; break; }
  }
  return { name: shortName(d.name), cat: catOf(d), pct, stage: d.stage, weeks, now, prev, diff, movedIn };
}

const changeText = (diff, prev) => {
  if (diff === null) return 'First update';
  if (diff > 0) return `▲ +${diff} pts since ${prev.label}`;
  if (diff < 0) return `▼ ${diff} pts since ${prev.label}`;
  return `No change since ${prev.label}`;
};

/** Hover card of a WIG gauge: its status and progress now, and its progress week by week. */
export function WigWhy({ stats }) {
  const { cat, pct, stage, weeks, prev, diff, now } = stats;
  const shown = weeks.slice(-8);
  return (
    <div className="sb-why sb-why--wig" role="tooltip" style={{ '--c': cat.color }}>
      <div className="sb-why__sub sb-why__sub--first">Progress status</div>
      <div className="sb-wigwhy__head">
        <span className="sb-wigwhy__chip" style={{ background: cat.color }}>{cat.label}</span>
        <span className="sb-wigwhy__stage"><i style={{ background: stageColor(stage) }} />{stageName(stage)}</span>
        <b className="sb-wigwhy__pct">{pct}%</b>
      </div>
      <div className="sb-wigwhy__bar"><i style={{ width: `${pct}%`, background: cat.color }} /></div>
      <p className={`sb-why__delta${diff > 0 ? ' is-up' : ''}`}>{changeText(diff, prev)}</p>
      {now?.note && <p className="sb-wigwhy__note">“{clip(now.note, 130)}”</p>}

      {shown.length > 1 && (
        <>
          <div className="sb-why__sub">Progress each week</div>
          <div className="sb-why__weeks" aria-label="Progress each week">
            {shown.map((w, i) => (
              <div key={w.snap.label} className={i === shown.length - 1 ? 'is-now' : ''}>
                <b>{w.pct === null ? '–' : `${w.pct}%`}</b>
                <span><i style={{ height: `${Math.max(w.pct ?? 0, 2)}%`, background: w.cat.color }} /></span>
                <small>{w.label}</small>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sb-why__hint">Click for the full progress story</div>
    </div>
  );
}

/**
 * "WIG progress" window: the WIG's progress % every week (tooltip: that week's status, stage and
 * note), the change since the last update, and every update's note, newest first.
 */
export function WigInsight({ wig, history, onClose, onOpen, snapLabel }) {
  const ref = useRef(null);
  useEffect(() => {
    const dlg = ref.current;
    if (wig && !dlg.open) dlg.showModal();
    if (!wig && dlg.open) dlg.close();
  }, [wig]);

  const stats = wig ? wigStats(wig, history) : null;
  const weeks = stats ? stats.weeks : [];
  // Every update that has its own note (a week without one repeats the note before), newest first
  const updates = weeks.filter((w) => w.note && !w.noteFrom).reverse();

  const weekTip = ({ dataPointIndex }) => {
    const w = weeks[dataPointIndex];
    if (!w) return '';
    const prev = weeks[dataPointIndex - 1];
    const diff = prev ? (w.pct ?? 0) - (prev.pct ?? 0) : null;
    return `<div class="sb-weektip"><b class="sb-weektip__date">${esc(snapLabel(w.snap))}</b>`
      + `<div class="sb-weektip__pct"><b style="color:${w.cat.color}">${w.pct === null ? 'no %' : `${w.pct}%`}</b> progress</div>`
      + `<div class="sb-weektip__change">${esc(changeText(diff, prev))}</div>`
      + `<ul><li><i style="background:${w.cat.color}"></i><span>Status</span><b>${esc(w.cat.label)}</b><em></em></li>`
      + `<li><i style="background:${stageColor(w.stage)}"></i><span>Stage</span><b>${esc(stageName(w.stage))}</b><em></em></li></ul>`
      + (w.note ? `<div class="sb-weektip__note">${esc(clip(w.note, 160))}</div>` : '')
      + '</div>';
  };

  const color = stats?.cat.color;
  // SVG markers need real colors, not CSS variables
  const real = (c) => {
    const m = /^var\((--[^)]+)\)$/.exec(c || '');
    // Read from the dialog: the status colors are defined on the page's elements, not on <html>
    return m && ref.current ? getComputedStyle(ref.current).getPropertyValue(m[1]).trim() || '#888' : c;
  };
  const options = {
    chart: { type: 'area', toolbar: { show: false }, zoom: { enabled: false }, fontFamily: FONT, animations: { speed: 500 } },
    colors: ['#57177a'],
    stroke: { curve: 'smooth', width: 3 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.04 } },
    // Each point in that week's status color
    markers: {
      size: 6, strokeColors: '#ffffff', strokeWidth: 2, hover: { size: 8 },
      discrete: weeks.map((w, i) => ({ seriesIndex: 0, dataPointIndex: i, fillColor: real(w.cat.color), strokeColor: '#ffffff', size: 6 })),
    },
    dataLabels: {
      enabled: true,
      formatter: (v) => `${v}%`,
      offsetY: -6,
      style: { fontSize: '11.5px', fontWeight: 800, colors: ['#57177a'] },
      background: { enabled: true, foreColor: '#ffffff', borderWidth: 0, borderRadius: 4, padding: 4, opacity: 1 },
    },
    xaxis: { categories: weeks.map((w) => w.label), labels: { style: { colors: MUTED, fontSize: '11px' } }, axisTicks: { show: false } },
    yaxis: { min: 0, max: 100, tickAmount: 4, labels: { formatter: (v) => `${round(v)}%`, style: { colors: MUTED, fontSize: '11px' } } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3 },
    legend: { show: false },
    tooltip: { custom: weekTip },
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog ref={ref} className="sb-dialog sb-insight" aria-labelledby="sb-wiginsight-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {stats && (
        <>
          <div className="sb-dialog__head">
            <div className="sb-insight__head">
              <div className="sb-insight__ring" style={{ '--p': stats.pct, '--rc': color }}><b>{stats.pct}%</b><small>progress</small></div>
              <div>
                <h3 id="sb-wiginsight-title">{stats.name}</h3>
                <p>WIG · Class {wig.tier} · {stats.cat.label} · {stageName(stats.stage)}{wig.lead ? ` · Lead ${wig.lead}` : ''}</p>
              </div>
            </div>
            <button type="button" className="sb-dialog__close" onClick={onClose}>Close</button>
          </div>
          <div className="sb-dialog__body">
            {weeks.length > 1 && (
              <div className="sb-insight__card">
                <div className="sb-insight__label">Progress every week <span>dots show that week&apos;s status</span></div>
                <Chart type="area" height={240} options={options}
                  series={[{ name: 'Progress', data: weeks.map((w) => w.pct ?? 0) }]} />
              </div>
            )}

            <div className="sb-insight__card">
              <div className="sb-insight__label">Updates <span>newest first</span></div>
              {updates.length === 0 && <p className="sb-insight__empty">No status notes yet.</p>}
              <ul className="sb-wigupdates">
                {updates.map((w) => (
                  <li key={w.snap.label}>
                    <div className="sb-wigupdates__top">
                      <b>{snapLabel(w.snap)}</b>
                      <span className="sb-wigwhy__chip" style={{ background: w.cat.color }}>{w.pct === null ? w.cat.label : `${w.pct}%`}</span>
                      <span className="sb-wigwhy__stage"><i style={{ background: stageColor(w.stage) }} />{stageName(w.stage)}</span>
                    </div>
                    <p>{w.note}</p>
                  </li>
                ))}
              </ul>
              <button type="button" className="sb-wigupdates__open"
                onClick={() => onOpen({ title: stats.name, sub: `WIG · ${stats.cat.label} · ${stats.pct}% complete`, list: [wig] })}>
                Open project details →
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
