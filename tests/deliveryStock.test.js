const { deductStock, restoreStock, cogsLines } = require('../server/utils/deliveryStock');

const item = (over = {}) => ({
  id: 7, sku: 'A-1', name: 'Widget', currentStock: '10', costPrice: '25.5',
  cogsAccountId: null, inventoryAccountId: null, ...over,
});

const fakeTx = (over = {}) => ({
  inventoryItem: { update: jest.fn(), findFirst: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 41 }), create: jest.fn(), findMany: jest.fn() },
  ...over,
});

describe('deductStock', () => {
  test('lowers stock, records an OUT transaction at cost, and returns the movement', async () => {
    const tx = fakeTx();
    const widget = item();

    const out = await deductStock(tx, { drNo: 'DR-000001', drDate: '2026-02-03', lines: [{ quantity: 2, item: widget }] });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: 8 } });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: {
        txnNo: 'INV-TXN-000042', itemId: 7, type: 'OUT', quantity: 2, unitCost: 25.5, totalCost: 51,
        runningStock: 8, reference: 'DR-000001', notes: 'Delivery receipt — DR-000001',
        txnDate: new Date('2026-02-03'),
      },
    });
    expect(out).toEqual([{ item: widget, quantity: 2, totalCost: 51 }]);
  });

  test('numbers several transactions in sequence', async () => {
    const tx = fakeTx();

    await deductStock(tx, {
      drNo: 'DR-000001', drDate: '2026-02-03',
      lines: [{ quantity: 1, item: item() }, { quantity: 1, item: item({ id: 8 }) }],
    });

    const nos = tx.inventoryTransaction.create.mock.calls.map((c) => c[0].data.txnNo);
    expect(nos).toEqual(['INV-TXN-000042', 'INV-TXN-000043']);
  });

  test('may take stock below zero, like a cash sale', async () => {
    const tx = fakeTx();

    await deductStock(tx, { drNo: 'DR-000001', drDate: '2026-02-03', lines: [{ quantity: 3, item: item({ currentStock: '1' }) }] });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: -2 } });
  });

  test('starts numbering at 1 when there are no transactions yet', async () => {
    const tx = fakeTx();
    tx.inventoryTransaction.findFirst.mockResolvedValue(null);

    await deductStock(tx, { drNo: 'DR-000001', drDate: '2026-02-03', lines: [{ quantity: 1, item: item() }] });

    expect(tx.inventoryTransaction.create.mock.calls[0][0].data.txnNo).toBe('INV-TXN-000001');
  });
});

describe('restoreStock', () => {
  test('puts back what the OUT transactions took, as RETURN_IN', async () => {
    const tx = fakeTx();
    const widget = item({ currentStock: '8' });
    tx.inventoryTransaction.findMany.mockResolvedValue([
      { itemId: 7, quantity: '2', unitCost: '25.5', totalCost: '51' },
    ]);
    tx.inventoryItem.findFirst.mockResolvedValue(widget);

    const back = await restoreStock(tx, { drNo: 'DR-000001', businessId: 1 });

    expect(tx.inventoryTransaction.findMany).toHaveBeenCalledWith({
      where: { reference: 'DR-000001', type: 'OUT', item: { businessId: 1 } },
    });
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: 10 } });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'RETURN_IN', itemId: 7, quantity: '2', totalCost: '51', runningStock: 10,
        reference: 'DR-000001', notes: 'Cancelled — DR-000001',
      }),
    });
    expect(back).toEqual([{ item: widget, quantity: 2, totalCost: 51 }]);
  });

  test('returns nothing when the DR moved no stock', async () => {
    const tx = fakeTx();
    tx.inventoryTransaction.findMany.mockResolvedValue([]);

    expect(await restoreStock(tx, { drNo: 'DR-000001', businessId: 1 })).toEqual([]);
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});

describe('cogsLines', () => {
  const m = (over = {}) => ({ item: item(over), quantity: 2, totalCost: 51 });

  test('falls back to the default COGS (5010) and Inventory (1210) accounts', () => {
    expect(cogsLines([m()])).toEqual([
      { accountCode: '5010', debit: 51, description: 'COGS — A-1 ×2' },
      { accountCode: '1210', credit: 51, description: 'Inventory out — Widget' },
    ]);
  });

  test("uses the item's own accounts when set", () => {
    const lines = cogsLines([m({ cogsAccountId: 90, inventoryAccountId: 91 })]);
    expect(lines[0]).toMatchObject({ accountId: 90, debit: 51 });
    expect(lines[1]).toMatchObject({ accountId: 91, credit: 51 });
  });

  test('reverse swaps the sides', () => {
    expect(cogsLines([m()], { reverse: true })).toEqual([
      { accountCode: '1210', debit: 51, description: 'Inventory in — Widget (cancelled)' },
      { accountCode: '5010', credit: 51, description: 'COGS reversal — A-1 (cancelled)' },
    ]);
  });

  test('skips movements with no cost', () => {
    expect(cogsLines([{ item: item(), quantity: 1, totalCost: 0 }])).toEqual([]);
  });
});
