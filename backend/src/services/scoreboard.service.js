const { getScorecardForUser } = require('./scorecard.service');

/**
 * Dashboard scoreboard of one scorecard sheet: every project the user may see, once per dated
 * status-update column ("1-Oct-26", "30-Sep-26", …), so the dashboard can show any week and the trend.
 *
 * Read from Excel as entered: Traffic Light, Tier, dates, notes, and the optional Stage and
 * "Waiting On" columns. When a sheet has no Stage column the stage is estimated from the note's
 * wording (and marked `stageEstimated`); completion % is read from notes like "At 73% Completion".
 */

const STAGES = ['Complete', 'Rolling out', 'Testing', 'In build', 'Review', 'Sourcing', 'Waiting', 'Project China', 'In progress'];

// "On Track", "Behind", "At Risk", "Off Track"; "" when the Traffic Light cell is empty
function normalizeLight(value) {
  const v = String(value || '').trim().toLowerCase();
  // "Clear" (in the Traffic Light dropdown) means no status is reported
  if (!v || v === 'clear' || v === 'none' || v === 'n/a') return '';
  if (/on[\s-]?track|green|good/.test(v)) return 'On Track';
  if (/behind|amber|yellow/.test(v)) return 'Behind';
  if (/risk/.test(v)) return 'At Risk';
  if (/off[\s-]?track|delayed|red|stop/.test(v)) return 'Off Track';
  return String(value).trim();
}

// A week's completion % comes from its update cell. The main way: the cell starts with the number,
// e.g. "40% - Ongoing coordination with PLDT" (also "- 40% …", "• 40%: …"). A leading percentage of
// savings ("5% reduction …", "10% savings …") is not progress. As before, notes written as
// "At 73% Completion", "HRIS at 96.22%" or "Completion: 91.20%" also count.
// Other percentages inside the text ("with 5% reduction", "83% used storage") are not the project's progress.
const LEADING_PERCENT = /^[\s\-–•*]*(\d{1,3}(?:\.\d+)?)\s*%(?!\s*(?:reduction|savings?|saved|contribution|decrease|increase|cut|discount|off|of\s+(?:the\s+)?(?:budget|expense|cost)))/i;
function percentFrom(note) {
  const text = String(note || '');
  const m = LEADING_PERCENT.exec(text)
    || /\bat\s+(\d{1,3}(?:\.\d+)?)\s*%/i.exec(text)
    || /\bcompletion\s*:\s*(\d{1,3}(?:\.\d+)?)\s*%/i.exec(text);
  if (!m) return null;
  const pct = Math.round(Number(m[1]));
  return pct >= 0 && pct <= 100 ? pct : null;
}

// "Completed. Ongoing monitoring…" (not "Complete construction of …")
const isCompleted = (note) => /^\s*(completed|done)\b/i.test(String(note || ''));

// Matches a Stage cell to a known stage ("build" -> "In build"); unknown text is kept
function normalizeStage(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  const hit = STAGES.find((s) => s.toLowerCase() === lower)
    || (/complete|done/.test(lower) && 'Complete')
    || (/roll/.test(lower) && 'Rolling out')
    || (/test|vapt|pilot/.test(lower) && 'Testing')
    || (/build|develop|install|implement/.test(lower) && 'In build')
    || (/review|assess|study/.test(lower) && 'Review')
    || (/sourc|procure|supplier|canvass/.test(lower) && 'Sourcing')
    || (/wait|pending|hold/.test(lower) && 'Waiting')
    || (/china/.test(lower) && 'Project China');
  return hit || v;
}

// Best guess from the note (and the project name) when there is no Stage column
function estimateStage(note, pct, name = '') {
  const n = String(note || '').toLowerCase();
  if (isCompleted(note) || pct === 100) return 'Complete';
  if (/china/.test(n)) return 'Project China';
  if (/waiting for|waiting on|pending (delivery|payment|approval)/.test(n)) return 'Waiting';
  if (/sourcing|for sourcing|supplier/.test(n)) return 'Sourcing';
  if (/testing|vapt|pilot/.test(n)) return 'Testing';
  if (pct !== null && pct >= 90) return 'Rolling out';
  if (pct !== null && pct > 0) return 'In build';
  if (/review|coordinat|inventory/.test(n)) return 'Review';
  if (/deploy|install|cabling|construction|ongoing/.test(n)) return 'In build';
  if (/\breview\b/i.test(name)) return 'Review';
  return 'In progress';
}

// "waiting for payment of equipment." -> "payment of equipment"
function waitingFrom(note) {
  const m = /waiting (?:for|on)\s+(?:the\s+)?([^.\n;)]+)/i.exec(String(note || ''));
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = (word) => MONTHS.indexOf(String(word || '').slice(0, 3).toLowerCase());

