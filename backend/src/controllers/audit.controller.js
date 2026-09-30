const auditService = require('../services/audit.service');

function filters(query) {
  const { q, action, userId, from, to } = query;
  return { q, action, userId: userId ? Number(userId) : undefined, from, to };
}

async function list(req, res) {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(await auditService.listAuditLogs({ page, limit, ...filters(req.query) }));
}

// Downloads the filtered log as CSV
async function exportCsv(req, res) {
  const f = filters(req.query);
  const csv = await auditService.exportAuditLogsCsv(f);
  await auditService.audit(req, 'audit.export', { details: Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
  // BOM so Excel opens the UTF-8 file with the right characters
  res.send(`﻿${csv}`);
}

// Activity reported by the browser for any signed-in user (page views, "Open in Excel")
async function recordActivity(req, res) {
  const { action, target, details } = req.body;
  await auditService.audit(req, action, { target, details });
  res.status(204).end();
}

module.exports = { list, exportCsv, recordActivity };
