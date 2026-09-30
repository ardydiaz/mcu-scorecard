import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAllSheets, useScorecardSheets, useSheetGrid, useStrategyMap, useWorkbook } from '../../hooks/useStrategy';
import SheetGrid from '../../components/tables/SheetGrid';
import { updateGridCell } from '../../api/strategyApi';
import { getErrorMessage } from '../../api/axios';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import ExcelEmbed from '../../components/common/ExcelEmbed';
import SheetSelect from '../../components/forms/SheetSelect';

const SUMMARY_TAB = 'Strategy Summary';
const TARGETS_TAB = 'Institutional Targets';
const LINE_HEIGHT_PT = 15.75;

// Same look as the scorecard sheet: blue headers, light-green cells, Calibri 12
const SUMMARY_STYLES = [
  { bg: '#9DC3E6', color: '#000000', bold: true, size: 12, font: 'Calibri', h: 'center', v: 'middle', wrap: true }, // 0 header
  { bg: '#E2EFDA', color: '#000000', size: 12, font: 'Calibri', h: 'left', v: 'top', wrap: true }, // 1 text
  { bg: '#E2EFDA', color: '#000000', size: 12, font: 'Calibri', h: 'center', v: 'top', wrap: true }, // 2 number
  { bg: '#E2EFDA', color: '#000000', bold: true, size: 12, font: 'Calibri', h: 'left', v: 'top', wrap: true }, // 3 bold text
  { bg: '#C6E0B4', color: '#000000', bold: true, size: 12, font: 'Calibri', h: 'left', v: 'top', wrap: true }, // 4 total label
  { bg: '#C6E0B4', color: '#000000', bold: true, size: 12, font: 'Calibri', h: 'center', v: 'top', wrap: true }, // 5 total number
];

// Rough number of wrapped lines a cell needs, so rows are tall enough (like Excel's auto-fit)
function lineCount(text, widthChars) {
  return String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widthChars - 2))), 0);
}

/**
 * Builds a read-only sheet for SheetGrid from plain rows: `columns` is [{ label, width, number }],
 * each row is { cells, bold, total, inherited }.
 */
function buildSheet(name, columns, rows) {
  const letters = columns.map((_, i) => String.fromCharCode(65 + i));
  return {
    sheet: name,
    supported: true,
    editable: false,
    leadColumn: '',
    dateColumns: [],
    viewingDepartments: [],
    totalRows: rows.length,
    headers: columns.map((c, i) => ({ letter: letters[i], label: c.label })),
    format: {
      zoom: 90,
      frozenRows: 1,
      showGridLines: true,
      defaultRowHeight: LINE_HEIGHT_PT,
      defaultColWidth: 8.43,
      headerHeight: 30,
      styles: SUMMARY_STYLES,
      columns: columns.map((c) => ({ width: c.width, hidden: false, headerStyle: 0 })),
    },
    rows: rows.map((r, n) => ({
      row: n + 2,
      cells: r.cells.map((v) => String(v ?? '')),
      inherited: r.inherited || [],
      formulas: [],
      identity: null,
      height: Math.max(...r.cells.map((v, i) => lineCount(v, columns[i].width))) * LINE_HEIGHT_PT,
      styles: columns.map((c, i) => {
        if (r.total) return c.number ? 5 : 4;
        if (c.number) return 2;
        return r.bold?.includes(i) ? 3 : 1;
      }),
    })),
  };
}

function summarySheet(data) {
  const rows = [];
  let kpis = 0;
  let projects = 0;
  for (const p of data.perspectives) {
    p.objectives.forEach((o, i) => {
      rows.push({
        cells: [p.name, o.name, o.kras.join('\n'), o.kpis, o.projects],
        bold: [0, 1],
        inherited: i > 0 ? [0] : [],
      });
      kpis += o.kpis;
      projects += o.projects;
    });
  }
  const objectives = rows.length;
  rows.push({ cells: ['Total', `${objectives} objectives`, '', kpis, projects], total: true });

  return buildSheet(SUMMARY_TAB, [
    { label: 'Perspectives', width: 18 },
    { label: 'Objectives', width: 30 },
    { label: 'Key Result Areas', width: 48 },
    { label: 'KPIs', width: 10, number: true },
    { label: 'Projects', width: 10, number: true },
  ], rows);
}