/**
 * The date in an update column's header, as { y, m, d } (y may be null when the header has no year):
 * "Oct 1, 2026", "SCORECARD RESULT AS OF MAY 22, 2026", "October 2025", "Feb-26", "9-Mar", "12-Feb", "NOVEMBER".
 * Null when the header holds no date.
 */
function labelDate(label) {
  const s = String(label || '');
  let m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s); // May 22, 2026
  if (m && monthIndex(m[1]) !== -1) return { y: Number(m[3]), m: monthIndex(m[1]), d: Number(m[2]) };
  m = /\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})\b/.exec(s); // 14-Sep-26
  if (m && monthIndex(m[2]) !== -1) return { y: m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), m: monthIndex(m[2]), d: Number(m[1]) };
  m = /\b([A-Za-z]{3,9})[-\s'](\d{2}|\d{4})\b/.exec(s); // Feb-26, October 2025
  if (m && monthIndex(m[1]) !== -1) return { y: m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), m: monthIndex(m[1]), d: 1 };
  m = /\b(\d{1,2})[-\s]([A-Za-z]{3,9})\b/.exec(s); // 9-Mar
  if (m && monthIndex(m[2]) !== -1) return { y: null, m: monthIndex(m[2]), d: Number(m[1]) };
  m = /^\s*([A-Za-z]{3,9})\s*$/.exec(s); // NOVEMBER
  if (m && monthIndex(m[1]) !== -1) return { y: null, m: monthIndex(m[1]), d: 1 };
  return null;
}

/**
 * ISO dates for update columns given oldest first; a header without a year takes the year that keeps
 * the columns in order (e.g. "NOVEMBER" between "October 2025" and "Jan-26" is November 2025).
 */
