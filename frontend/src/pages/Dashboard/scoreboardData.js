// Calculations for the dashboard scoreboard (status categories, "worth raising" items, trend series).
// Projects come from GET /api/strategy/scoreboard; see backend scoreboard.service.

/**
 * Full project lists per week from the compact API response: the static `projects` merged with each
 * week's `items`. A carried-forward note (`from`) is taken from the week it was written in.
 * Returns [{ label, date, projects }] oldest first.
 */
export function expandSnapshots(data) {
  const byLabel = new Map(data.snapshots.map((s) => [s.label, s]));
  // Progress only goes up: a week whose note gives no percentage (or a lower one, e.g. a correction)
  // keeps the highest percentage reported so far; once completed, a project stays at 100%
  const best = data.projects.map(() => null);
  return data.snapshots.map((s) => ({
    label: s.label,
    date: s.date,
    projects: data.projects.map((p, i) => {
      const it = s.items[i];
      const note = it.from ? byLabel.get(it.from)?.items[i]?.note || '' : it.note || '';
      const reported = it.stage === 'Complete' ? 100 : it.pct ?? null;
      if (reported !== null) best[i] = Math.max(best[i] ?? 0, reported);
      return {
        ...p,
        note,
        noteFrom: it.from || null,
        stage: it.stage,
        pct: best[i],
        pctInNote: reported,
        waiting: it.waiting || null,
        noSavings: Boolean(it.noSavings),
      };
    }),
  }));
}

// Each project is in exactly one category: completed first, then its traffic light
export const CATEGORIES = [
  { key: 'completed', label: 'Completed', color: 'var(--sb-completed)', empty: 'No projects are completed yet.' },
  { key: 'ontrack', label: 'On track', color: 'var(--sb-ontrack)', empty: 'No projects are on track.' },
  { key: 'behind', label: 'Behind', color: 'var(--sb-behind)', empty: 'No projects are behind.' },
  { key: 'atrisk', label: 'At risk', color: 'var(--sb-atrisk)', empty: 'No projects are at risk.' },
  { key: 'unreported', label: 'No traffic light', color: 'var(--sb-unreported)', empty: 'Every project has a traffic light.' },
];

export function category(d) {
  // A Behind / At Risk traffic light is what the department reports, so it counts even when the
  // note says the project is completed
  if (d.status === 'Behind') return 'behind';
  if (d.status === 'At Risk' || d.status === 'Off Track') return 'atrisk';
  if (d.stage === 'Complete') return 'completed';
  if (d.status === 'On Track') return 'ontrack';
  return 'unreported'; // empty, "Clear", or a value that isn't a traffic light
}

export const STAGE_COLORS = {
  Complete: 'var(--sb-st-complete)',
  'Rolling out': 'var(--sb-st-rollout)',
  Testing: 'var(--sb-st-testing)',
  'In build': 'var(--sb-st-build)',
  Review: 'var(--sb-st-review)',
  Sourcing: 'var(--sb-st-sourcing)',
  Waiting: 'var(--sb-st-waiting)',
  'Project China': 'var(--sb-st-china)',
  // Its own neutral, so it isn't confused with Review (both used to be the same grey)
  'In progress': 'var(--sb-st-progress)',
};
export const stageColor = (stage) => STAGE_COLORS[stage] || 'var(--sb-st-review)';
export const STAGE_LABEL = { Waiting: 'Waiting on others', 'Project China': 'In Project China' };

/**
 * Whole-number percentages of `total` that add up to exactly 100 when the counts cover everything
 * (largest remainder). A count above zero never shows as 0%: it gets at least 1%, taken from the
 * largest share, so "1 of 293 projects" reads 1% and the cards still total 100%.
 */
