const { kgPerCase, packagingLabel } = require('../lib/packaging');

describe('kgPerCase', () => {
  test('weight per pack times packs per case', () => {
    expect(kgPerCase(1, 10)).toBe(10);
    expect(kgPerCase('0.25', '12')).toBe(3);
    expect(kgPerCase('1.000', 10)).toBe(10); // a Prisma Decimal arrives as a string
  });

  test('null when either part is missing', () => {
    expect(kgPerCase(null, 10)).toBeNull();
    expect(kgPerCase(1, '')).toBeNull();
    expect(kgPerCase(undefined, undefined)).toBeNull();
  });

  test('rounds to grams', () => {
    expect(kgPerCase(0.333, 3)).toBe(0.999);
    expect(kgPerCase(0.1, 3)).toBe(0.3);
  });
});

describe('packagingLabel', () => {
  test('lists only the parts that are set', () => {
    expect(packagingLabel({ weightPerPackKg: '1.000', packsPerCase: 10, pcsPerPack: 11 }))
      .toBe('1 kg/pack · 10 packs/case · 11 pcs/pack');
    expect(packagingLabel({ weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: null }))
      .toBe('1 kg/pack · 10 packs/case');
    expect(packagingLabel({})).toBe('');
  });
});
