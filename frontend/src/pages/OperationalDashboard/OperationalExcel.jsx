import { useCallback, useEffect, useState } from 'react';
import SheetGrid from '../../components/tables/SheetGrid';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import { getErrorMessage } from '../../api/axios';
import { logActivity } from '../../api/auditApi';
import { excelUrl } from '../../utils/excelLinks';
import {
  formatOperationalCell, getOperationalGrid, setOperationalColumnWidths, setOperationalRowHeights, updateOperationalCell,
} from '../../api/operationalApi';

// Error for SheetGrid: readable message plus the HTTP status (403 = read-only for this user)
function toGridError(err) {
  return Object.assign(new Error(getErrorMessage(err)), { status: err.response?.status });
}

/**
 * The Operational Excel file as a grid, like the Live Agenda: the file's own formatting, values saved
 * straight to the file. Admins and the ICT office can edit (values, formatting, column widths, row
 * heights); everyone else sees it read-only. `refreshKey` changes when the page's Refresh is pressed.
 */
export default function OperationalExcel({ refreshKey, onChanged }) {
  const [grid, setGrid] = useState(null);
  const [sheet, setSheet] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError('');
    getOperationalGrid({ sheet, refresh })
      .then(setGrid)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [sheet]);
  useEffect(() => { load(refreshKey > 0); }, [load, refreshKey]);

  if (loading && !grid) return <Loader center label="Reading the Operational file…" />;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!grid) return null;

  const canEdit = grid.editable;
  async function saveCell({ row, col, value, previous }) {
    try {
      const result = await updateOperationalCell({
        sheet: grid.sheet, row: row.row, column: grid.headers[col].letter, value, previous, identity: row.identity,
      });
      onChanged?.();
      return result;
    } catch (err) {
      throw toGridError(err);
    }
  }
  async function formatCell({ row, col, format }) {
    try {
      return await formatOperationalCell({ sheet: grid.sheet, row: row.row, column: grid.headers[col].letter, identity: row.identity, format });
    } catch (err) {
      throw toGridError(err);
    }
  }
  async function resizeColumns({ columns, width, autofit }) {
    try {
      return await setOperationalColumnWidths({ sheet: grid.sheet, columns, width, autofit });
    } catch (err) {
      throw toGridError(err);
    }
  }
  async function resizeRows({ rows, height, autofit }) {
    try {
      return await setOperationalRowHeights({ sheet: grid.sheet, rows, height, autofit });
    } catch (err) {
      throw toGridError(err);
    }
  }
  const excelLinkFor = grid.docUrl ? (cell) => {
    logActivity('excel.open', `${grid.fileName} ${grid.sheet}!${cell}`);
    return excelUrl(grid.docUrl, { sheet: grid.sheet, cell });
  } : undefined;

  return (
    <div className="sheet-view">
      {!canEdit && (
        <div className="alert alert--info">
          You can view the Operational file here. Only admins and the ICT office can change it.
        </div>
      )}
      <SheetGrid
        grid={grid}
        onSaveCell={canEdit ? saveCell : undefined}
        onFormatCell={canEdit ? formatCell : undefined}
        onColumnWidths={canEdit ? resizeColumns : undefined}
        onRowHeights={canEdit ? resizeRows : undefined}
        excelLinkFor={excelLinkFor}
        sheets={grid.sheets}
        onSheetChange={setSheet}
      />
      {canEdit && (
        <p className="muted sheet-view__help">
          Double-click, press <kbd>F2</kbd> or start typing to edit. <kbd>Enter</kbd> saves to the Operational Excel file,
          <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a line break, <kbd>Esc</kbd> cancels. Drag a column or row edge to resize it;
          double-click the edge to fit it. The Dashboard tab shows your changes after a refresh.
        </p>
      )}
    </div>
  );
}
