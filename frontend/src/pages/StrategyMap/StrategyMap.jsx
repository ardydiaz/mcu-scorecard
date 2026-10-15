import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAllSheets, useScorecardSheets, useSheetGrid, useStrategyMap, useWorkbook } from '../../hooks/useStrategy';
import SheetGrid from '../../components/tables/SheetGrid';
import {
  changeGridColumns, pasteGridCells, formatGridCell, mergeGridCells, setGridColumnWidths, setGridRowHeights, setHiddenRows, updateGridCell,
} from '../../api/strategyApi';
import { toastSuccess } from '../../utils/dialog';
import { excelUrl } from '../../utils/excelLinks';
import { logActivity } from '../../api/auditApi';
import { getErrorMessage } from '../../api/axios';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import ExcelEmbed from '../../components/common/ExcelEmbed';
import SheetSelect from '../../components/forms/SheetSelect';
import WorkbookSelect from '../../components/forms/WorkbookSelect';
import useSelectedWorkbook from '../../hooks/useSelectedWorkbook';
import { buildSheet } from '../../utils/sheetBuilder';

// Error for SheetGrid: readable message plus the HTTP status (403 = the row is read-only for this user)
function toGridError(err) {
  return Object.assign(new Error(getErrorMessage(err)), { status: err.response?.status });
}

const SUMMARY_TAB = 'Strategy Summary';
const TARGETS_TAB = 'Institutional Targets';

function summarySheet(data) {
  const rows = [];
  let kpis = 0;
  let projects = 0;
  for (const p of data.perspectives) {
    p.objectives.forEach((o, i) => {
      rows.push({
        cells: [p.name, o.name, o.kras.join('\n'), (o.leads || []).join(', '), o.kpis, o.projects],
        bold: [0, 1],
        inherited: i > 0 ? [0] : [],
      });
      kpis += o.kpis;
      projects += o.projects;
    });
  }
  const objectives = rows.length;
  rows.push({ cells: ['Total', `${objectives} objectives`, '', '', kpis, projects], total: true });

  return buildSheet(SUMMARY_TAB, [
    { label: 'Perspectives', width: 18 },
    { label: 'Objectives', width: 30 },
    { label: 'Key Result Areas', width: 48 },
    { label: 'Lead', width: 22 },
    { label: 'KPIs', width: 10, center: true },
    { label: 'Projects', width: 10, center: true },
  ], rows);
}

function targetsSheet(data) {
  return buildSheet(TARGETS_TAB, [
    { label: 'Objective', width: 32 },
    { label: 'Target', width: 70 },
  ], data.targets.map((t) => ({ cells: [t.objective, t.targets.join('\n')], bold: [0] })));
}

// Summary of a scorecard sheet, shown as read-only Excel-style sheets (switch with the tabs).
// Counts only the rows the user may see: their department's Lead rows, or every department for
// view-all users (or the department picked in the Lead filter). Data is loaded by the page.
function MapSummary({ summaryState }) {
  const { data, loading, error } = summaryState;
  const [tab, setTab] = useState(SUMMARY_TAB);
  const sheets = useMemo(() => (data ? { [SUMMARY_TAB]: summarySheet(data), [TARGETS_TAB]: targetsSheet(data) } : null), [data]);

  if (loading) return <Loader center label="Reading the strategy map from Excel…" />;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!sheets) return null;

  const viewing = data.viewingDepartments || [];
  if (!data.canViewAll && viewing.length === 0) {
    return (
      <div className="alert alert--info">
        Your account is not linked to a department yet, so there is nothing to summarize. Ask the ICT office to set your
        Department in Microsoft 365.
      </div>
    );
  }
  if (data.perspectives.length === 0) {
    return <p className="muted">No rows in “{data.sheet}” have {viewing.join(', ')} as Lead.</p>;
  }

  const tabs = [
    { id: 'summary', name: SUMMARY_TAB, tabColor: '#107C41' },
    ...(data.targets.length ? [{ id: 'targets', name: TARGETS_TAB, tabColor: '#7030A0' }] : []),
  ];
  const scope = viewing.length ? `rows led by ${viewing.join(', ')}` : 'all departments';

  return (
    <div className="sheet-view">
      <p className="muted sheet-view__help">
        Summary of “{data.sheet}” for <strong>{scope}</strong>. Totals are calculated from the scorecard sheet; edit the data in the Excel tab.
      </p>
      <SheetGrid grid={sheets[tab]} sheets={tabs} onSheetChange={setTab} />
    </div>
  );
}