function targetsSheet(data) {
  return buildSheet(TARGETS_TAB, [
    { label: 'Objective', width: 32 },
    { label: 'Target', width: 70 },
  ], data.targets.map((t) => ({ cells: [t.objective, t.targets.join('\n')], bold: [0] })));
}

// Summary of a scorecard sheet, shown as read-only Excel-style sheets (switch with the tabs)
function MapSummary({ sheet }) {
  const { data, loading, error } = useStrategyMap({ sheet });
  const [tab, setTab] = useState(SUMMARY_TAB);
  const sheets = useMemo(() => (data ? { [SUMMARY_TAB]: summarySheet(data), [TARGETS_TAB]: targetsSheet(data) } : null), [data]);

  if (loading) return <Loader label="Reading the strategy map from Excel…" />;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!sheets) return null;

  const tabs = [
    { id: 'summary', name: SUMMARY_TAB, tabColor: '#107C41' },
    ...(data.targets.length ? [{ id: 'targets', name: TARGETS_TAB, tabColor: '#7030A0' }] : []),
  ];

  return (
    <div className="sheet-view">
      <p className="muted sheet-view__help">
        Summary of “{data.sheet}”. Totals are calculated from the scorecard sheet; edit the data in the Excel tab.
      </p>
      <SheetGrid grid={sheets[tab]} sheets={tabs} onSheetChange={setTab} />
    </div>
  );
}

// Excel view of one sheet: sheets with a Lead column render as a grid filtered to the
// user's department (Lead contains <code>); other sheets get an "Open in Excel" card.
// The grid data is loaded by the page, whose toolbar holds the Lead filter and Refresh button.
function SheetView({ sheet, workbook, gridState, sheets, onSheetChange }) {
  const { data: grid, loading, error } = gridState;

  if (loading) return <Loader label={`Reading “${sheet}” from Excel…`} />;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!grid) return null;
  if (!grid.supported) return <ExcelEmbed workbook={workbook} sheet={sheet} />;

  const filtered = grid.viewingDepartments.length > 0;
  const noDepartment = !grid.canViewAll && !filtered;

  // Writes one cell to the Excel file; errors are shown on the cell by SheetGrid
  async function saveCell({ row, col, value, previous }) {
    try {
      return await updateGridCell({
        sheet: grid.sheet,
        row: row.row,
        column: grid.headers[col].letter,
        value,
        previous,
        identity: row.identity,
      });
    } catch (err) {
      throw new Error(getErrorMessage(err));
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
            docUrl={workbook?.docUrl}
            onSaveCell={saveCell}
            sheets={sheets}
            onSheetChange={onSheetChange}
          />
          <p className="muted sheet-view__help">
            Double-click, press <kbd>F2</kbd> or start typing to edit. <kbd>Enter</kbd> saves to the Excel file,
            <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a line break, <kbd>Esc</kbd> cancels. Grey italic values are carried down
            from the row where they start. Row numbers open that row in Excel.
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

  const allSheets = useAllSheets();
  const scorecardSheets = useScorecardSheets();
  const workbook = useWorkbook();

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
  const gridState = useSheetGrid({ sheet: showGrid ? sheet : '', department });
  const grid = showGrid && gridState.data?.supported ? gridState.data : null;

  return (
    <div className="page">
      <h1 className="page__title">Strategy Map</h1>

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
        <SheetSelect sheets={sheetList} value={sheet} onChange={(name) => update({ sheet: name, department: '' })} />
        {grid?.canViewAll && (
          <label className="field">
            <span className="field__label">Lead</span>
            <select className="input" value={department} onChange={(e) => update({ department: e.target.value })}>
              <option value="">All departments</option>
              {grid.departments.map((d) => (
                <option key={d.code} value={d.code}>{d.name ? `${d.code} – ${d.name}` : d.code}</option>
              ))}
            </select>
          </label>
        )}
        {showGrid && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => gridState.reload(true)}
            disabled={gridState.loading}
          >
            Refresh from Excel
          </button>
        )}
      </div>

      <ErrorMessage>{allSheets.error || scorecardSheets.error || workbook.error}</ErrorMessage>
      {listsLoading && <Loader />}

      {showGrid && (
        <SheetView
          sheet={sheet}
          workbook={workbook.data}
          gridState={gridState}
          sheets={allSheets.data || []}
          onSheetChange={(name) => update({ sheet: name, department: '' })}
        />
      )}
      {!listsLoading && view === 'summary' && sheet && <MapSummary sheet={sheet} />}
    </div>
  );
}
