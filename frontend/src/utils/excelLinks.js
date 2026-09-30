// Builds an Excel-for-the-web link to the workbook, opened at a sheet (and cell).
// action: 'edit' opens for editing, 'embedview' is the read-only embed.
export function excelUrl(docUrl, { sheet, cell = 'A1', action = 'edit' } = {}) {
  if (!docUrl) return '';
  const url = new URL(docUrl);
  url.searchParams.set('action', action);
  if (sheet) {
    // Sheet names with spaces are quoted; a quote inside the name is doubled
    url.searchParams.set('activeCell', `'${sheet.replace(/'/g, "''")}'!${cell}`);
  }
  return url.toString();
}
