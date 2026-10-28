// .xlsx and .csv files in the browser. exceljs is large, so it is loaded on
// first use instead of with the page. The workbook logic itself lives in
// lib/spreadsheet.js, where Jest can test it.
import { gridFromWorksheet, buildWorkbook, trimGrid } from './spreadsheet';
import { parseCsv } from './csv';
import { downloadBlob } from './export';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default || mod;
}

// An uploaded .xlsx (first sheet) or .csv as a grid of cell text; grid[i] is
// spreadsheet row i + 1. Throws Error(message) for any other file.
export async function readSheetFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.csv')) return trimGrid(parseCsv(await file.text()));
  if (name.endsWith('.xls')) throw new Error('Save the file as Excel Workbook (.xlsx) and try again.');
  if (!name.endsWith('.xlsx')) throw new Error('Choose an Excel (.xlsx) or CSV file.');

  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("This file couldn't be read as an Excel workbook.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no sheets.');
  return gridFromWorksheet(sheet);
}

// Save rows as <filename>.xlsx. Other options as in buildWorkbook().
export async function downloadXlsx({ filename, ...options }) {
  const ExcelJS = await loadExcelJS();
  const buffer = await buildWorkbook(ExcelJS, options).xlsx.writeBuffer();
  downloadBlob(buffer, `${filename}.xlsx`, XLSX_MIME);
}
