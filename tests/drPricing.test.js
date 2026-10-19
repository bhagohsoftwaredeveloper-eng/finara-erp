const { priceLines } = require('../lib/drPricing');

const line = (description, quantity, item = null) => ({ description, quantity: String(quantity), item });
const invLine = (description, quantity, unitPrice, amount, vatCode = 'VAT') => ({
  description, quantity: String(quantity), unitPrice: String(unitPrice), amount: String(amount), vatCode,
});

describe('priceLines', () => {
  test('prices come from the matching invoice line, ignoring case and spacing', () => {
    const dr = {
      lines: [line('1702Q 2nd Quarter', 1), line(' Processing Fee ', 2)],
      invoice: { lines: [invLine('processing fee', 2, 500, 1000), invLine('1702Q 2ND QUARTER', 1, 3000, 3000)] },
    };

    const r = priceLines(dr);

    expect(r.hasPrices).toBe(true);
    expect(r.lines.map((l) => [l.unitPrice, l.amount])).toEqual([[3000, 3000], [500, 1000]]);
  });

  test('VAT is worked out from the invoice lines marked VAT, and added to the total', () => {
    const dr = {
      lines: [line('Service', 1), line('Exempt thing', 1)],
      invoice: { lines: [invLine('Service', 1, 1000, 1000, 'VAT'), invLine('Exempt thing', 1, 200, 200, 'EXEMPT')] },
    };

    const r = priceLines(dr);

    expect(r.subtotal).toBe(1200);
    expect(r.vat).toBe(120);
    expect(r.total).toBe(1320);
  });

  test('a discount line keeps the invoice amount and lowers the subtotal', () => {
    const dr = {
      lines: [line('Service', 1), line('Sales Discount', 1)],
      invoice: { lines: [invLine('Service', 1, 1000, 1000), invLine('Sales Discount', 1, 100, -100)] },
    };

    const r = priceLines(dr);

    expect(r.lines[1].amount).toBe(-100);
    expect(r.subtotal).toBe(900);
  });

  test('when the delivered quantity differs from the invoiced one the amount follows the delivered quantity', () => {
    const dr = { lines: [line('Widget', 3)], invoice: { lines: [invLine('Widget', 10, 50, 500)] } };

    expect(priceLines(dr).lines[0]).toMatchObject({ unitPrice: 50, amount: 150 });
  });

  test('the same invoice line is not used twice', () => {
    const dr = { lines: [line('Widget', 1), line('Widget', 1)], invoice: { lines: [invLine('Widget', 1, 50, 50)] } };

    const r = priceLines(dr);

    expect(r.lines[0].unitPrice).toBe(50);
    expect(r.lines[1].unitPrice).toBeNull();
  });

  test('without an invoice a stocked item uses its selling price, with no VAT added', () => {
    const dr = { invoice: null, lines: [line('Widget', 4, { sellingPrice: '25.5' }), line('Loose text', 1)] };

    const r = priceLines(dr);

    expect(r.lines[0]).toMatchObject({ unitPrice: 25.5, amount: 102 });
    expect(r.lines[1].unitPrice).toBeNull();
    expect(r).toMatchObject({ subtotal: 102, vat: 0, total: 102, hasPrices: true });
  });

  test('nothing priced means no price columns', () => {
    const r = priceLines({ invoice: null, lines: [line('Loose text', 1), line('Widget', 1, { sellingPrice: '0' })] });

    expect(r.hasPrices).toBe(false);
    expect(r).toMatchObject({ subtotal: 0, vat: 0, total: 0 });
  });
});
