const { parseWeight, parseCount, packagingFromBody } = require('../server/utils/inventoryImport');

describe('parseWeight', () => {
  test.each([
    ['1kg', 1], ['1 kg', 1], ['1.5', 1.5], ['500g', 0.5], ['250 grams', 0.25],
    ['2 KGS', 2], ['1,000 g', 1], ['.5kg', 0.5], ['1 kilo', 1],
  ])('%s is %s kg', (raw, kg) => expect(parseWeight(raw)).toEqual({ value: kg }));

  test.each(['', 'N/A', 'na', '-', 'none', null, undefined])('%p is blank', (raw) =>
    expect(parseWeight(raw)).toEqual({ value: null }));

  test.each(['heavy', '1 lb', '-1kg', '1/2 kg'])('%s is an error', (raw) =>
    expect(parseWeight(raw).error).toBe('is not a weight (use e.g. 1kg or 500g)'));
});

describe('parseCount', () => {
  test.each([
    ['10 packs', 10], ['10', 10], ['11 pcs', 11], ['1 pack', 1], ['12 pieces', 12], ['10.0', 10], ['1,000', 1000],
  ])('%s is %s', (raw, n) => expect(parseCount(raw)).toEqual({ value: n }));

  test.each(['', 'N/A', '-'])('%p is blank', (raw) => expect(parseCount(raw)).toEqual({ value: null }));

  test.each(['2.5', 'ten', '10 boxes', '-3'])('%s is an error', (raw) =>
    expect(parseCount(raw).error).toBe('is not a whole number'));
});

describe('packagingFromBody', () => {
  test('parses form values; an empty field clears it', () => {
    expect(packagingFromBody({ weightPerPackKg: '1.5', packsPerCase: '10', pcsPerPack: '' }))
      .toEqual({ weightPerPackKg: 1.5, packsPerCase: 10, pcsPerPack: null });
  });

  test('create: missing fields become null; partial update: missing fields are left out', () => {
    expect(packagingFromBody({})).toEqual({ weightPerPackKg: null, packsPerCase: null, pcsPerPack: null });
    expect(packagingFromBody({ packsPerCase: 12 }, { partial: true })).toEqual({ packsPerCase: 12 });
  });

  test('rejects negatives and fractional counts', () => {
    expect(() => packagingFromBody({ weightPerPackKg: '-1' })).toThrow('Weight / Pack (kg) cannot be negative');
    expect(() => packagingFromBody({ packsPerCase: '2.5' })).toThrow('Packs / Case is not a whole number');
  });
});

const {
  COLUMNS, TEMPLATE_ROW, normHeader, findHeaderRow, guessMapping, validateMapping, readRows,
  planImport, exportRow, nextSkuNumber,
} = require('../server/utils/inventoryImport');

const CLIENT_SHEET = [
  ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK', 'PACKS / CASE', 'KG / CASE', 'PCS / PACK'],
  ['1000012713', 'MAESTRO SHOESTRING FRIES', 'FRIES', '1kg', '10 packs', '10 kg', 'N/A'],
  ['J000073-2', 'MAESTRO HUNGARIAN SAUSAGE', 'SAUSAGE, HUNGARIAN', '1kg', '10 packs', '10 kg', '11 pcs'],
];

// The same pipeline the controller runs.
const plan = (grid, existing = [], categories = [], firstSku = 1) => {
  const h = findHeaderRow(grid);
  return planImport(readRows(grid, h, guessMapping(grid[h])), existing, categories, firstSku);
};

const item = (over) => ({
  id: 1, sku: 'SKU-0001', name: 'Item', isActive: true, category: null, unit: 'pcs', description: null,
  costPrice: 0, sellingPrice: 0, reorderLevel: 0, warehouseLocation: null,
  weightPerPackKg: null, packsPerCase: null, pcsPerPack: null, ...over,
});

describe('header matching', () => {
  test('normHeader ignores case, spaces and punctuation', () => {
    expect(normHeader(' WEIGHT / PACK ')).toBe('weightpack');
    expect(normHeader('Weight/Pack (kg)')).toBe('weightpackkg');
  });

  test("the client's sheet maps column by column", () => {
    expect(guessMapping(CLIENT_SHEET[0]))
      .toEqual(['sku', 'name', 'category', 'weightPerPackKg', 'packsPerCase', 'kgPerCase', 'pcsPerPack']);
  });

  test('a second PRODUCTS column falls through to Category', () => {
    expect(guessMapping(['PRODUCT CODE', 'PRODUCTS', 'PRODUCTS'])).toEqual(['sku', 'name', 'category']);
  });

  test('our own download headers map to themselves; unknown headers are ignored', () => {
    expect(guessMapping(COLUMNS.map((c) => c.label))).toEqual(COLUMNS.map((c) => c.key));
    expect(guessMapping(['Item Name', 'Remarks', ''])).toEqual(['name', null, null]);
  });

  test('the header row may sit under a title row', () => {
    expect(findHeaderRow([['PRODUCT LIST 2026'], [], ...CLIENT_SHEET])).toBe(2);
    expect(findHeaderRow([['just', 'some'], ['data', 'here']])).toBe(-1);
  });
});