// Excel view of one sheet: sheets with a Lead column render as a grid filtered to the
// user's department (Lead contains <code>); other sheets get an "Open in Excel" card.
// The grid data is loaded by the page, whose toolbar holds the Lead filter and Refresh button.
function SheetView({ workbookId, sheet, workbook, gridState, sheets, onSheetChange }) {
  const { data: grid, loading, error } = gridState;

  if (loading) return <Loader center label={`Reading “${sheet}” from Excel…`} />;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!grid) return null;
  if (!grid.supported) return <ExcelEmbed workbook={workbook} sheet={sheet} />;

  const filtered = grid.viewingDepartments.length > 0;
  const noDepartment = !grid.canViewAll && !filtered;

  // Writes one cell to the Excel file; errors are shown on the cell by SheetGrid
  async function saveCell({ row, col, value, previous }) {
    try {
      return await updateGridCell({
        workbook: workbookId,
        sheet: grid.sheet,
        row: row.row,
        column: grid.headers[col].letter,
        value,
        previous,
        identity: row.identity,
      });
    } catch (err) {
      throw toGridError(err);
    }
  }

  // Merges/unmerges cells in one row. A CONFIRM_MERGE error keeps its code and list of values
  // that would be deleted, so SheetGrid can ask the user.
  async function mergeCells({ row, endRow, identities, startCol, endCol, merge, center, confirm }) {
    try {
      return await mergeGridCells({
        workbook: workbookId,
        sheet: grid.sheet,
        row: row.row,
        endRow,
        identities,
        startColumn: grid.headers[startCol].letter,
        endColumn: grid.headers[endCol].letter,
        merge,
        center,
        confirm,
      });
    } catch (err) {
      const error = new Error(getErrorMessage(err));
      error.code = err.response?.data?.code;
      error.lost = err.response?.data?.lost || [];
      throw error;
    }
  }

  // Hides/unhides rows in the user's own view (saved to their account)
  // Inserts / deletes a column in the Excel file, then reloads the sheet (columns moved). A delete of
  // a column with values keeps the CONFIRM_DELETE code so SheetGrid can ask the user again.
  async function changeColumns(request) {
    let result;
    try {
      result = await changeGridColumns({ workbook: workbookId, sheet: grid.sheet, ...request });
    } catch (err) {
      const error = toGridError(err);
      error.code = err.response?.data?.code;
      error.filled = err.response?.data?.filled;
      error.header = err.response?.data?.header;
      error.lost = err.response?.data?.lost;
      throw error;
    }
    toastSuccess({
      delete: `Column ${result.column} deleted from the Excel file.`,
      rename: `Column ${result.column} renamed to “${result.header}” in the Excel file.`,
      move: `Column moved to ${result.column} in the Excel file.`,
    }[request.action] || `Column ${result.column} “${result.header}” added to the Excel file.`);
    gridState.reload(true);
    return result;
  }

  // Pastes copied values into the Excel file (SheetGrid builds the targets)
  async function pasteCells({ targets }) {
    try {
      return await pasteGridCells({ workbook: workbookId, sheet: grid.sheet, targets });
    } catch (err) {
      throw toGridError(err);
    }
  }

  // Link to the file in Excel for the web at a cell (to move columns there, keeping all formatting)
  const excelLinkFor = workbook?.docUrl ? (cell) => {
    logActivity('excel.open', `${grid.sheet}!${cell}`);
    return excelUrl(workbook.docUrl, { sheet: grid.sheet, cell });
  } : undefined;

  // Column widths / row heights saved in the Excel file (dragging or double-clicking edges in the grid)
  async function resizeColumns({ columns, width, autofit }) {
    try {
      return await setGridColumnWidths({ workbook: workbookId, sheet: grid.sheet, columns, width, autofit });
    } catch (err) {
      throw toGridError(err);
    }
  }
  async function resizeRows({ rows, height, autofit }) {
    try {
      return await setGridRowHeights({ workbook: workbookId, sheet: grid.sheet, rows, height, autofit });
    } catch (err) {
      throw toGridError(err);
    }
  }

  async function hideRows({ keys, hidden, all }) {
    try {
      return await setHiddenRows({ workbook: workbookId, sheet: grid.sheet, keys, hidden, all });
    } catch (err) {
      throw toGridError(err);
    }
  }

  // Changes one cell's formatting in the Excel file; returns { style }
  async function formatCell({ row, col, format }) {
    try {
      return await formatGridCell({
        workbook: workbookId,
        sheet: grid.sheet,
        row: row.row,
        column: grid.headers[col].letter,
        identity: row.identity,
        format,
      });
    } catch (err) {
      throw toGridError(err);
    }
  }

  return (
    <div className="sheet-view">
      {noDepartment ? (
        <div className="alert alert--info">
          Your account is not linked to a department yet, so no rows can be shown. Ask the ICT office to set your
          Department in Microsoft 365.
        </div>
      ) : grid.rows.length === 0 ? (
        <p className="muted">No rows in this sheet have {grid.viewingDepartments.join(', ')} as Lead.</p>
      ) : (
        <>
          <SheetGrid
            grid={grid}
            onSaveCell={saveCell}
            onFormatCell={formatCell}
            onMergeCells={mergeCells}
            onHideRows={hideRows}
            onColumnWidths={resizeColumns}
            onRowHeights={resizeRows}
            onPasteCells={pasteCells}
            excelLinkFor={excelLinkFor}
            onColumns={grid.canInsertColumns ? changeColumns : undefined}
            sheets={sheets}
            onSheetChange={onSheetChange}
          />
          <p className="muted sheet-view__help">
            Double-click, press <kbd>F2</kbd> or start typing to edit. <kbd>Enter</kbd> saves to the Excel file,
            <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a line break, <kbd>Esc</kbd> cancels. Click a row number or column letter
            to select it; <kbd>Shift</kbd>+click to select more. Right-click row numbers (or <kbd>Ctrl</kbd>+<kbd>9</kbd>) to hide
            rows in your own view. Grey italic values are carried down from the row where they start.
          </p>
        </>
      )}
    </div>
  );
}

