const workbookService = require('../services/workbook.service');
const { assignAllRowIds } = require('../services/rowid.service');
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

// Writes Row IDs into every scorecard sheet of the file and records it like the Access Rules button
async function assignAndAudit(req, wb) {
  const sheets = await assignAllRowIds(wb);
  for (const s of sheets.filter((x) => x.assigned || x.createdColumn)) {
    await audit(req, 'sheet.row_ids_assign', { target: s.sheet, details: { workbook: wb.name, ...s } });
  }
  return sheets;
}

// Publish / back to draft / hide. Publishing also gives the file's scorecard sheets Row IDs, so
// every published file supports rules for specific rows (the publish stands even if that fails).
async function setStatus(req, res) {
  const { workbook, before, newDefault } = await workbookService.setStatus(Number(req.params.id), req.body.status);
  await audit(req, 'workbook.status', {
    target: workbook.name,
    details: { from: STATUS_LABELS[before.status], to: STATUS_LABELS[workbook.status], ...(before.isDefault && !workbook.isDefault && { wasDefault: true }) },
  });
  let rowIds;
  if (workbook.status === 'published') {
    warmUp(workbook);
    if (before.status !== 'published') {
      try {
        rowIds = await assignAndAudit(req, await workbookService.getWorkbook(workbook.id));
      } catch (err) {
        rowIds = [{ sheet: '(all sheets)', error: err.message }];
      }
    }
  }
  res.json({ ...workbook, ...(rowIds && { rowIds }), ...(newDefault && { newDefault }) });
}

// "Assign Row IDs" for a whole file (e.g. one published before this was automatic)
async function assignRowIds(req, res) {
  const wb = await workbookService.getWorkbook(Number(req.params.id));
  res.json({ rowIds: await assignAndAudit(req, wb) });
}

async function setDefault(req, res) {
  const workbook = await workbookService.setDefault(Number(req.params.id));
  await audit(req, 'workbook.default', { target: workbook.name });
  res.json(workbook);
}

// Removes a file that is no longer in the folder, with its own access rules and hidden rows
async function remove(req, res) {
  const result = await workbookService.removeMissing(Number(req.params.id));
  await audit(req, 'workbook.remove', { target: result.name, details: { accessRulesRemoved: result.rules, hiddenRowsRemoved: result.hiddenRows } });
  res.json(result);
}

module.exports = { list, setStatus, assignRowIds, setDefault, remove };