describe('validateMapping', () => {
  const header = ['A', 'B'];

  test('accepts a mapping with a code or a name', () => {
    expect(validateMapping(['sku', null], header)).toBeNull();
    expect(validateMapping([null, 'name'], header)).toBeNull();
  });

  test('rejects unknown keys, a field used twice, a wrong length, or neither code nor name', () => {
    expect(validateMapping(['bogus', 'name'], header)).toBe('Unknown column "bogus".');
    expect(validateMapping(['name', 'name'], header)).toBe('Item Name is chosen for more than one column.');
    expect(validateMapping(['name'], header)).toBe('The column mapping does not match the file.');
    expect(validateMapping(['unit', null], header)).toBe('Choose a column for Product Code or Item Name.');
  });
});

describe('readRows', () => {
  test('parses values and keeps spreadsheet row numbers', () => {
    expect(readRows(CLIENT_SHEET, 0, guessMapping(CLIENT_SHEET[0]))).toEqual([
      { row: 2, errors: [], values: {
        sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', category: 'FRIES',
        weightPerPackKg: 1, packsPerCase: 10, kgPerCase: 10, pcsPerPack: null,
      } },
      { row: 3, errors: [], values: {
        sku: 'J000073-2', name: 'MAESTRO HUNGARIAN SAUSAGE', category: 'SAUSAGE, HUNGARIAN',
        weightPerPackKg: 1, packsPerCase: 10, kgPerCase: 10, pcsPerPack: 11,
      } },
    ]);
  });

  test('skips blank rows and reports unreadable cells by column', () => {
    const grid = [
      ['Product Code', 'Item Name', 'Selling Price', 'Packs / Case'],
      ['', '', '', ''],
      ['A1', 'Fries', '₱1,250.00', 'ten'],
      ['A2', 'Nuggets', '-5', ''],
    ];
    const rows = readRows(grid, 0, guessMapping(grid[0]));
    expect(rows.map((r) => r.row)).toEqual([3, 4]);
    expect(rows[0].values.sellingPrice).toBe(1250);
    expect(rows[0].errors).toEqual(['Packs / Case "ten" is not a whole number.']);
    expect(rows[1].errors).toEqual(['Selling Price "-5" cannot be negative.']);
  });

  test('text longer than its column is an error', () => {
    const grid = [['Product Code', 'Unit'], ['A1', 'x'.repeat(21)]];
    expect(readRows(grid, 0, guessMapping(grid[0]))[0].errors[0])
      .toBe(`Unit "${'x'.repeat(21)}" is longer than 20 characters.`);
  });
});

