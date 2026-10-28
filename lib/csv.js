// Quote-aware CSV parsing shared by the student and inventory imports
// (CommonJS, like lib/arAging.js).

/**
 * Parse CSV text into rows of cells, dropping blank lines and the byte-order
 * mark Excel's "CSV UTF-8" format puts at the start.
 *
 * Handles quoted fields containing commas and escaped quotes, because a
 * Philippine address ("123 Rizal St., Tagum City") breaks a naive split and
 * would silently shift every column after it.
 */
function parseCsv(input) {
  const text = String(input).replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

module.exports = { parseCsv };
