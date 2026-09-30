import { Link, useSearchParams } from 'react-router-dom';
import { useAllSheets, useScorecardSheets, useSheetGrid, useStrategyMap, useWorkbook } from '../../hooks/useStrategy';
import SheetGrid from '../../components/tables/SheetGrid';
import { excelUrl } from '../../utils/excelLinks';
import { updateGridCell } from '../../api/strategyApi';
import { getErrorMessage } from '../../api/axios';
import Card from '../../components/common/Card';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import ExcelEmbed, { EXCEL_WINDOW } from '../../components/common/ExcelEmbed';
import SheetSelect from '../../components/forms/SheetSelect';
import { plural } from '../../utils/format';

const MAX_KRAS_SHOWN = 6;

function MapSummary({ sheet }) {
  const { data, loading, error } = useStrategyMap({ sheet });

  if (loading) return <Loader label="Reading the strategy map from Excel…" />;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!data) return null;

  return (
    <>
      <p className="muted">Summary of “{data.sheet}”</p>
      <div className="map">
        {data.perspectives.map((p) => (
          <section key={p.name} className="map__lane">
            <h2 className="map__lane-title">{p.name}</h2>
            <div className="map__items">
              {p.objectives.map((o, i) => (
                <Link key={`${i}-${o.name}`} to={`/scorecard?sheet=${encodeURIComponent(data.sheet)}`} className="map__item">
                  <span className="map__item-name">{o.name}</span>
                  <span className="map__item-counts">{plural(o.kpis, 'KPI')} · {plural(o.projects, 'project')}</span>
                  <ul className="map__kras">
                    {o.kras.slice(0, MAX_KRAS_SHOWN).map((k) => <li key={k}>{k}</li>)}
                    {o.kras.length > MAX_KRAS_SHOWN && <li className="muted">+{o.kras.length - MAX_KRAS_SHOWN} more</li>}
                  </ul>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {data.targets.length > 0 && (
        <Card title="Institutional targets">
          <dl className="map-targets">
            {data.targets.map((t) => (
              <div key={t.objective} className="map-targets__row">
                <dt>{t.objective}</dt>
                <dd>{t.targets.map((line) => <span key={line}>{line}</span>)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </>
  );
}

// Excel view of one sheet: sheets with a Lead column render as a grid filtered to the
// user's department (Lead contains <code>); other sheets get an "Open in Excel" card.
function SheetView({ sheet, workbook, department, onDepartmentChange, sheets, onSheetChange }) {
  const { data: grid, loading, error, reload } = useSheetGrid({ sheet, department });

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
      <div className="toolbar">
        {grid.canViewAll && (
          <label className="field">
            <span className="field__label">Lead</span>
            <select className="input" value={department} onChange={(e) => onDepartmentChange(e.target.value)}>
              <option value="">All departments</option>
              {grid.departments.map((d) => (
                <option key={d.code} value={d.code}>{d.name ? `${d.code} – ${d.name}` : d.code}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => reload(true)}>Refresh from Excel</button>
        {workbook && (
          <a className="btn btn--primary" href={excelUrl(workbook.docUrl, { sheet })} target={EXCEL_WINDOW} rel="noreferrer">
            Open in Excel ↗
          </a>
        )}
      </div>

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
      </div>

      <ErrorMessage>{allSheets.error || scorecardSheets.error || workbook.error}</ErrorMessage>
      {listsLoading && <Loader />}

      {!listsLoading && view === 'excel' && sheet && (
        <SheetView
          sheet={sheet}
          workbook={workbook.data}
          department={params.get('department') || ''}
          onDepartmentChange={(code) => update({ department: code })}
          sheets={allSheets.data || []}
          onSheetChange={(name) => update({ sheet: name, department: '' })}
        />
      )}
      {!listsLoading && view === 'summary' && sheet && <MapSummary sheet={sheet} />}
    </div>
  );
}
