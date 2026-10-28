const ExcelJS = require('exceljs');
const { cellText, trimGrid, gridFromWorksheet, buildWorkbook } = require('../lib/spreadsheet');

const reload = async (workbook) => {
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await workbook.xlsx.writeBuffer());
  return copy;
};

describe('cellText', () => {
  test.each([
    [null, ''],
    [undefined, ''],
    ['FRIES', 'FRIES'],
    [1000012713, '1000012713'],
    [1.5, '1.5'],
    [10, '10'],
    [true, 'TRUE'],
    [new Date(Date.UTC(2026, 9, 28)), '2026-10-28'],
    [{ richText: [{ text: 'SAUSAGE, ' }, { text: 'HUNGARIAN' }] }, 'SAUSAGE, HUNGARIAN'],
    [{ text: 'FRIES', hyperlink: 'https://example.com' }, 'FRIES'],
    [{ text: { richText: [{ text: 'FR' }, { text: 'IES' }] }, hyperlink: 'x' }, 'FRIES'],
    [{ formula: 'D2*E2', result: 10 }, '10'],
    [{ error: '#N/A' }, ''],
  ])('%p → %p', (value, expected) => expect(cellText(value)).toBe(expected));
});

describe('trimGrid', () => {
  test('drops trailing blank cells and rows but keeps leading empty rows', () => {
    expect(trimGrid([[], ['A', 'B', '', ' '], ['1', '', '2'], [''], []]))
      .toEqual([[], ['A', 'B'], ['1', '', '2']]);
  });

  test('fills holes in sparse rows', () => {
    const sparse = [];
    sparse[2] = 'x';
    expect(trimGrid([sparse])).toEqual([['', '', 'x']]);
  });
});

describe('gridFromWorksheet', () => {
  test('reads a real workbook: title row, blank row, hyperlinks, rich text, formulas, numbers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Items');
    ws.getCell('A1').value = 'PRODUCT LIST 2026';
    ws.getRow(3).values = ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK'];
    ws.getRow(4).values = [1000012713, 'MAESTRO SHOESTRING FRIES', { text: 'FRIES', hyperlink: 'https://example.com' }, '1kg'];
    ws.getRow(5).values = ['J000073-2', { richText: [{ text: 'MAESTRO ' }, { text: 'HUNGARIAN SAUSAGE' }] }, 'SAUSAGE', { formula: '0.5*2', result: 1 }];

    const loaded = await reload(wb);

    expect(gridFromWorksheet(loaded.worksheets[0])).toEqual([
      ['PRODUCT LIST 2026'],
      [],
      ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK'],
      ['1000012713', 'MAESTRO SHOESTRING FRIES', 'FRIES', '1kg'],
      ['J000073-2', 'MAESTRO HUNGARIAN SAUSAGE', 'SAUSAGE', '1'],
    ]);
  });
});

describe('buildWorkbook', () => {
  test('bold frozen header, codes as text, money formatted; round-trips through .xlsx', async () => {
    const columns = [
      { key: 'sku', label: 'Product Code' }, { key: 'name', label: 'Item Name' },
      { key: 'price', label: 'Selling Price' }, { key: 'note', label: 'Note' },
    ];
    const wb = buildWorkbook(ExcelJS, {
      sheetName: 'Items', columns, rows: [{ sku: '00123', name: 'Fries', price: 285, note: null }],
      textKeys: ['sku'], moneyKeys: ['price'],
    });

    const ws = (await reload(wb)).getWorksheet('Items');

    expect(gridFromWorksheet(ws)).toEqual([
      ['Product Code', 'Item Name', 'Selling Price', 'Note'],
      ['00123', 'Fries', '285'],
    ]);
    expect(ws.getCell('A2').value).toBe('00123');
    expect(ws.getCell('A2').numFmt).toBe('@');
    expect(ws.getCell('C2').numFmt).toBe('#,##0.00');
    expect(ws.getCell('A1').font.bold).toBe(true);
    expect(ws.getCell('B2').font).toBeUndefined();
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
