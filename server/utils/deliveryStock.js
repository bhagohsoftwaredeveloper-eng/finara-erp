// Stock movement for Delivery Receipts. Mirrors cashSaleController: OUT at cost on
// the way out, RETURN_IN on the way back, and the same COGS/Inventory journal lines.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function nextTxnSeq(tx) {
  const last = await tx.inventoryTransaction.findFirst({ orderBy: { id: 'desc' } });
  return last ? last.id + 1 : 1;
}
const txnNo = (seq) => `INV-TXN-${String(seq).padStart(6, '0')}`;

// Selling past zero is allowed (same as cash sales): stock may go negative until
// the purchase or receiving is recorded.
async function deductStock(tx, { drNo, drDate, lines }) {
  let seq = await nextTxnSeq(tx);
  const movements = [];
  for (const { quantity, item } of lines) {
    const newStock = round2(Number(item.currentStock) - quantity);
    const unitCost = Number(item.costPrice);
    const totalCost = round2(quantity * unitCost);
    await tx.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } });
    await tx.inventoryTransaction.create({
      data: {
        txnNo: txnNo(seq++), itemId: item.id, type: 'OUT', quantity, unitCost, totalCost,
        runningStock: newStock, reference: drNo, notes: `Delivery receipt — ${drNo}`,
        txnDate: new Date(drDate),
      },
    });
    movements.push({ item, quantity, totalCost });
  }
  return movements;
}

async function restoreStock(tx, { drNo, businessId }) {
  const outs = await tx.inventoryTransaction.findMany({
    where: { reference: drNo, type: 'OUT', item: { businessId } },
  });
  if (!outs.length) return [];

  let seq = await nextTxnSeq(tx);
  const movements = [];
  for (const out of outs) {
    const item = await tx.inventoryItem.findFirst({ where: { id: out.itemId, businessId } });
    if (!item) continue;
    const newStock = round2(Number(item.currentStock) + Number(out.quantity));
    await tx.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } });
    await tx.inventoryTransaction.create({
      data: {
        txnNo: txnNo(seq++), itemId: item.id, type: 'RETURN_IN', quantity: out.quantity,
        unitCost: out.unitCost, totalCost: out.totalCost, runningStock: newStock,
        reference: drNo, notes: `Cancelled — ${drNo}`, txnDate: new Date(),
      },
    });
    movements.push({ item, quantity: Number(out.quantity), totalCost: Number(out.totalCost) });
  }
  return movements;
}

// Journal lines for a set of movements: DR COGS / CR Inventory going out, the
// opposite when reversing. Zero-cost movements post nothing.
function cogsLines(movements, { reverse = false } = {}) {
  return movements.filter((m) => m.totalCost > 0).flatMap(({ item, quantity, totalCost }) => {
    const cogs = item.cogsAccountId ? { accountId: item.cogsAccountId } : { accountCode: '5010' };
    const inv  = item.inventoryAccountId ? { accountId: item.inventoryAccountId } : { accountCode: '1210' };
    return reverse
      ? [
          { ...inv,  debit:  totalCost, description: `Inventory in — ${item.name} (cancelled)` },
          { ...cogs, credit: totalCost, description: `COGS reversal — ${item.sku} (cancelled)` },
        ]
      : [
          { ...cogs, debit:  totalCost, description: `COGS — ${item.sku} ×${quantity}` },
          { ...inv,  credit: totalCost, description: `Inventory out — ${item.name}` },
        ];
  });
}

module.exports = { deductStock, restoreStock, cogsLines };
