const { parsePackageInput, packageComponents } = require('../server/utils/packageInput');

describe('parsePackageInput', () => {
  const ok = { name: '  Starter Kit ', price: '1500', items: [{ itemId: 1, quantity: 2 }, { itemId: '2', quantity: '1.5' }] };

  test('normalizes a valid package', () => {
    expect(parsePackageInput(ok)).toEqual({
      name: 'Starter Kit', description: null, price: 1500, accountId: null, vatCode: 'VAT',
      items: [{ itemId: 1, quantity: 2 }, { itemId: 2, quantity: 1.5 }],
    });
  });

  test('requires a name, a price of 0 or more, and at least one item', () => {
    expect(() => parsePackageInput({ ...ok, name: '  ' })).toThrow(/name is required/);
    expect(() => parsePackageInput({ ...ok, price: -1 })).toThrow(/price/);
    expect(() => parsePackageInput({ ...ok, price: 'abc' })).toThrow(/price/);
    expect(() => parsePackageInput({ ...ok, items: [] })).toThrow(/at least one item/);
  });

  test('rejects a repeated item, a bad quantity and an unknown VAT code', () => {
    expect(() => parsePackageInput({ ...ok, items: [{ itemId: 1, quantity: 1 }, { itemId: 1, quantity: 2 }] })).toThrow(/twice/);
    expect(() => parsePackageInput({ ...ok, items: [{ itemId: 1, quantity: 0 }] })).toThrow(/quantity/);
    expect(() => parsePackageInput({ ...ok, vatCode: 'NOPE' })).toThrow(/VAT code/);
  });

  test('a free package (price 0) is allowed', () => {
    expect(parsePackageInput({ ...ok, price: 0 }).price).toBe(0);
  });
});

describe('packageComponents', () => {
  const pkg = {
    items: [
      { quantity: '2', item: { name: 'Tarpaulin', sku: 'SKU-1', unit: 'pcs' } },
      { quantity: '0.5', item: { name: 'Ink', sku: 'SKU-2', unit: 'L' } },
    ],
  };

  test('lists names and quantities scaled by the package quantity, with no prices', () => {
    const rows = packageComponents(pkg, 3);
    expect(rows).toEqual([
      { description: 'Tarpaulin', sku: 'SKU-1', unit: 'pcs', quantity: 6 },
      { description: 'Ink', sku: 'SKU-2', unit: 'L', quantity: 1.5 },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/price|cost/i);
  });
});
