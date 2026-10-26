const { Op } = require('sequelize');
const WigSnapshot = require('../models/WigSnapshot');
const { getScoreboardForUser } = require('./scoreboard.service');
const logger = require('../utils/logger');

/**
 * Day-by-day WIG status. The sheet keeps only each WIG's current traffic light, so the system saves a
 * snapshot of every WIG (status and completion %) for each day (Manila time): when someone opens the
 * dashboard and once an hour from the server (see server.js). The same day is re-saved at most every
 * 30 minutes, so the last save of a day is that day's status.
 */

const SAVE_EVERY_MS = 30 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 3600 * 1000;
const lastSaved = new Map(); // "workbookId::sheet" -> time of the last save

// "2026-10-26" in Manila time
const manilaDay = (time = Date.now()) => new Date(time + MANILA_OFFSET_MS).toISOString().slice(0, 10);
// The same key the grid uses for a row (Row ID when the sheet has one)
const keyOf = (p) => (p.rowId ? `id:${p.rowId}` : `name:${p.lead}|${p.name}`).slice(0, 300);
// Everyone with full access sees every row; used so snapshots never depend on who opened the page
const ALL_ROWS = { role: 'admin', departments: [], accessRules: [] };

// The dashboard's status category (frontend scoreboardData.category), from the traffic light and stage
function statusOf(project, item) {
  if (project.status === 'Behind') return 'behind';
  if (project.status === 'At Risk' || project.status === 'Off Track') return 'atrisk';
  if (item?.stage === 'Complete') return 'completed';
  if (project.status === 'On Track') return 'ontrack';
  return 'unreported';
}

// Highest completion % reported so far (as the dashboard shows it), or null
function progressOf(data, i) {
  let best = null;
  for (const s of data.snapshots) {
    const it = s.items[i];
    const v = it.stage === 'Complete' ? 100 : it.pct ?? null;
    if (v !== null) best = Math.max(best ?? 0, v);
  }
  return best;
}

/** Saves today's status of every WIG of a sheet (skipped when saved in the last 30 minutes). */
async function recordToday(wb, sheet, { force = false } = {}) {
  const full = await getScoreboardForUser(wb, ALL_ROWS, { sheet });
  const key = `${wb.id}::${full.sheet}`;
  if (!force && Date.now() - (lastSaved.get(key) || 0) < SAVE_EVERY_MS) return null;
  lastSaved.set(key, Date.now());

  const day = manilaDay();
  const latest = full.snapshots[full.snapshots.length - 1];
  const rows = full.projects
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.wig)
    .map(({ p, i }) => ({
      workbookId: wb.id,
      sheet: full.sheet,
      day,
      rowKey: keyOf(p),
      name: String(p.name).slice(0, 255),
      lead: p.lead ? String(p.lead).slice(0, 100) : null,
      tier: p.tier ? String(p.tier).slice(0, 10) : null,
      status: statusOf(p, latest?.items[i]),
      trafficLight: p.status ? String(p.status).slice(0, 40) : null,
      pct: progressOf(full, i),
    }));
  // Replace the day's rows (a WIG removed today disappears from today's snapshot)
  await WigSnapshot.destroy({ where: { workbookId: wb.id, sheet: full.sheet, day } });
  if (rows.length) await WigSnapshot.bulkCreate(rows);
  return rows.length;
}

// Fire-and-forget version for request handlers and the hourly timer
function recordSoon(wb, sheet) {
  recordToday(wb, sheet).catch((err) => logger.warn(`Could not save the WIG snapshot for "${wb?.name}": ${err.message}`));
}

/**
 * The last `days` days of WIG status for the WIGs this user may see (with the dashboard's Lead filter),
 * oldest first: { sheet, today, days: [{ day, items: [{ rowKey, name, lead, tier, status, pct }] }] }.
 */
async function historyForUser(wb, user, { sheet, department, days = 30 } = {}) {
  const visible = await getScoreboardForUser(wb, user, { sheet, department });
  const keys = new Set(visible.projects.filter((p) => p.wig).map(keyOf));
  const since = manilaDay(Date.now() - (days - 1) * 86400000);
  const rows = await WigSnapshot.findAll({
    where: { workbookId: wb.id, sheet: visible.sheet, day: { [Op.gte]: since } },
    order: [['day', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  const byDay = new Map();
  for (const r of rows) {
    if (!keys.has(r.rowKey)) continue;
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push({ rowKey: r.rowKey, name: r.name, lead: r.lead, tier: r.tier, status: r.status, pct: r.pct });
  }
  return { sheet: visible.sheet, today: manilaDay(), days: [...byDay].map(([day, items]) => ({ day, items })) };
}

module.exports = { recordToday, recordSoon, historyForUser, keyOf, manilaDay };
