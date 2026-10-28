// Spreadsheet logic that needs no browser, shared by the upload/download code in
// lib/xlsx.js and by Jest (CommonJS, like lib/arAging.js). Callers pass the
// ExcelJS module in, so this file never imports exceljs itself.

// One exceljs cell value as plain text. Values may be strings, numbers, Dates,
// rich text, hyperlinks, formulas or error objects.
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if ('result' in value) return cellText(value.result); // formula
    if ('text' in value) return cellText(value.text);     // hyperlink
    return '';                                            // error values such as #N/A
  }
  return String(value);
}

// Drops trailing blank cells and trailing empty rows. Leading empty rows stay,
// so grid[i] is still spreadsheet row i + 1.
function trimGrid(grid) {
  const rows = grid.map((row) => {
    const cells = Array.from(row || [], (c) => (c == null ? '' : String(c)));
    let end = cells.length;
    while (end > 0 && cells[end - 1].trim() === '') end--;
    return cells.slice(0, end);
  });
  let last = rows.length;
  while (last > 0 && rows[last - 1].length === 0) last--;
  return rows.slice(0, last);
}

// An exceljs worksheet as a grid of cell text; grid[i] is spreadsheet row i + 1.
function gridFromWorksheet(worksheet) {
  const grid = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
    grid[rowNumber - 1] = cells;
  });
  return trimGrid(Array.from(grid, (r) => r || []));
}

// A one-sheet workbook with a bold, filled, frozen header row. textKeys are
// stored as text so codes keep leading zeros; moneyKeys get #,##0.00.
function buildWorkbook(ExcelJS, { sheetName = 'Sheet1', columns, rows, textKeys = [], moneyKeys = [] }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(columns.map((c) => c.label));
  for (const r of rows) {
    sheet.addRow(columns.map((c) => {
      const v = r[c.key];
      if (v == null || v === '') return null;
      return textKeys.includes(c.key) ? String(v) : v;
    }));
  }
  columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    if (textKeys.includes(c.key)) column.numFmt = '@';
    if (moneyKeys.includes(c.key)) column.numFmt = '#,##0.00';
    const longest = rows.reduce((m, r) => Math.max(m, String(r[c.key] ?? '').length), c.label.length);
    column.width = Math.min(50, Math.max(10, longest + 2));
  });
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  });
  return workbook;
}

module.exports = { cellText, trimGrid, gridFromWorksheet, buildWorkbook };
