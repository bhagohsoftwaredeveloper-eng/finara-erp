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