export function shares(counts, total) {
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const out = raw.map(Math.floor);
  let left = Math.round((counts.reduce((a, b) => a + b, 0) / total) * 100) - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left > 0 && j < order.length; j++, left--) out[order[j][1]]++;
  counts.forEach((n, i) => {
    if (n <= 0 || out[i] > 0) return;
    const biggest = out.reduce((best, v, k) => (v > out[best] ? k : best), 0);
    if (out[biggest] > 1) { out[biggest]--; out[i] = 1; }
  });
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-09" -> Date(2026, 8, 1); null for text like "CDD dependent"
export function monthDate(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(value || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null;
}
export const fmtMonth = (d) => `${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`;
export function fmtWhen(value) {
  const d = monthDate(value);
  return d ? fmtMonth(d) : (value || 'Not set');
}
// Tiers in display order: Class S first (the top tier), then A, B, C… alphabetically, "No tier" last
export function tierOrder(a, b) {
  const rank = (t) => (t === 'S' ? -1 : t === '–' ? 99 : t.charCodeAt(0));
  return rank(a) - rank(b);
}
export const tiersOf = (projects) => [...new Set(projects.map((d) => d.tier))].sort(tierOrder);

export const shortName =(name) => String(name || '').replace(/\s*\(.*\)\s*$/, '').trim();

// The date a snapshot stands for: its column date, or today for a sheet without dated updates
export const snapshotDate = (snap) => (snap?.date ? new Date(`${snap.date}T00:00:00`) : new Date());

/**
 * Cards for "Worth raising at Execom", derived from the sheet as of `asOf`. Each item:
 * { tone, title, text, list } where `list` are the projects behind it.
 */
export function watchItems(projects, asOf) {
  const items = [];
  const open = projects.filter((d) => d.stage !== 'Complete');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const names = (list, extra = () => '') => `${list.map((d) => `${shortName(d.name)}${extra(d)}`).join(', ')}.`;

  const flagged = projects.filter((d) => ['behind', 'atrisk'].includes(category(d)));
  if (flagged.length) {
    items.push({
      tone: 'stop',
      label: 'Behind or at risk',
      title: `${plural(flagged.length, 'project is', 'projects are')} reported behind or at risk`,
      text: names(flagged, (d) => ` (${d.status.toLowerCase()})`),
      list: flagged,
    });
  }

  const thisMonth = open.filter((d) => {
    const e = monthDate(d.done);
    return e && e.getFullYear() === asOf.getFullYear() && e.getMonth() === asOf.getMonth();
  });
  if (thisMonth.length) {
    items.push({
      tone: 'stop',
      label: 'Due this month',
      title: `${plural(thisMonth.length, 'project is', 'projects are')} due this month`,
      text: names(thisMonth, (d) => (d.waiting ? ` (waiting on ${d.waiting})` : '')),
      list: thisMonth,
    });
  }

  const overdue = open.filter((d) => {
    const e = monthDate(d.done);
    return e && new Date(e.getFullYear(), e.getMonth() + 1, 1) <= asOf;
  });
  if (overdue.length) {
    items.push({
      tone: 'stop',
      label: 'Past the completion date',
      title: `${plural(overdue.length, 'project is', 'projects are')} past the completion date`,
      text: names(overdue, (d) => ` (due ${fmtWhen(d.done)})`),
      list: overdue,
    });
  }

  const cost = projects.filter((d) => d.noSavings);
  if (cost.length) {
    items.push({
      tone: 'warn',
      label: '0% savings so far',
      title: `${plural(cost.length, 'cost-reduction project shows', 'cost-reduction projects show')} 0% savings so far`,
      text: `${cost[0].kpi}${cost[0].target ? ` (target ${cost[0].target.replace(/\n/g, ', ')})` : ''}: ${names(cost)}`,
      list: cost,
    });
  }

  const china = open.filter((d) => d.stage === 'Project China');
  if (china.length) {
    items.push({
      tone: 'china',
      label: 'Folded into Project China',
      title: `${plural(china.length, 'project is', 'projects are')} folded into Project China`,
      text: 'Their progress now depends on that umbrella project.',
      list: china,
    });
  }

  const sourcing = open.filter((d) => d.stage === 'Sourcing');
  if (sourcing.length) {
    items.push({
      tone: 'sourcing',
      label: 'Still sourcing suppliers',
      title: `${plural(sourcing.length, 'project is', 'projects are')} still sourcing suppliers`,
      text: names(sourcing, (d) => ` (launched ${fmtWhen(d.launch)})`),
      list: sourcing,
    });
  }

  const waiting = open.filter((d) => d.stage === 'Waiting' && !thisMonth.includes(d));
  if (waiting.length) {
    items.push({
      tone: 'waiting',
      label: 'Waiting on others',
      title: `${plural(waiting.length, 'project is', 'projects are')} waiting on others`,
      text: names(waiting, (d) => (d.waiting ? ` (waiting on ${d.waiting})` : '')),
      list: waiting,
    });
  }

  const horizon = new Date(asOf.getTime() + 90 * 864e5);
  const soon = open
    .filter((d) => { const e = monthDate(d.done); return e && e >= new Date(asOf.getFullYear(), asOf.getMonth(), 1) && e <= horizon; })
    .sort((a, b) => monthDate(a.done) - monthDate(b.done));
  if (soon.length) {
    items.push({
      tone: 'testing',
      label: 'Due within 90 days',
      title: `${plural(soon.length, 'project is', 'projects are')} due within 90 days`,
      text: names(soon, (d) => ` (${fmtWhen(d.done)})`),
      list: soon,
    });
  }

  const noted = projects.filter((d) => d.execomNotes);
  if (noted.length) {
    items.push({
      tone: 'note',
      label: 'With Execom notes',
      title: `${plural(noted.length, 'project has', 'projects have')} Execom notes`,
      text: names(noted),
      list: noted,
    });
  }

  const unreported = projects.filter((d) => category(d) === 'unreported');
  if (unreported.length) {
    items.push({
      tone: 'muted',
      label: 'No traffic light',
      title: `${plural(unreported.length, 'project has', 'projects have')} no traffic light`,
      text: 'The Traffic Light cell is empty in the sheet, so they are not counted as on track, behind or at risk.',
      list: unreported,
    });
  }
  return items;
}

// ---- Trend over time ----
export const TREND_GROUPS = [
  { key: 'persp', label: 'Perspective', plural: 'perspectives', of: (d) => d.persp },
  { key: 'kra', label: 'KRA', plural: 'KRAs', of: (d) => d.kra || 'Not set' },
  { key: 'kpi', label: 'KPI', plural: 'KPIs', of: (d) => d.kpi || 'Not set' },
  { key: 'project', label: 'Project', plural: 'projects', of: (d) => d.name },
];

// The project's progress as of a week: the highest % reported so far (see expandSnapshots), 0 before any
const progress = (d) => d.pct || 0;

/**
 * Lines for the trend chart: [{ key, name, values: [number per snapshot] }]. Projects: their progress,
 * only those that ever reported a percentage. Groups: average progress of their projects (no
 * percentage yet = 0%, completed = 100%). Progress never goes down, so neither does any line; the
 * chart draws each line from 0% at the start. Order follows the sheet, so each line keeps its color.
 */
export function trendSeries(snapshots, groupKey) {
  const group = TREND_GROUPS.find((g) => g.key === groupKey);
  const keys = [];
  snapshots.forEach((s) => s.projects.forEach((d) => { const k = group.of(d); if (!keys.includes(k)) keys.push(k); }));
  const rows = keys.map((k) => {
    const values = snapshots.map((s) => {
      const members = s.projects.filter((d) => group.of(d) === k);
      if (!members.length) return null;
      if (groupKey === 'project') return progress(members[0]);
      return members.reduce((sum, d) => sum + progress(d), 0) / members.length;
    });
    return { key: k, name: groupKey === 'project' ? shortName(k) : k, values };
  });
  if (groupKey !== 'project') return { rows, excluded: 0 };
  const shown = rows.filter((r) => r.values.some((v) => v !== null && v > 0));
  return { rows: shown, excluded: rows.length - shown.length };
}
