import { excelUrl } from '../../utils/excelLinks';
import SheetViewHint from './SheetViewHint';

// SharePoint only allows Excel for the web to be framed by Microsoft sites
// (CSP frame-ancestors), so the workbook opens in its own browser tab instead.
// Every link uses the same window name, so switching sheets reuses that one tab.
export const EXCEL_WINDOW = 'mcu-scorecard-excel';

export default function ExcelEmbed({ workbook, sheet }) {
  if (!workbook) return null;
  const href = excelUrl(workbook.docUrl, { sheet, action: 'edit' });

  return (
    <div className="excel-launch">
      <div className="excel-launch__icon" aria-hidden="true">X</div>
      <div className="excel-launch__body">
        <h2 className="excel-launch__title">{sheet}</h2>
        <p className="muted">
          {workbook.name} opens in Excel for the web, in its own tab. Edits there save automatically to SharePoint.
          Choosing another sheet above switches that same tab.
        </p>
        <a className="btn btn--primary" href={href} target={EXCEL_WINDOW} rel="noreferrer">
          Open “{sheet}” in Excel ↗
        </a>
        <SheetViewHint />
        <p className="excel-launch__note muted">
          Excel can't be shown inside this page: SharePoint only allows that on Microsoft sites like Teams and office.com.
        </p>
      </div>
    </div>
  );
}
