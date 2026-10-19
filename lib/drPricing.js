// Prices for the printed delivery receipt. A DR stores no prices, so they are read
// from the linked invoice (matched by line description) or, for a stocked item
// without an invoice, from the item's selling price. Shared CommonJS so it can be
// unit tested.

const VAT_RATE = 0.12;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || '').trim().toLowerCase();

function priceLines(dr) {
  const pool = ((dr.invoice && dr.invoice.lines) || []).map((l) => ({ ...l, used: false }));

  const lines = dr.lines.map((l) => {
    const qty = Number(l.quantity);
    const match = pool.find((p) => !p.used && norm(p.description) === norm(l.description));
    if (match) {
      match.used = true;
      const unitPrice = Number(match.unitPrice);
      const amount = Number(match.quantity) === qty ? round2(match.amount) : round2(qty * unitPrice);
      return { ...l, unitPrice, amount, vatCode: match.vatCode };
    }
    const selling = l.item ? Number(l.item.sellingPrice) : 0;
    if (selling > 0) return { ...l, unitPrice: selling, amount: round2(qty * selling), vatCode: null };
    return { ...l, unitPrice: null, amount: null, vatCode: null };
  });

  const priced = lines.filter((l) => l.amount !== null);
  const subtotal = round2(priced.reduce((s, l) => s + l.amount, 0));
  const vat = round2(priced.filter((l) => l.vatCode === 'VAT').reduce((s, l) => s + l.amount, 0) * VAT_RATE);
  return { lines, hasPrices: priced.length > 0, subtotal, vat, total: round2(subtotal + vat) };
}

module.exports = { priceLines };
