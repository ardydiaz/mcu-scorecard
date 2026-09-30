// Builds read-only Excel-style sheets for SheetGrid from plain rows, using the scorecard
// workbook's look: blue KPI headers, orange project headers, light-green cells, Calibri 12.

const LINE_HEIGHT_PT = 15.75;
const font = { color: '#000000', size: 12, font: 'Calibri', wrap: true };

// Style table shared by every built sheet (SheetGrid looks styles up by index)
const STYLES = [
  { ...font, bg: '#9DC3E6', bold: true, h: 'center', v: 'middle' }, // 0 header, KPI group (blue)
  { ...font, bg: '#F4B183', bold: true, h: 'center', v: 'middle' }, // 1 header, project group (orange)
  { ...font, bg: '#E2EFDA', h: 'left', v: 'top' }, // 2 green text
  { ...font, bg: '#E2EFDA', h: 'center', v: 'top' }, // 3 green centered
  { ...font, bg: '#E2EFDA', bold: true, h: 'left', v: 'top' }, // 4 green bold
  { ...font, bg: null, h: 'left', v: 'top' }, // 5 white text
  { ...font, bg: null, h: 'center', v: 'top' }, // 6 white centered
  { ...font, bg: '#C6E0B4', bold: true, h: 'left', v: 'top' }, // 7 total label
  { ...font, bg: '#C6E0B4', bold: true, h: 'center', v: 'top' }, // 8 total number
];

// Rough number of wrapped lines a cell needs, so rows are tall enough (like Excel's auto-fit)
function lineCount(text, widthChars) {
  return String(text || '')
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.max(1, widthChars - 2))), 0);
}

function bodyStyle(column, row, i) {
  if (row.total) return column.center ? 8 : 7;
  if (column.fill === 'white') return column.center ? 6 : 5;
  if (column.center) return 3;
  return row.bold?.includes(i) ? 4 : 2;
}

/**
 * name:    sheet name shown in the tabs
 * columns: [{ label, width (Excel chars), header: 'kpi' | 'project', fill: 'green' | 'white', center }]
 * rows:    [{ cells, row (Excel row number), linkCell (cell to open in Excel, e.g. "K130"),
 *            bold: [colIndex], inherited: [colIndex], total }]
 * options: zoom; maxLines caps row height (full text stays in the formula bar);
 *          leadColumn + viewingDepartments mark the Lead filter; excelSheet is the real sheet for row links
 */
export function buildSheet(name, columns, rows, {
  zoom = 90, maxLines = Infinity, leadColumn = '', viewingDepartments = [], excelSheet,
} = {}) {
  return {
    sheet: name,
    excelSheet,
    supported: true,
    editable: false,
    leadColumn,
    dateColumns: [],
    viewingDepartments,
    totalRows: rows.length,
    headers: columns.map((c, i) => ({ letter: columnLetter(i), label: c.label })),
    format: {
      zoom,
      frozenRows: 1,
      showGridLines: true,
      defaultRowHeight: LINE_HEIGHT_PT,
      defaultColWidth: 8.43,
      headerHeight: 32,
      styles: STYLES,
      columns: columns.map((c) => ({ width: c.width, hidden: false, headerStyle: c.header === 'project' ? 1 : 0 })),
    },
    rows: rows.map((r, n) => ({
      row: r.row ?? n + 2,
      linkCell: r.linkCell,
      cells: r.cells.map((v) => String(v ?? '')),
      inherited: r.inherited || [],
      formulas: [],
      identity: null,
      height: Math.min(maxLines, Math.max(...r.cells.map((v, i) => lineCount(v, columns[i].width)))) * LINE_HEIGHT_PT,
      styles: columns.map((c, i) => bodyStyle(c, r, i)),
    })),
  };
}

function columnLetter(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}
