const workbookService = require('../services/workbook.service');
const { warmUp } = require('../services/format.service');
const { audit } = require('../services/audit.service');

const STATUS_LABELS = { draft: 'Draft', published: 'Published', hidden: 'Hidden' };

// Every file found in the scorecard folder; ?refresh=1 checks the folder now
async function list(req, res) {
  const refresh = req.query.refresh === '1';
  const workbooks = await workbookService.listAll({ refresh });
  if (refresh) await audit(req, 'workbook.refresh', { details: { files: workbooks.filter((w) => !w.missing).length } });
  res.json(workbooks);
}

// Publish / back to draft / hide
async function setStatus(req, res) {
  const { workbook, before } = await workbookService.setStatus(Number(req.params.id), req.body.status);
  await audit(req, 'workbook.status', {
    target: workbook.name,
    details: { from: STATUS_LABELS[before.status], to: STATUS_LABELS[workbook.status], ...(before.isDefault && !workbook.isDefault && { wasDefault: true }) },
  });
  if (workbook.status === 'published') warmUp(workbook);
  res.json(workbook);
}

async function setDefault(req, res) {
  const workbook = await workbookService.setDefault(Number(req.params.id));
  await audit(req, 'workbook.default', { target: workbook.name });
  res.json(workbook);
}

module.exports = { list, setStatus, setDefault };