describe('planImport', () => {
  test("the client's two rows become two new items and two new categories", () => {
    const p = plan(CLIENT_SHEET);
    expect(p.summary).toEqual({ create: 2, update: 0, unchanged: 0, errors: 0, warnings: 0 });
    expect(p.newCategories).toEqual(['FRIES', 'SAUSAGE, HUNGARIAN']);
    expect(p.creates[0]).toEqual({
      sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', category: 'FRIES', unit: 'pcs', description: null,
      costPrice: 0, sellingPrice: 0, reorderLevel: 0, warehouseLocation: null,
      weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: null,
    });
    expect(p.creates[1]).toMatchObject({ sku: 'J000073-2', pcsPerPack: 11 });
  });

  test('an existing code updates only the filled-in cells that differ', () => {
    const existing = [item({
      id: 7, sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', category: 'FRIES',
      sellingPrice: 280, packsPerCase: 8, weightPerPackKg: 1,
    })];
    const grid = [
      ['Product Code', 'Item Name', 'Selling Price', 'Packs / Case', 'Cost Price'],
      ['1000012713', 'MAESTRO SHOESTRING FRIES', '285', '10', ''],
    ];
    const p = plan(grid, existing, [{ id: 1, name: 'FRIES' }]);
    expect(p.summary).toMatchObject({ create: 0, update: 1 });
    expect(p.updates).toEqual([{ id: 7, data: { sellingPrice: 285, packsPerCase: 10 } }]);
    expect(p.rows[0].changes).toEqual([
      { field: 'Selling Price', from: 280, to: 285 },
      { field: 'Packs / Case', from: 8, to: 10 },
    ]);
  });

  test('re-uploading a download changes nothing', () => {
    const existing = [item({
      id: 7, sku: 'SKU-0001', name: 'Fries', category: 'FRIES', unit: 'pack', costPrice: 200,
      sellingPrice: 285, reorderLevel: 5, weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: 11,
    })];
    const row = exportRow({ ...existing[0], category: { name: 'FRIES' } });
    const grid = [
      COLUMNS.map((c) => c.label),
      COLUMNS.map((c) => (row[c.key] == null ? '' : String(row[c.key]))),
    ];
    expect(plan(grid, existing, [{ id: 1, name: 'FRIES' }]).summary)
      .toEqual({ create: 0, update: 0, unchanged: 1, errors: 0, warnings: 0 });
  });

  test('matching ignores case in codes and category names', () => {
    const existing = [item({ id: 7, sku: 'ab-1', name: 'Fries', category: 'Fries' })];
    const grid = [['Product Code', 'Category'], ['AB-1', 'FRIES']];
    expect(plan(grid, existing, [{ id: 1, name: 'Fries' }]).summary.unchanged).toBe(1);
  });

  test('a Product Code on two rows is an error on both', () => {
    const p = plan([['Product Code', 'Item Name'], ['A1', 'Fries'], ['a1', 'Nuggets']]);
    expect(p.summary.errors).toBe(2);
    expect(p.rows[0].errors).toEqual(['Product Code A1 appears on rows 2, 3.']);
  });

  test('a blank code gets the next SKU, in file order, after the highest existing one', () => {
    const existing = [item({ id: 1, sku: 'SKU-0007', name: 'Old' })];
    const p = plan([['Product Code', 'Item Name'], ['', 'Fries'], ['', 'Nuggets']], existing, [],
      nextSkuNumber(existing.map((i) => i.sku)));
    expect(p.creates.map((c) => c.sku)).toEqual(['SKU-0008', 'SKU-0009']);
    expect(p.rows.map((r) => r.sku)).toEqual(['SKU-0008', 'SKU-0009']);
  });

  test('blank code with a name on file is an error; a new code with that name is a warning', () => {
    const existing = [item({ id: 3, sku: 'SKU-0003', name: 'Fries' })];
    const p = plan([['Product Code', 'Item Name'], ['', ' fries '], ['NEW-1', 'Fries']], existing);
    expect(p.rows[0].errors).toEqual(['Already on file as SKU-0003. Put that code in Product Code to update it.']);
    expect(p.rows[1].action).toBe('create');
    expect(p.rows[1].warnings).toEqual(['An item named "Fries" already exists as SKU-0003; this adds a second one.']);
  });

  test("a blank code repeating an earlier row's name is an error", () => {
    const p = plan([['Product Code', 'Item Name'], ['', 'Fries'], ['', 'FRIES']]);
    expect(p.rows[1].errors).toEqual(['Same Item Name as row 2. Give this row a Product Code or remove it.']);
  });

  test('a new code without a name is an error', () => {
    const p = plan([['Product Code', 'Item Name', 'Selling Price'], ['NEW-1', '', '100']]);
    expect(p.rows[0].errors).toEqual(['Item Name is required for a new item.']);
    expect(p.creates).toEqual([]);
  });

  test('an inactive item is updated but stays inactive, with a warning', () => {
    const existing = [item({ id: 4, sku: 'OLD-1', name: 'Old Fries', isActive: false, sellingPrice: 100 })];
    const p = plan([['Product Code', 'Selling Price'], ['OLD-1', '120']], existing);
    expect(p.updates).toEqual([{ id: 4, data: { sellingPrice: 120 } }]);
    expect(p.rows[0].warnings).toEqual(['This item is inactive; it stays inactive.']);
  });

  test('Kg / Case is checked against weight × packs and never saved', () => {
    const p = plan([
      ['Product Code', 'Item Name', 'Weight / Pack', 'Packs / Case', 'Kg / Case'],
      ['A1', 'Fries', '1kg', '10', '12 kg'],
      ['A2', 'Nuggets', '', '10', '10'],
    ]);
    expect(p.rows[0].warnings).toEqual(["Kg / Case 12 doesn't match 1 kg × 10 packs = 10 kg."]);
    expect(p.rows[1].warnings).toEqual(["Kg / Case is calculated from Weight / Pack × Packs / Case and isn't saved on its own."]);
    expect(p.creates[0]).not.toHaveProperty('kgPerCase');
    expect(p.summary.warnings).toBe(2);
  });

  test('new categories differing only in case are created once, spelled as first seen', () => {
    const p = plan([
      ['Product Code', 'Item Name', 'Category'],
      ['A1', 'Fries', 'Frozen'], ['A2', 'Nuggets', 'FROZEN'], ['A3', 'Ham', 'Deli'],
    ], [], [{ id: 1, name: 'deli' }]);
    expect(p.newCategories).toEqual(['Frozen']);
  });
});

describe('exportRow and TEMPLATE_ROW', () => {
  test('flattens Prisma values and calculates Kg / Case', () => {
    expect(exportRow({
      id: 1, sku: 'S1', name: 'Fries', isActive: true, category: { name: 'FRIES' }, unit: 'pack',
      description: null, costPrice: '200.00', sellingPrice: '285.00', reorderLevel: '5.000',
      warehouseLocation: null, weightPerPackKg: '1.000', packsPerCase: 10, pcsPerPack: null,
    })).toEqual({
      sku: 'S1', name: 'Fries', category: 'FRIES', unit: 'pack', description: null,
      costPrice: 200, sellingPrice: 285, reorderLevel: 5, warehouseLocation: null,
      weightPerPackKg: 1, packsPerCase: 10, kgPerCase: 10, pcsPerPack: null,
    });
  });

  test('the template row fills every column', () => {
    expect(Object.keys(TEMPLATE_ROW).sort()).toEqual(COLUMNS.map((c) => c.key).sort());
  });
});