// Excel view (default): the sheet picked in the dropdown, filtered by Lead.
// Summary view: perspectives/objectives parsed from a scorecard sheet.
export default function StrategyMap() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'summary' ? 'summary' : 'excel';
  const sheetParam = params.get('sheet') || '';

  const files = useSelectedWorkbook();
  const workbookId = files.workbook;
  const allSheets = useAllSheets({ workbook: workbookId });
  const scorecardSheets = useScorecardSheets({ workbook: workbookId });
  const workbook = useWorkbook({ workbook: workbookId });

  const sheetList = (view === 'excel' ? allSheets.data : scorecardSheets.data) || [];
  // Keep the chosen sheet if it's in this view's list; otherwise start on the current scorecard sheet
  const defaultSheet = scorecardSheets.data?.[0]?.name || sheetList[0]?.name || '';
  const sheet = sheetList.some((s) => s.name === sheetParam) ? sheetParam : defaultSheet;

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const listsLoading = allSheets.loading || scorecardSheets.loading;
  const department = params.get('department') || '';
  const showGrid = !listsLoading && view === 'excel' && !!sheet;
  const gridState = useSheetGrid({ workbook: workbookId, sheet: showGrid ? sheet : '', department });
  const grid = showGrid && gridState.data?.supported ? gridState.data : null;
  const showSummary = !listsLoading && view === 'summary' && !!sheet;
  const summaryState = useStrategyMap({ workbook: workbookId, sheet: showSummary ? sheet : '', department });
  // The Lead filter follows whichever view is shown (both answer with the same access fields)
  const filterData = view === 'summary' ? (showSummary ? summaryState.data : null) : grid;

  return (
    <div className="page">
      <h1 className="page__title">Strategy Scoreboard</h1>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          <button
            type="button"
            className={view === 'excel' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
            onClick={() => update({ view: '' })}
          >
            Excel
          </button>
          <button
            type="button"
            className={view === 'summary' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
            onClick={() => update({ view: 'summary' })}
          >
            Summary
          </button>
        </div>
        <WorkbookSelect
          workbooks={files.workbooks}
          value={workbookId}
          onChange={(id) => update({ workbook: id, sheet: '', department: '' })}
        />
        <SheetSelect sheets={sheetList} value={sheet} onChange={(name) => update({ sheet: name, department: '' })} />
        {(filterData?.canFilterLead ?? filterData?.canViewAll) && filterData.departments?.length > 0 && (
          <label className="field">
            <span className="field__label">Lead</span>
            <select className="input" value={department} onChange={(e) => update({ department: e.target.value })}>
              <option value="">{filterData.canViewAll ? 'All departments' : 'All my rows'}</option>
              {filterData.departments.map((d) => (
                <option key={d.code} value={d.code}>{d.name ? `${d.code} – ${d.name}` : d.code}</option>
              ))}
            </select>
          </label>
        )}
        {(showGrid || showSummary) && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => (showGrid ? gridState : summaryState).reload(true)}
            disabled={(showGrid ? gridState : summaryState).loading}
          >
            Refresh from Excel
          </button>
        )}
      </div>

      <ErrorMessage>{files.error || allSheets.error || scorecardSheets.error || workbook.error}</ErrorMessage>
      {listsLoading && <Loader center label="Opening the workbook…" />}

      {showGrid && (
        <SheetView
          workbookId={workbookId}
          sheet={sheet}
          workbook={workbook.data}
          gridState={gridState}
          sheets={allSheets.data || []}
          onSheetChange={(name) => update({ sheet: name, department: '' })}
        />
      )}
      {showSummary && <MapSummary summaryState={summaryState} />}
    </div>
  );
}