function columnDates(labels) {
  const parsed = labels.map(labelDate);
  const firstYear = parsed.find((p) => p && p.y)?.y;
  let prev = null;
  return parsed.map((p) => {
    if (!p) return null;
    let { y } = p;
    if (!y) {
      y = prev ? prev.y : firstYear;
      if (!y) return null;
      if (prev && (p.m < prev.m || (p.m === prev.m && p.d < prev.d))) y += 1;
    }
    prev = { y, m: p.m, d: p.d };
    return `${y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  });
}

// "Mar-26" (as Excel shows the launch/completion month) -> "2026-03"; other text is kept as is
function monthValue(text) {
  const m = /^([A-Za-z]{3})[-\s'](\d{2}|\d{4})$/.exec(String(text || '').trim());
  if (!m) return String(text || '').trim();
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month === -1) return String(text).trim();
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// "26-27" -> "2026-2027" (the sheet's target column = the academic year)
function academicYear(label) {
  const m = /^(\d{2})-(\d{2})$/.exec(label || '');
  return m ? `20${m[1]}-20${m[2]}` : label || null;
}

// "Class S", "Class C", "B" -> "S" / "C" / "B" (any class letter the sheet uses); '' when empty or unknown
const tierLetter = (tier) => (/class\s*([a-z])\b/i.exec(tier || '')?.[1] || /^\s*([a-z])\s*$/i.exec(tier || '')?.[1] || '').toUpperCase();
const stripProject = (name) => String(name || '').replace(/^project\s+/i, '').trim();
const isCostKpi = (kpi) => /(expense|cost)/i.test(kpi || '') && /reduc|sav/i.test(kpi || '');

// The percentage in a KPI target: ">10%", "10%", "at least 15% reduction" -> 10 / 10 / 15; otherwise null
function percentTarget(target) {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(String(target || ''));
  const value = m ? Number(m[1]) : null;
  return value > 0 && value <= 100 ? value : null;
}

// Savings reported in a note: "with 5% reduction", "8% savings", "savings of 8%", "reduced by 6%" ->
// 5 / 8 / 8 / 6; "Still no reduction", "0% contribution on reduction" -> 0; null when it says nothing
function savingsFrom(note) {
  const text = String(note || '');
  const m = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:[a-z]+\s+){0,2}?(?:reduction|savings?|saved|decrease|cut)\b/i.exec(text)
    || /\b(?:reductions?|savings?|saved|reduced|decreased?|cut)\s+(?:of|by)\s+(\d{1,3}(?:\.\d+)?)\s*%/i.exec(text);
  if (m) return Number(m[1]);
  if (/\bno\s+(?:\w+\s+)?(?:reduction|savings?)\b|\b0\s*%\s*(?:contribution|reduction|savings?)/i.test(text)) return 0;
  return null;
}

/**
 * Progress of a cost-reduction project from its savings, measured against its KPI's percentage target:
 * "5% reduction" with a ">10%" target = 50%; reaching or passing the target = 100%. Only for cost KPIs
 * (expense / cost reduction or savings) whose target is a percentage; null otherwise.
 */
function savingsProgress(kpi, target, note) {
  if (!isCostKpi(kpi)) return null;
  const goal = percentTarget(target);
  const saved = goal ? savingsFrom(note) : null;
  if (saved === null) return null;
  return Math.min(100, Math.round((saved / goal) * 100));
}

/**
 * { sheet, academicYear, projects: [static fields], snapshots: [{ label, date, items }] (oldest first;
 *   items[i] belongs to projects[i]), stageColumn, canViewAll, viewingDepartments, departments }
 */
async function getScoreboardForUser(wb, user, { sheet, department, refresh } = {}) {
  const card = await getScorecardForUser(wb, user, { sheet, department, refresh });

  // Every visible project with its hierarchy (KPIs without projects aren't scoreboard items)
  const items = [];
  for (const p of card.perspectives) for (const o of p.objectives) for (const k of o.kras) for (const kpi of k.kpis) {
    for (const pr of kpi.projects) {
      items.push({
        persp: p.name === 'Unassigned' ? 'Not set' : p.name,
        obj: o.name === 'Unassigned' ? null : o.name,
        kra: k.name === 'General' ? null : k.name,
        qp: kpi.qualityPolicy || null,
        kpi: kpi.name || null,
        target: kpi.targets.map((t) => t.value).join('\n') || pr.target || null,
        // The project row's own Tier cell, as in Excel (an empty cell is "No tier", not the KPI's tier)
        tier: tierLetter(pr.tier) || '–',
        name: stripProject(pr.name),
        lead: pr.lead.join('/'),
        support: pr.support.join('/') || null,
        launch: monthValue(pr.launchDate),
        done: monthValue(pr.completionDate),
        status: normalizeLight(pr.trafficLight),
        execomNotes: pr.execomNotes || '',
        stageColumn: pr.stage,
        waitingColumn: pr.waitingOn,
        statuses: pr.statuses,
        row: pr.row,
        rowId: pr.rowId,
      });
    }
  }

  // statusLabels are newest first in the sheet; snapshots go oldest first
  const labels = [...card.statusLabels].reverse();

  // What doesn't change from week to week, sent once
  const projects = items.map((d) => ({
    persp: d.persp, obj: d.obj, kra: d.kra, qp: d.qp, kpi: d.kpi, target: d.target, tier: d.tier,
    name: d.name, lead: d.lead, support: d.support, launch: d.launch, done: d.done,
    status: d.status, execomNotes: d.execomNotes, stageEstimated: !d.stageColumn, costflag: isCostKpi(d.kpi),
    row: d.row, rowId: d.rowId,
  }));

  /**
   * One project as of a week (`label`; '' for a sheet without update columns). The note is that
   * week's, or the latest earlier one when the week wasn't updated: then only `from` (the week it
   * comes from) is sent and the page takes the text from that week, so notes aren't repeated.
   */
  const weekly = (d, label) => {
    const upTo = labels.slice(0, labels.indexOf(label) + 1).reverse();
    const found = upTo.map((l) => ({ l, text: d.statuses.find((s) => s.label === l)?.text || '' })).find((x) => x.text);
    const note = found?.text || '';
    // Completion %: "Completed…" = 100; else a stated percentage ("40% - …"); else, for cost-reduction
    // projects, the savings reported against the KPI's percentage target ("5% reduction" of >10% = 50%)
    const pct = isCompleted(note) ? 100 : percentFrom(note) ?? savingsProgress(d.kpi, d.target, note);
    const stage = normalizeStage(d.stageColumn) || estimateStage(note, pct, d.name);
    const entry = { stage, pct: stage === 'Complete' ? 100 : pct };
    if (found && found.l !== label) entry.from = found.l;
    else if (note) entry.note = note;
    const waiting = d.waitingColumn || (stage === 'Waiting' ? waitingFrom(note) || null : null);
    if (waiting) entry.waiting = waiting;
    // A cost-reduction project whose note reports no savings yet ("Still no or 0% contribution…")
    if (isCostKpi(d.kpi) && /\b0\s*%|no savings|no reduction/i.test(note)) entry.noSavings = true;
    return entry;
  };

  const dates = columnDates(labels);
  const snapshots = labels.length
    ? labels.map((label, i) => ({ label, date: dates[i], items: items.map((d) => weekly(d, label)) }))
    : [{ label: 'Current', date: null, items: items.map((d) => weekly(d, '')) }];

  return {
    sheet: card.sheet,
    academicYear: academicYear(card.targetLabels.at(-1)),
    projects,
    snapshots,
    stageColumn: items.some((d) => d.stageColumn),
    canViewAll: card.canViewAll,
    canFilterLead: card.canFilterLead,
    viewingDepartments: card.viewingDepartments,
    departments: card.departments,
  };
}

module.exports = { getScoreboardForUser, STAGES, percentFrom, savingsProgress };
