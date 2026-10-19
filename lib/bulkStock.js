// Bulk stock movement: what each transaction type means for a line.
export const MOVEMENT_TYPES = [
  { value: 'IN',         label: 'Stock In',           qtyLabel: 'Qty received', hint: 'Adds the received quantity. A new cost becomes the item cost.' },
  { value: 'OUT',        label: 'Stock Out',          qtyLabel: 'Qty out',      hint: 'Deducts the quantity from stock.' },
  { value: 'ADJUSTMENT', label: 'Adjustment',         qtyLabel: 'Actual count', hint: 'Sets stock to the counted quantity; the difference is recorded.' },
  { value: 'RETURN_IN',  label: 'Customer Return',    qtyLabel: 'Qty returned', hint: 'Adds goods returned by a customer back to stock.' },
  { value: 'RETURN_OUT', label: 'Return to Supplier', qtyLabel: 'Qty returned', hint: 'Deducts goods sent back to the supplier.' },
];

const round3 = (n) => Math.round(n * 1000) / 1000;

// Signed change in stock for a line. ADJUSTMENT treats qty as the new count.
export function stockDelta(type, current, qty) {
  const q = Number(qty);
  const cur = Number(current) || 0;
  if (type === 'ADJUSTMENT') return round3(q - cur);
  if (type === 'OUT' || type === 'RETURN_OUT') return round3(-q);
  return round3(q);
}

// Stock after the movement, or null while no quantity has been entered.
export function newStockFor(type, current, qty) {
  if (qty === '' || qty === null || qty === undefined || Number.isNaN(Number(qty))) return null;
  return round3((Number(current) || 0) + stockDelta(type, current, qty));
}

// What a row will do, or an error message, given its inputs.
export function planRow(type, item, row) {
  const hasQty = row.qty !== '' && row.qty !== null && row.qty !== undefined;
  const qty = Number(row.qty);
  const cost = row.cost === '' ? Number(item.costPrice) : Number(row.cost);
  const price = row.price === '' ? Number(item.sellingPrice) : Number(row.price);
  if (hasQty && (!Number.isFinite(qty) || qty < 0)) return { error: 'Quantity must be 0 or more' };
  if (!Number.isFinite(cost) || cost < 0) return { error: 'Cost must be 0 or more' };
  if (!Number.isFinite(price) || price < 0) return { error: 'Selling price must be 0 or more' };
  if (hasQty && type !== 'ADJUSTMENT' && qty === 0) return { error: 'Quantity must be greater than 0' };

  const delta = hasQty ? stockDelta(type, item.currentStock, qty) : 0;
  const moves = hasQty && delta !== 0;
  const costChanged = cost !== Number(item.costPrice);
  const priceChanged = price !== Number(item.sellingPrice);
  return {
    qty, cost, price, delta, moves, costChanged, priceChanged,
    // IN already carries its cost into the item on the server
    updateItem: priceChanged || (costChanged && !(moves && type === 'IN' && cost > 0)),
    nothing: !moves && !costChanged && !priceChanged,
  };
}
