# Delivery Receipt Implementation Plan (Receivables Docs, Phase 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Delivery Receipt (DR) document that can be created from an invoice (A), created on its own and later converted to an invoice (B), and optionally deducts inventory when delivered (C), with an A4 print that has Prepared by / Delivered by / Received by signature lines.

**Architecture:** New `DeliveryReceipt` + `DeliveryReceiptLine` tables. DR statuses: DRAFT, DELIVERED, CANCELLED. Marking DELIVERED (when "Deduct from inventory" is on) writes OUT `InventoryTransaction`s and posts a COGS/Inventory journal entry, exactly like Cash Sales do; cancelling a delivered DR reverses both. A DR optionally links to an invoice (`invoiceId`); invoices never touch stock, so a DR stock-out cannot double-deduct.

**Tech Stack:** Express + Prisma 5 (MySQL), Next.js 14, Jest.

Spec: `docs/superpowers/specs/2026-10-19-receivables-docs-design.md` (section 4).

**Decisions made while planning (verified against `cashSaleController.js`):**
- Stock may go negative on delivery, same as Cash Sales ("selling past zero is allowed"). No insufficient-stock block.
- Cash Sales post `DR COGS (5010 fallback) / CR Inventory (1210 fallback)` after the stock-out and reverse it on void. The DR does the same.
- One inventory item may appear on only one line of a DR (same rule as Cash Sales), so a cancellation can reverse stock one-to-one.
- Cancelling a delivered DR resets its linked invoice to "not shipped" only when no other delivered DR is linked and the invoice has no courier or tracking number (i.e. the shipped flag came from the DR, not from a manual "Mark as Shipped").

**Prerequisites:** phases 1-3 merged.

## Global Constraints

- Same isolated worktree as the earlier phases. The main working tree has uncommitted user changes in `server/controllers/receivableController.js`, `app/(dashboard)/receivable/page.jsx`, `lib/api.js`, `components/layout/Sidebar.jsx`, `lib/print.js`, `prisma/schema.prisma`; never `git add` those from the main tree. No `isolation: "worktree"` for subagents inside the worktree.
- Every Prisma query is scoped by `req.businessId`.
- Document numbers: `DR-000001` via `nextDocNumber` (`server/utils/docNumber.js`), derived from the last issued number.
- Migration SQL is hand-written with the Write tool (no BOM), applied with `npm run db:deploy`. Ask the user to stop `npm run dev` before `npm run db:generate` (Windows EPERM). Never start a competing dev server; never run `next build` where it runs.
- Print only through `printDocument` from `@/lib/print` (`phpFmt()` / `dateFmt()` inside the HTML string).
- Tests: `npx jest tests/<file>.test.js`. Commits list explicit paths and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (Customer, Invoice, InventoryItem back-relations; new models after `InvoiceLine`)
- Create: `prisma/migrations/20261019100000_add_delivery_receipts/migration.sql`

**Interfaces:**
- Produces Prisma models `deliveryReceipt`, `deliveryReceiptLine`, enum `DeliveryReceiptStatus`.

- [ ] **Step 1: Back-relations.** In `model Customer` add `deliveryReceipts DeliveryReceipt[]` after `quotations  Quotation[]`. In `model Invoice` add `deliveryReceipts DeliveryReceipt[]` after `installment Installment?`. In `model InventoryItem` add `deliveryReceiptLines DeliveryReceiptLine[]` after `packageItems        PackageItem[]`.

- [ ] **Step 2: Models.** Directly after `model InvoiceLine { ... }` add:

```prisma
// ─── Delivery Receipts ─────────────────────────────────────
enum DeliveryReceiptStatus {
  DRAFT
  DELIVERED
  CANCELLED
}

model DeliveryReceipt {
  id              Int                   @id @default(autoincrement())
  businessId      Int                   @default(1)
  drNo            String                @unique @db.VarChar(30)
  customerId      Int
  customer        Customer              @relation(fields: [customerId], references: [id])
  invoiceId       Int?
  invoice         Invoice?              @relation(fields: [invoiceId], references: [id])
  drDate          DateTime              @db.Date
  deliveryAddress String?               @db.Text
  driverName      String?               @db.VarChar(100)
  vehicleNo       String?               @db.VarChar(50)
  notes           String?               @db.Text
  status          DeliveryReceiptStatus @default(DRAFT)
  // When true, marking DELIVERED takes the stocked lines out of inventory.
  deductStock     Boolean               @default(false)
  deliveredAt     DateTime?
  cancelledAt     DateTime?
  cancelReason    String?               @db.VarChar(255)
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  lines           DeliveryReceiptLine[]

  @@index([businessId])
  @@index([customerId])
  @@index([invoiceId])
  @@index([status])
  @@map("delivery_receipts")
}

model DeliveryReceiptLine {
  id                Int             @id @default(autoincrement())
  deliveryReceiptId Int
  deliveryReceipt   DeliveryReceipt @relation(fields: [deliveryReceiptId], references: [id], onDelete: Cascade)
  itemId            Int?
  item              InventoryItem?  @relation(fields: [itemId], references: [id])
  description       String          @db.VarChar(255)
  quantity          Decimal         @default(1) @db.Decimal(12, 3)
  unit              String?         @db.VarChar(20)

  @@index([deliveryReceiptId])
  @@index([itemId])
  @@map("delivery_receipt_lines")
}
```

- [ ] **Step 3: Migration** (Write tool)

```sql
-- CreateTable
CREATE TABLE `delivery_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `drNo` VARCHAR(30) NOT NULL,
    `customerId` INTEGER NOT NULL,
    `invoiceId` INTEGER NULL,
    `drDate` DATE NOT NULL,
    `deliveryAddress` TEXT NULL,
    `driverName` VARCHAR(100) NULL,
    `vehicleNo` VARCHAR(50) NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `deductStock` BOOLEAN NOT NULL DEFAULT false,
    `deliveredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `delivery_receipts_drNo_key`(`drNo`),
    INDEX `delivery_receipts_businessId_idx`(`businessId`),
    INDEX `delivery_receipts_customerId_idx`(`customerId`),
    INDEX `delivery_receipts_invoiceId_idx`(`invoiceId`),
    INDEX `delivery_receipts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_receipt_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deliveryReceiptId` INTEGER NOT NULL,
    `itemId` INTEGER NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 1,
    `unit` VARCHAR(20) NULL,

    INDEX `delivery_receipt_lines_deliveryReceiptId_idx`(`deliveryReceiptId`),
    INDEX `delivery_receipt_lines_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `delivery_receipts` ADD CONSTRAINT `delivery_receipts_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_receipts` ADD CONSTRAINT `delivery_receipts_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_receipt_lines` ADD CONSTRAINT `delivery_receipt_lines_deliveryReceiptId_fkey` FOREIGN KEY (`deliveryReceiptId`) REFERENCES `delivery_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_receipt_lines` ADD CONSTRAINT `delivery_receipt_lines_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Validate, apply, regenerate.** `npx prisma validate` (expect "is valid"). Ask the user to stop `npm run dev`, then `npm run db:deploy` and `npm run db:generate`. Expected: `Applying migration 20261019100000_add_delivery_receipts`, `Generated Prisma Client`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261019100000_add_delivery_receipts/migration.sql
git commit -m "feat(dr): DeliveryReceipt and DeliveryReceiptLine models"
```

---

### Task 2: Stock movement helpers

**Files:**
- Create: `server/utils/deliveryStock.js`
- Test: `tests/deliveryStock.test.js`

**Interfaces:**
- Produces (all take a Prisma transaction client `tx`):
  - `deductStock(tx, { drNo, drDate, lines }): Promise<Movement[]>` where `lines: Array<{ quantity: number, item: InventoryItem }>` and `Movement = { item, quantity: number, totalCost: number }`. Writes the item's new `currentStock`, one `OUT` `InventoryTransaction` per line (`reference: drNo`).
  - `restoreStock(tx, { drNo, businessId }): Promise<Movement[]>` reverses every `OUT` transaction referenced by `drNo` with a `RETURN_IN`.
  - `cogsLines(movements, { reverse = false }): GlLine[]` (pure). GL line shape: `{ accountId | accountCode, debit | credit, description }`.

- [ ] **Step 1: Write the failing tests** (`tests/deliveryStock.test.js`)

```js
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
```

- [ ] **Step 2: Run, expect FAIL** (`Run: npx jest tests/deliveryStock.test.js`; module not found).

- [ ] **Step 3: Implement `server/utils/deliveryStock.js`**

```js
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
```

- [ ] **Step 4: Run, expect PASS** (`npx jest tests/deliveryStock.test.js`).

- [ ] **Step 5: Commit**

```bash
git add server/utils/deliveryStock.js tests/deliveryStock.test.js
git commit -m "feat(dr): stock deduct/restore and COGS journal lines for deliveries"
```

---

### Task 3: Delivery receipt controller and routes

**Files:**
- Create: `server/controllers/deliveryReceiptController.js`
- Create: `server/routes/deliveryReceipts.js`
- Modify: `server/routes/receivable.js` (mount before `router.get('/:id', ...)`)
- Modify: `lib/api.js` (`receivable.deliveryReceipts`)
- Modify: `server/controllers/backupController.js` (receivable section)
- Test: `tests/deliveryReceiptController.test.js`

**Interfaces:**
- Consumes: `deductStock`, `restoreStock`, `cogsLines` (Task 2); `nextDocNumber`; `glPost.safePost`.
- Produces HTTP (all under `/api/receivable/delivery-receipts`):
  - `GET /?status&customerId&search&from&to` list; `GET /:id`;
  - `POST /` body `{ customerId? , invoiceId?, drDate, deliveryAddress?, driverName?, vehicleNo?, notes?, deductStock?, lines?: [{ itemId?, description, quantity, unit? }] }`. With `invoiceId` the customer, address and (when no `lines` are sent) the lines come from the invoice;
  - `PUT /:id` (DRAFT only), `POST /:id/deliver`, `POST /:id/cancel` (ADMIN, MANAGER) body `{ reason? }`.
- Produces (for Task 4): `prepareLink(deliveryReceiptId, customerId, businessId): Promise<DeliveryReceipt>` and `applyLink(dr, invoiceId): Promise<void>`.
- DR JSON includes `customer {id,name,customerCode,address,tin}`, `invoice {id,invoiceNo,status}|null`, `lines[] { id, itemId, description, quantity, unit, item {id,sku,name,unit,sellingPrice,revenueAccountId}|null }`.

- [ ] **Step 1: Write the failing tests** (`tests/deliveryReceiptController.test.js`)

```js
jest.mock('../server/config/database', () => ({
  deliveryReceipt: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  invoice: { findFirst: jest.fn(), update: jest.fn() },
  customer: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), update: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/deliveryReceiptController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 5 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const widget = { id: 7, sku: 'A-1', name: 'Widget', currentStock: '10', costPrice: '25.5', cogsAccountId: null, inventoryAccountId: null };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma)); // the mocked client doubles as tx
  prisma.deliveryReceipt.findFirst.mockResolvedValue(null);          // genDrNo: no DR yet
  prisma.inventoryTransaction.findFirst.mockResolvedValue({ id: 41 });
});

describe('create', () => {
  test('from an invoice: uses its customer, address and lines, and expands package contents', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 3, status: 'OPEN', customerId: 9, shippingAddress: 'Cebu City',
      lines: [
        { description: 'Delivery fee', quantity: '1', packageId: null, packageComponents: null },
        { description: 'Starter kit', quantity: '2', packageId: 4,
          packageComponents: [{ description: 'Cable', quantity: 4, unit: 'pcs' }, { description: 'Router', quantity: 2, unit: 'pcs' }] },
      ],
    });
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: 'Main St' });
    prisma.deliveryReceipt.create.mockResolvedValue({ id: 1 });

    await run(ctrl.create, { body: { invoiceId: 3, drDate: '2026-02-03' } });

    expect(prisma.deliveryReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 1, drNo: 'DR-000001', customerId: 9, invoiceId: 3,
        deliveryAddress: 'Cebu City',
        lines: { create: [
          { itemId: null, description: 'Delivery fee', quantity: 1, unit: null },
          { itemId: null, description: 'Cable', quantity: 4, unit: 'pcs' },
          { itemId: null, description: 'Router', quantity: 2, unit: 'pcs' },
        ] },
      }),
    }));
  });

  test('standalone needs a customer and at least one valid line', async () => {
    await expect(run(ctrl.create, { body: { drDate: '2026-02-03', lines: [] } })).rejects.toThrow('customerId or invoiceId');

    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: null });
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [] } })).rejects.toThrow('at least one line');
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [{ description: ' ', quantity: 1 }] } }))
      .rejects.toThrow('description');
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [{ description: 'X', quantity: 0 }] } }))
      .rejects.toThrow('quantity');
  });

  test('the same inventory item twice, or an item of another business, is rejected', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: null });
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: 7 });
    const twice = [{ itemId: 7, description: 'Widget', quantity: 1 }, { itemId: 7, description: 'Widget', quantity: 2 }];
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: twice } })).rejects.toThrow('two lines');

    prisma.inventoryItem.findFirst.mockResolvedValue(null);
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [twice[0]] } })).rejects.toThrow('not found');
    expect(prisma.deliveryReceipt.create).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  test('only a draft can be edited', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue({ id: 1, status: 'DELIVERED' });

    await expect(run(ctrl.update, { params: { id: '1' }, body: { lines: [{ description: 'X', quantity: 1 }] } }))
      .rejects.toThrow('Only draft');
  });
});

describe('deliver', () => {
  const draft = (over = {}) => ({
    id: 1, businessId: 1, drNo: 'DR-000001', status: 'DRAFT', drDate: new Date('2026-02-03'), invoiceId: 3,
    deductStock: true, lines: [{ quantity: '2', item: widget }, { quantity: '1', item: null }], ...over,
  });

  test('takes stocked lines out of inventory, posts COGS, marks the invoice shipped', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(draft());
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, deliveryStatus: 'PENDING' });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1, status: 'DELIVERED' });

    await run(ctrl.deliver, { params: { id: '1' } });

    expect(prisma.inventoryItem.update).toHaveBeenCalledTimes(1); // the unstocked line moves nothing
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: 8 } });
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: expect.objectContaining({ deliveryStatus: 'SHIPPED' }),
    });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'DR-000001', businessId: 1,
      lines: [
        { accountCode: '5010', debit: 51, description: 'COGS — A-1 ×2' },
        { accountCode: '1210', credit: 51, description: 'Inventory out — Widget' },
      ],
    }));
  });

  test('without "deduct stock" no inventory moves and no journal is posted', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(draft({ deductStock: false, invoiceId: null }));
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });

    await run(ctrl.deliver, { params: { id: '1' } });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('only a draft can be delivered', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(draft({ status: 'DELIVERED' }));

    await expect(run(ctrl.deliver, { params: { id: '1' } })).rejects.toThrow('draft');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  const delivered = (over = {}) => ({
    id: 1, businessId: 1, drNo: 'DR-000001', status: 'DELIVERED', invoiceId: 3, deductStock: true, lines: [], ...over,
  });

  test('a delivered DR puts the stock back, reverses the journal and un-ships a DR-only invoice', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered());
    prisma.inventoryTransaction.findMany.mockResolvedValue([{ itemId: 7, quantity: '2', unitCost: '25.5', totalCost: '51' }]);
    prisma.inventoryItem.findFirst.mockResolvedValue({ ...widget, currentStock: '8' });
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, courier: null, trackingNumber: null });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1, status: 'CANCELLED' });

    await run(ctrl.cancel, { params: { id: '1' }, body: { reason: 'Wrong address' } });

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: 10 } });
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', cancelReason: 'Wrong address' }),
    }));
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { deliveryStatus: 'PENDING', shippedDate: null } });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: [
        { accountCode: '1210', debit: 51, description: 'Inventory in — Widget (cancelled)' },
        { accountCode: '5010', credit: 51, description: 'COGS reversal — A-1 (cancelled)' },
      ],
    }));
  });

  test('keeps the invoice shipped when it was shipped by hand (has a courier)', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered({ deductStock: false }));
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, courier: 'LBC', trackingNumber: null });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });

    await run(ctrl.cancel, { params: { id: '1' }, body: {} });

    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('a draft is simply cancelled; a cancelled DR cannot be cancelled again', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered({ status: 'DRAFT', invoiceId: null, deductStock: false }));
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });
    await run(ctrl.cancel, { params: { id: '1' }, body: {} });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();

    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered({ status: 'CANCELLED' }));
    await expect(run(ctrl.cancel, { params: { id: '1' }, body: {} })).rejects.toThrow('already cancelled');
  });
});

describe('invoice linking helpers', () => {
  test('prepareLink accepts a free DR of the same customer', async () => {
    const dr = { id: 1, status: 'DRAFT', invoiceId: null, customerId: 9 };
    prisma.deliveryReceipt.findFirst.mockResolvedValue(dr);

    expect(await ctrl.prepareLink(1, 9, 1)).toBe(dr);
    expect(prisma.deliveryReceipt.findFirst).toHaveBeenCalledWith({ where: { id: 1, businessId: 1 } });
  });

  test.each([
    [null, 'not found'],
    [{ id: 1, status: 'CANCELLED', invoiceId: null, customerId: 9 }, 'cancelled'],
    [{ id: 1, status: 'DRAFT', invoiceId: 2, customerId: 9 }, 'already linked'],
    [{ id: 1, status: 'DRAFT', invoiceId: null, customerId: 10 }, 'different customer'],
  ])('prepareLink rejects %j', async (dr, msg) => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(dr);

    await expect(ctrl.prepareLink(1, 9, 1)).rejects.toThrow(msg);
  });

  test('applyLink links the DR and ships the invoice only when the DR was already delivered', async () => {
    await ctrl.applyLink({ id: 1, status: 'DRAFT' }, 3);
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { invoiceId: 3 } });
    expect(prisma.invoice.update).not.toHaveBeenCalled();

    await ctrl.applyLink({ id: 2, status: 'DELIVERED', deliveredAt: new Date('2026-02-04') }, 3);
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: { deliveryStatus: 'SHIPPED', shippedDate: new Date('2026-02-04') },
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Run: npx jest tests/deliveryReceiptController.test.js`; module not found).

- [ ] **Step 3: Implement `server/controllers/deliveryReceiptController.js`**

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const { nextDocNumber } = require('../utils/docNumber');
const { deductStock, restoreStock, cogsLines } = require('../utils/deliveryStock');

const DR_INCLUDE = {
  customer: { select: { id: true, name: true, customerCode: true, address: true, tin: true } },
  invoice:  { select: { id: true, invoiceNo: true, status: true } },
  lines: {
    include: { item: { select: { id: true, sku: true, name: true, unit: true, sellingPrice: true, revenueAccountId: true } } },
    orderBy: { id: 'asc' },
  },
};

const genDrNo = async () => {
  const last = await prisma.deliveryReceipt.findFirst({
    where: { drNo: { startsWith: 'DR-' } }, orderBy: { drNo: 'desc' }, select: { drNo: true },
  });
  return nextDocNumber('DR-', last?.drNo, 6);
};

async function findDr(id, businessId, include) {
  const dr = await prisma.deliveryReceipt.findFirst({ where: { id, businessId }, ...(include && { include }) });
  if (!dr) throw createError('Delivery receipt not found', 404);
  return dr;
}

// An invoice's lines as delivery lines. A package line becomes its contents.
function linesFromInvoice(invoice) {
  const out = [];
  for (const l of invoice.lines) {
    if (l.packageId && Array.isArray(l.packageComponents) && l.packageComponents.length) {
      for (const c of l.packageComponents) out.push({ description: c.description, quantity: Number(c.quantity), unit: c.unit || null });
    } else {
      out.push({ description: l.description, quantity: Number(l.quantity), unit: null });
    }
  }
  return out;
}

async function cleanLines(lines, businessId) {
  if (!Array.isArray(lines) || lines.length === 0) throw createError('Add at least one line', 400);
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const description = String(l.description || '').trim();
    const quantity = Number(l.quantity);
    if (!description) throw createError('Every line needs a description', 400);
    if (!(quantity > 0)) throw createError(`Line "${description}" needs a quantity greater than 0`, 400);
    let itemId = null;
    if (l.itemId) {
      itemId = Number(l.itemId);
      if (seen.has(itemId)) throw createError('The same inventory item cannot appear on two lines', 400);
      seen.add(itemId);
      const found = await prisma.inventoryItem.findFirst({ where: { id: itemId, businessId, isActive: true }, select: { id: true } });
      if (!found) throw createError(`Inventory item not found for line "${description}"`, 404);
    }
    out.push({ itemId, description, quantity, unit: l.unit ? String(l.unit).slice(0, 20) : null });
  }
  return out;
}

const headerFields = (b) => ({
  deliveryAddress: b.deliveryAddress || null,
  driverName: b.driverName || null,
  vehicleNo: b.vehicleNo || null,
  notes: b.notes || null,
  deductStock: !!b.deductStock,
});

exports.list = async (req, res, next) => {
  try {
    const { status, customerId, search, from, to } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (customerId) where.customerId = Number(customerId);
    if (from || to) where.drDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    if (search) where.OR = [{ drNo: { contains: search } }, { customer: { name: { contains: search } } }];
    res.json(await prisma.deliveryReceipt.findMany({
      where,
      include: { customer: { select: { id: true, name: true } }, invoice: { select: { id: true, invoiceNo: true } }, _count: { select: { lines: true } } },
      orderBy: [{ drDate: 'desc' }, { id: 'desc' }],
      take: 300,
    }));
  } catch (err) { next(err); }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await findDr(Number(req.params.id), req.businessId, DR_INCLUDE));
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const b = req.body;
    const businessId = req.businessId;

    let customerId = b.customerId ? Number(b.customerId) : null;
    let invoice = null;
    if (b.invoiceId) {
      invoice = await prisma.invoice.findFirst({
        where: { id: Number(b.invoiceId), businessId }, include: { lines: true },
      });
      if (!invoice) throw createError('Invoice not found', 404);
      if (invoice.status === 'VOID') throw createError('Cannot create a delivery receipt for a voided invoice', 400);
      customerId = invoice.customerId;
    }
    if (!customerId) throw createError('customerId or invoiceId is required', 400);

    const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true, address: true } });
    if (!customer) throw createError('Customer not found', 404);

    const rawLines = Array.isArray(b.lines) && b.lines.length ? b.lines : (invoice ? linesFromInvoice(invoice) : b.lines);
    const lines = await cleanLines(rawLines, businessId);
    const header = headerFields(b);
    header.deliveryAddress = b.deliveryAddress || invoice?.shippingAddress || customer.address || null;

    for (let attempt = 0; ; attempt++) {
      try {
        const dr = await prisma.deliveryReceipt.create({
          data: {
            businessId, drNo: await genDrNo(), customerId, invoiceId: invoice ? invoice.id : null,
            drDate: new Date(b.drDate), ...header, lines: { create: lines },
          },
          include: DR_INCLUDE,
        });
        return res.status(201).json(dr);
      } catch (err) {
        if (err.code === 'P2002' && attempt < 3) continue; // concurrent create took the number
        throw err;
      }
    }
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId);
    if (dr.status !== 'DRAFT') throw createError('Only draft delivery receipts can be edited', 400);

    const b = req.body;
    const lines = await cleanLines(b.lines, req.businessId);
    res.json(await prisma.deliveryReceipt.update({
      where: { id },
      data: {
        ...(b.drDate && { drDate: new Date(b.drDate) }),
        ...headerFields(b),
        lines: { deleteMany: {}, create: lines },
      },
      include: DR_INCLUDE,
    }));
  } catch (err) { next(err); }
};

exports.deliver = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId, { lines: { include: { item: true } } });
    if (dr.status !== 'DRAFT') throw createError('Only a draft delivery receipt can be marked delivered', 400);

    const stocked = dr.deductStock ? dr.lines.filter((l) => l.item) : [];
    let movements = [];
    let updated;
    await prisma.$transaction(async (tx) => {
      if (stocked.length) {
        movements = await deductStock(tx, {
          drNo: dr.drNo, drDate: dr.drDate,
          lines: stocked.map((l) => ({ quantity: Number(l.quantity), item: l.item })),
        });
      }
      updated = await tx.deliveryReceipt.update({
        where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() }, include: DR_INCLUDE,
      });
      if (dr.invoiceId) {
        const invoice = await tx.invoice.findFirst({ where: { id: dr.invoiceId, businessId: req.businessId } });
        if (invoice && invoice.deliveryStatus !== 'SHIPPED') {
          await tx.invoice.update({ where: { id: invoice.id }, data: { deliveryStatus: 'SHIPPED', shippedDate: dr.drDate } });
        }
      }
    });

    const lines = cogsLines(movements);
    if (lines.length) {
      await glPost.safePost({
        entryDate: dr.drDate, description: `Inventory OUT — ${dr.drNo}`, reference: dr.drNo,
        lines, userId: req.user?.id || 1, businessId: req.businessId,
      });
    }
    res.json(updated);
  } catch (err) { next(err); }
};

exports.cancel = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId);
    if (dr.status === 'CANCELLED') throw createError('This delivery receipt is already cancelled', 400);

    const wasDelivered = dr.status === 'DELIVERED';
    let movements = [];
    let updated;
    await prisma.$transaction(async (tx) => {
      if (wasDelivered && dr.deductStock) {
        movements = await restoreStock(tx, { drNo: dr.drNo, businessId: req.businessId });
      }
      updated = await tx.deliveryReceipt.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: req.body?.reason ? String(req.body.reason).slice(0, 255) : null },
        include: DR_INCLUDE,
      });
      // The invoice's "shipped" flag came from this DR only if no other delivered DR
      // is linked and nobody entered courier/tracking by hand.
      if (wasDelivered && dr.invoiceId) {
        const others = await tx.deliveryReceipt.count({
          where: { invoiceId: dr.invoiceId, status: 'DELIVERED', id: { not: id } },
        });
        const invoice = await tx.invoice.findFirst({ where: { id: dr.invoiceId, businessId: req.businessId } });
        if (others === 0 && invoice && !invoice.courier && !invoice.trackingNumber) {
          await tx.invoice.update({ where: { id: invoice.id }, data: { deliveryStatus: 'PENDING', shippedDate: null } });
        }
      }
    });

    const lines = cogsLines(movements, { reverse: true });
    if (lines.length) {
      await glPost.safePost({
        entryDate: new Date(), description: `Inventory IN (cancelled) — ${dr.drNo}`, reference: dr.drNo,
        lines, userId: req.user?.id || 1, businessId: req.businessId,
      });
    }
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Linking a DR to the invoice made from it (used by receivableController.createInvoice) ──
// Checked BEFORE the invoice is created, so a bad id can never leave a half-linked invoice.
exports.prepareLink = async (deliveryReceiptId, customerId, businessId) => {
  const dr = await prisma.deliveryReceipt.findFirst({ where: { id: Number(deliveryReceiptId), businessId } });
  if (!dr) throw createError('Delivery receipt not found', 404);
  if (dr.status === 'CANCELLED') throw createError('That delivery receipt is cancelled', 400);
  if (dr.invoiceId) throw createError('That delivery receipt is already linked to an invoice', 400);
  if (dr.customerId !== Number(customerId)) throw createError('That delivery receipt belongs to a different customer', 400);
  return dr;
};

exports.applyLink = async (dr, invoiceId) => {
  await prisma.deliveryReceipt.update({ where: { id: dr.id }, data: { invoiceId } });
  if (dr.status === 'DELIVERED') {
    await prisma.invoice.update({
      where: { id: invoiceId }, data: { deliveryStatus: 'SHIPPED', shippedDate: dr.deliveredAt || dr.drDate },
    });
  }
};
```

- [ ] **Step 4: Run, expect PASS** (`npx jest tests/deliveryReceiptController.test.js`). Fix any failing expectation by correcting the code, not by loosening the test.

- [ ] **Step 5: Routes.** Create `server/routes/deliveryReceipts.js`:

```js
const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/deliveryReceiptController');
const { authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// authenticate + resolveBusiness are applied by the parent receivable router.
router.get('/', ctrl.list);
router.get('/:id', param('id').isInt(), validate, ctrl.get);
router.post('/', [body('drDate').isISO8601()], validate, ctrl.create);
router.put('/:id', [param('id').isInt()], validate, ctrl.update);
router.post('/:id/deliver', param('id').isInt(), validate, ctrl.deliver);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), param('id').isInt(), validate, ctrl.cancel);

module.exports = router;
```

In `server/routes/receivable.js`, directly after the `/statements` route (before `router.get('/', ...)`) add:

```js
router.use('/delivery-receipts', require('./deliveryReceipts'));
```

- [ ] **Step 6: Client and backup.** In `lib/api.js` inside `export const receivable`, after the `statements` block add:

```js
  deliveryReceipts: {
    list:    (params)   => api.get('/receivable/delivery-receipts', { params }),
    get:     (id)       => api.get(`/receivable/delivery-receipts/${id}`),
    create:  (data)     => api.post('/receivable/delivery-receipts', data),
    update:  (id, data) => api.put(`/receivable/delivery-receipts/${id}`, data),
    deliver: (id)       => api.post(`/receivable/delivery-receipts/${id}/deliver`),
    cancel:  (id, data) => api.post(`/receivable/delivery-receipts/${id}/cancel`, data),
  },
```

In `server/controllers/backupController.js`, `receivable:` entry: add to `exportFilter` `deliveryReceipt: (biz) => ({ businessId: biz }),` and `deliveryReceiptLine: (biz) => ({ deliveryReceipt: { businessId: biz } }),`; append `'deliveryReceipt', 'deliveryReceiptLine'` to `insertOrder` (after `'paymentAR'`); and put these two entries at the START of `deleteSequence` (they reference invoices and customers, so they must be deleted first):

```js
      { model: 'deliveryReceiptLine', parentModel: 'deliveryReceipt', fk: 'deliveryReceiptId' },
      { model: 'deliveryReceipt' },
```

- [ ] **Step 7: Run the suite, then commit**

Run: `npx jest` (all pass).

```bash
git add server/controllers/deliveryReceiptController.js server/routes/deliveryReceipts.js server/routes/receivable.js lib/api.js server/controllers/backupController.js tests/deliveryReceiptController.test.js
git commit -m "feat(dr): delivery receipt API (create, edit, deliver, cancel, invoice linking)"
```

---

### Task 4: Invoices link to delivery receipts (server)

**Files:**
- Modify: `server/controllers/receivableController.js` (imports; `listInvoices` ~156; `getInvoice` ~181; `createInvoice` ~192)
- Test: `tests/receivableDrLink.test.js`

**Interfaces:**
- Consumes: `prepareLink`, `applyLink` (Task 3).
- Produces: `POST /api/receivable` accepts optional `deliveryReceiptId`; invoice list/detail JSON include `deliveryReceipts: [{ id, drNo, status }]`.

- [ ] **Step 1: Write the failing tests** (`tests/receivableDrLink.test.js`)

```js
jest.mock('../server/config/database', () => ({
  invoice: { findFirst: jest.fn(), create: jest.fn() },
  paymentTerm: { findFirst: jest.fn() },
  account: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/controllers/deliveryReceiptController', () => ({
  prepareLink: jest.fn(), applyLink: jest.fn(),
}));

const prisma = require('../server/config/database');
const dr = require('../server/controllers/deliveryReceiptController');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const body = (extra = {}) => ({
  customerId: 7, invoiceDate: '2026-02-01', dueDate: '2026-03-03',
  lines: [{ accountId: 5, description: 'Widget', quantity: 2, unitPrice: 100, vatCode: 'EXEMPT' }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.invoice.findFirst.mockResolvedValue(null);
  prisma.account.findMany.mockResolvedValue([{ id: 5, normalBalance: 'CREDIT' }]);
  prisma.invoice.create.mockImplementation(async ({ data }) => ({ id: 11, ...data, customer: { name: 'ACME' }, lines: [] }));
});

describe('createInvoice with a delivery receipt', () => {
  test('validates the DR first, then links it to the new invoice', async () => {
    const link = { id: 4 };
    dr.prepareLink.mockResolvedValue(link);

    await run(ctrl.createInvoice, { body: body({ deliveryReceiptId: 4 }) });

    expect(dr.prepareLink).toHaveBeenCalledWith(4, 7, 1);
    expect(dr.applyLink).toHaveBeenCalledWith(link, 11);
  });

  test('a bad DR stops the invoice from being created at all', async () => {
    dr.prepareLink.mockRejectedValue(new Error('That delivery receipt is cancelled'));

    await expect(run(ctrl.createInvoice, { body: body({ deliveryReceiptId: 4 }) })).rejects.toThrow('cancelled');
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  test('without a DR nothing is linked', async () => {
    await run(ctrl.createInvoice, { body: body() });

    expect(dr.prepareLink).not.toHaveBeenCalled();
    expect(dr.applyLink).not.toHaveBeenCalled();
  });

  test('a failure while linking does not fail the invoice that was already created', async () => {
    dr.prepareLink.mockResolvedValue({ id: 4 });
    dr.applyLink.mockRejectedValue(new Error('db down'));

    const inv = await run(ctrl.createInvoice, { body: body({ deliveryReceiptId: 4 }) });

    expect(inv.id).toBe(11);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Run: npx jest tests/receivableDrLink.test.js`).

- [ ] **Step 3: Implement.** In `receivableController.js` add under the other requires: `const drCtrl = require('./deliveryReceiptController');`.

In `createInvoice`, right after the destructuring `const { customerId, invoiceDate, dueDate, description, notes, lines } = req.body;` add:

```js
    // Validate the delivery receipt before anything is written.
    const drLink = req.body.deliveryReceiptId
      ? await drCtrl.prepareLink(req.body.deliveryReceiptId, customerId, req.businessId)
      : null;
```

Right after `const inv = await prisma.invoice.create({ ... });` (before the "Auto-post to GL" comment) add:

```js
    if (drLink) {
      try {
        await drCtrl.applyLink(drLink, inv.id);
      } catch (err) {
        // The invoice exists and is valid; do not fail the request over the link.
        logger.error(`[INVOICE ${inv.invoiceNo} — DR LINK FAILED] dr=${drLink.id} biz=${req.businessId} — ${err.message}`);
      }
    }
```

In `listInvoices` add `deliveryReceipts: { select: { id: true, drNo: true, status: true } },` to the `include` object (next to `lines: true,`). In `getInvoice` add the same entry to its `include`.

- [ ] **Step 4: Run, expect PASS, then the suite** (`npx jest tests/receivableDrLink.test.js`, then `npx jest`).

- [ ] **Step 5: Commit**

```bash
git add server/controllers/receivableController.js tests/receivableDrLink.test.js
git commit -m "feat(dr): invoices can be created from, and list, their delivery receipts"
```

---

### Task 5: Delivery Receipts page, print, and navigation

**Files:**
- Create: `app/(dashboard)/receivable/delivery-receipts/page.jsx`
- Modify: `components/layout/Sidebar.jsx` (Accounts Receivable children, ~line 42)

**Interfaces:**
- Consumes: `receivable.deliveryReceipts.*`, `receivable.customers.list`, `inventory.items.list` (returns an array), `CustomerSelect`, `NumberInput`, `printDocument`.
- Reads `?open=<id>` to open that DR's modal on load (used by the invoice page).

- [ ] **Step 1: Create `app/(dashboard)/receivable/delivery-receipts/page.jsx`**

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { receivable as rApi, inventory as invApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Printer, Truck, X, Ban, FileText, RefreshCw } from 'lucide-react';
import CustomerSelect from '@/components/CustomerSelect';
import NumberInput from '@/components/NumberInput';
import { printDocument, dateFmt } from '@/lib/print';
import { formatDate } from '@/lib/auth';
import { todayPH } from '@/lib/arAging';

const STATUS_BADGE = { DRAFT: 'badge-gray', DELIVERED: 'badge-green', CANCELLED: 'badge-red' };
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blankLine = () => ({ itemId: '', description: '', quantity: '1', unit: '' });

// ─── Print ────────────────────────────────────────────────────
async function printDr(dr) {
  const rows = dr.lines.map((l, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${esc(l.description)}</td>
      <td class="right">${Number(l.quantity).toLocaleString('en-PH')}</td>
      <td>${esc(l.unit || '')}</td>
    </tr>`).join('');
  const sign = (label) => `
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #111;height:38px;"></div>
      <div class="small bold" style="margin-top:3px;">${label}</div>
      <div class="small gray">Name / Signature / Date</div>
    </div>`;
  const body = `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">DR No.</div><div class="info-val mono">${esc(dr.drNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Date</div><div class="info-val">${dateFmt(dr.drDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Invoice Ref.</div><div class="info-val mono">${esc(dr.invoice?.invoiceNo || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Delivered To</div><div class="info-val">${esc(dr.customer.name)}</div></div>
      <div class="info-box"><div class="info-lbl">Driver / Courier</div><div class="info-val">${esc(dr.driverName || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Vehicle / Plate No.</div><div class="info-val">${esc(dr.vehicleNo || '—')}</div></div>
    </div>
    <div class="desc-box"><strong>Delivery address:</strong> ${esc(dr.deliveryAddress || dr.customer.address || '—')}</div>
    <div class="section-title">Items Delivered</div>
    <table>
      <thead><tr><th class="center" style="width:32px;">#</th><th>Description</th><th class="right">Qty</th><th>Unit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${dr.notes ? `<div class="desc-box" style="margin-top:10px;"><strong>Remarks:</strong> ${esc(dr.notes)}</div>` : ''}
    <p class="small gray" style="margin-top:14px;">Received the above items in good order and condition.</p>
    <div style="display:flex;gap:28px;margin-top:26px;">${sign('Prepared by')}${sign('Delivered by')}${sign('Received by')}</div>`;
  await printDocument('Delivery Receipt', dr.drNo, body);
}

// ─── Create / edit / view modal ───────────────────────────────
function DrModal({ drId, customers, items, onCustomerAdded, onClose, onChanged }) {
  const router = useRouter();
  const [dr, setDr]           = useState(null);       // loaded record (null while creating)
  const [loading, setLoading] = useState(!!drId);
  const [saving, setSaving]   = useState(false);
  const [form, setForm] = useState({
    customerId: '', drDate: todayPH(), deliveryAddress: '', driverName: '', vehicleNo: '',
    notes: '', deductStock: false, lines: [blankLine()],
  });

  useEffect(() => {
    if (!drId) return;
    rApi.deliveryReceipts.get(drId).then(({ data }) => {
      setDr(data);
      setForm({
        customerId: String(data.customerId), drDate: String(data.drDate).slice(0, 10),
        deliveryAddress: data.deliveryAddress || '', driverName: data.driverName || '', vehicleNo: data.vehicleNo || '',
        notes: data.notes || '', deductStock: data.deductStock,
        lines: data.lines.map((l) => ({
          itemId: l.itemId ? String(l.itemId) : '', description: l.description,
          quantity: String(Number(l.quantity)), unit: l.unit || '',
        })),
      });
    }).catch(() => { toast.error('Failed to load delivery receipt'); onClose(); })
      .finally(() => setLoading(false));
  }, [drId]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = !!dr && dr.status !== 'DRAFT';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  const pickItem = (i, itemId) => {
    const item = items.find((it) => String(it.id) === String(itemId));
    setLine(i, item ? { itemId: String(item.id), description: item.name, unit: item.unit || '' } : { itemId: '' });
  };

  const pickCustomer = (id) => {
    const c = customers.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, customerId: id, deliveryAddress: f.deliveryAddress || c?.address || '' }));
  };

  const payload = () => ({
    ...(dr ? {} : { customerId: Number(form.customerId) }),
    drDate: form.drDate, deliveryAddress: form.deliveryAddress, driverName: form.driverName,
    vehicleNo: form.vehicleNo, notes: form.notes, deductStock: form.deductStock,
    lines: form.lines.filter((l) => l.description.trim()).map((l) => ({
      itemId: l.itemId ? Number(l.itemId) : undefined, description: l.description,
      quantity: Number(l.quantity), unit: l.unit,
    })),
  });

  const run = async (fn, okMsg, closeAfter = true) => {
    setSaving(true);
    try {
      const { data } = await fn();
      toast.success(okMsg);
      onChanged();
      if (closeAfter) onClose(); else setDr(data);
      return data;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!dr && !form.customerId) { toast.error('Select a customer'); return; }
    await run(() => (dr ? rApi.deliveryReceipts.update(dr.id, payload()) : rApi.deliveryReceipts.create(payload())),
      dr ? 'Delivery receipt updated' : 'Delivery receipt created');
  };

  const deliver = async () => {
    const stockNote = dr.deductStock ? ' Stocked items will be deducted from inventory.' : '';
    if (!confirm(`Mark ${dr.drNo} as delivered?${stockNote}`)) return;
    await run(() => rApi.deliveryReceipts.deliver(dr.id), 'Marked as delivered');
  };

  const cancel = async () => {
    const reason = window.prompt(`Cancel ${dr.drNo}?${dr.status === 'DELIVERED' && dr.deductStock ? ' Stock will be returned to inventory.' : ''}\nReason (optional):`);
    if (reason === null) return;
    await run(() => rApi.deliveryReceipts.cancel(dr.id, { reason }), 'Delivery receipt cancelled');
  };

  const toInvoice = () => router.push(`/receivable?fromDr=${dr.id}`);

  if (loading) return null;

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{dr ? dr.drNo : 'New Delivery Receipt'}</h3>
            {dr && <span className={`badge ${STATUS_BADGE[dr.status]}`}>{dr.status}</span>}
            {dr?.invoice && <span className="text-xs text-gray-500">Invoice {dr.invoice.invoiceNo}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={save}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Customer *</label>
                {dr ? (
                  <input className="input" disabled value={dr.customer.name} />
                ) : (
                  <CustomerSelect customers={customers} value={form.customerId} onChange={pickCustomer}
                    onCustomerAdded={onCustomerAdded} required />
                )}
              </div>
              <div className="form-group">
                <label className="label">Date *</label>
                <input type="date" className="input" required disabled={readOnly} value={form.drDate} onChange={set('drDate')} />
              </div>
              <div className="form-group md:col-span-2">
                <label className="label">Delivery Address</label>
                <textarea className="input resize-none" rows={2} disabled={readOnly}
                  value={form.deliveryAddress} onChange={set('deliveryAddress')} />
              </div>
              <div className="form-group">
                <label className="label">Driver / Courier</label>
                <input className="input" disabled={readOnly} value={form.driverName} onChange={set('driverName')} />
              </div>
              <div className="form-group">
                <label className="label">Vehicle / Plate No.</label>
                <input className="input" disabled={readOnly} value={form.vehicleNo} onChange={set('vehicleNo')} />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Items</h4>
              <div className="space-y-2">
                {form.lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[1.4fr_2fr_6rem_5rem_2rem] gap-2 items-start">
                    <select className="select text-sm" disabled={readOnly} value={l.itemId} onChange={(e) => pickItem(i, e.target.value)}>
                      <option value="">— Not a stocked item —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id} disabled={form.lines.some((x, xi) => xi !== i && String(x.itemId) === String(it.id))}>
                          {it.sku} · {it.name}
                        </option>
                      ))}
                    </select>
                    <input className="input text-sm" placeholder="Description" disabled={readOnly}
                      value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    <NumberInput className="input text-sm text-right" decimals={3} placeholder="Qty" disabled={readOnly}
                      value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} />
                    <input className="input text-sm" placeholder="Unit" disabled={readOnly}
                      value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
                    {!readOnly && (
                      <button type="button" className="p-1.5 text-red-400 hover:text-red-600"
                        onClick={() => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, xi) => xi !== i) : [blankLine()] }))}
                        title="Remove line"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {!readOnly && (
                <button type="button" className="btn-secondary btn-sm mt-2"
                  onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>
              )}
            </div>

            <label className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
              <input type="checkbox" className="mt-1" disabled={readOnly} checked={form.deductStock}
                onChange={(e) => setForm((f) => ({ ...f, deductStock: e.target.checked }))} />
              <span>
                <span className="text-sm font-medium text-gray-700 block">Deduct from inventory when delivered</span>
                <span className="text-xs text-gray-500">
                  Only lines with a stocked item move stock. Posts the cost of goods to the books. Leave off when the invoice or another document already handles stock.
                </span>
              </span>
            </label>

            <div className="form-group">
              <label className="label">Remarks</label>
              <textarea className="input resize-none" rows={2} disabled={readOnly} value={form.notes} onChange={set('notes')} />
            </div>
            {dr?.status === 'CANCELLED' && dr.cancelReason && (
              <p className="text-sm text-red-600">Cancelled: {dr.cancelReason}</p>
            )}
          </div>

          <div className="modal-footer">
            {dr && dr.status !== 'CANCELLED' && (
              <button type="button" onClick={cancel} disabled={saving} className="btn-danger btn-sm mr-auto">
                <Ban className="w-4 h-4" /> Cancel DR
              </button>
            )}
            {dr && (
              <button type="button" onClick={() => printDr(dr)} className="btn-secondary">
                <Printer className="w-4 h-4" /> Print
              </button>
            )}
            {dr && dr.status !== 'CANCELLED' && !dr.invoice && (
              <button type="button" onClick={toInvoice} className="btn-secondary">
                <FileText className="w-4 h-4" /> Convert to Invoice
              </button>
            )}
            {dr?.status === 'DRAFT' && (
              <button type="button" onClick={deliver} disabled={saving} className="btn-secondary">
                <Truck className="w-4 h-4" /> Mark Delivered
              </button>
            )}
            {!readOnly && (
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : dr ? 'Save Changes' : 'Create DR'}</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function DeliveryReceiptsPage() {
  const [rows, setRows]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [status, setStatus]       = useState('');
  const [search, setSearch]       = useState('');
  const [modal, setModal]         = useState(null); // null | { id: number | null }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await rApi.deliveryReceipts.list({ ...(status && { status }), ...(search.trim() && { search: search.trim() }) });
      setRows(data);
    } catch {
      toast.error('Failed to load delivery receipts');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing in the search box
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data)).catch(() => {});
    invApi.items.list().then((r) => setItems(r.data.data || r.data || [])).catch(() => {});
    const open = new URLSearchParams(window.location.search).get('open');
    if (open) setModal({ id: Number(open) });
  }, []);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Delivery Receipts</h1>
          <p className="page-subtitle">Proof of delivery. Create from an invoice, or deliver first and invoice after.</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ id: null })}>
          <Plus className="w-4 h-4" /> New Delivery Receipt
        </button>
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input className="input pl-8 text-sm w-64" placeholder="Search DR no. or customer…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select w-44 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th className="pl-4">DR No.</th><th>Date</th><th>Customer</th><th>Invoice</th>
              <th className="text-center">Items</th><th>Stock</th><th className="pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">No delivery receipts yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-green-50/40 border-b border-gray-100" onClick={() => setModal({ id: r.id })}>
                <td className="pl-4 font-mono text-sm text-green-700">{r.drNo}</td>
                <td>{formatDate(r.drDate)}</td>
                <td>{r.customer.name}</td>
                <td className="font-mono text-sm">{r.invoice?.invoiceNo || <span className="text-gray-300">—</span>}</td>
                <td className="text-center">{r._count.lines}</td>
                <td>{r.deductStock ? <span className="badge badge-blue">Deducts stock</span> : <span className="text-gray-300">—</span>}</td>
                <td className="pr-4"><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DrModal
          drId={modal.id}
          customers={customers}
          items={items}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])}
          onClose={() => setModal(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Navigation.** In `components/layout/Sidebar.jsx`, in the Accounts Receivable `children`, after `{ label: 'Invoices',   href: '/receivable' },` add `{ label: 'Delivery Receipts', href: '/receivable/delivery-receipts' },`.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/receivable/delivery-receipts/page.jsx" components/layout/Sidebar.jsx
git commit -m "feat(dr): Delivery Receipts page with print and nav entry"
```

---

### Task 6: Invoice page: "Create DR", DR chips, "Convert to Invoice"

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx`

**Interfaces:**
- Consumes: `rApi.deliveryReceipts.create/get`, invoice `deliveryReceipts[]` (Task 4), `?fromDr=<id>` (set by the DR modal's "Convert to Invoice").
- `CreateInvoiceModal` gets an optional prop `prefill: { id, drNo, customerId, lines }`.

- [ ] **Step 1: Imports.** Add `import Link from 'next/link';` and `import { useRouter } from 'next/navigation';` near the other imports. Add `todayPH` to the existing phase-1 helper import line area: `import { todayPH } from '@/lib/arAging';`.

- [ ] **Step 2: Prefill support in `CreateInvoiceModal`.**
  - Signature: `function CreateInvoiceModal({ customers, accounts, invoice, prefill, onClose, onSaved, onCustomerAdded })`.
  - In the `useState` initializer, after the `if (invoice) return {...};` block and before the `const invoiceDate = ...` default, add:

```jsx
    if (prefill) {
      const invoiceDate = new Date().toISOString().split('T')[0];
      const due = new Date(invoiceDate);
      due.setDate(due.getDate() + 30);
      return {
        customerId: String(prefill.customerId), invoiceDate, dueDate: due.toISOString().split('T')[0], termId: '',
        description: `Per delivery receipt ${prefill.drNo}`, notes: '', lines: prefill.lines,
      };
    }
```

  - Draft key (so a saved draft never overwrites the prefill): change `const draftKey = scopedKey(invoice?.id ? `invoice:edit:${invoice.id}` : 'invoice:new');` to
    `const draftKey = scopedKey(invoice?.id ? `invoice:edit:${invoice.id}` : prefill ? `invoice:dr:${prefill.id}` : 'invoice:new');`
  - Apply the customer's default terms once the terms list loads (phase 1 added `terms` and `dueFor`). After the `setCustomer` handler add:

```jsx
  useEffect(() => {
    if (!prefill || !terms.length) return;
    const def = customers.find((c) => String(c.id) === String(prefill.customerId))?.defaultTermId;
    if (def && terms.some((t) => t.id === def)) {
      setForm((f) => ({ ...f, termId: String(def), dueDate: dueFor(def, f.invoiceDate) || f.dueDate }));
    }
  }, [terms]); // eslint-disable-line react-hooks/exhaustive-deps
```

  - In `handleSubmit`, add to the `payload` object (after `customerId: Number(form.customerId),`): `...(prefill && { deliveryReceiptId: prefill.id }),`.

- [ ] **Step 3: Open the modal from `?fromDr=`.** In `InvoicesPage`, add state `const [prefill, setPrefill] = useState(null);` and, after the existing `useEffect(() => { rApi.customers.list(...) ... }, []);`, add:

```jsx
  useEffect(() => {
    const fromDr = new URLSearchParams(window.location.search).get('fromDr');
    if (!fromDr) return;
    window.history.replaceState(null, '', window.location.pathname); // a refresh must not reopen it
    rApi.deliveryReceipts.get(fromDr).then(({ data: dr }) => {
      if (dr.invoice) { toast.error(`${dr.drNo} is already linked to ${dr.invoice.invoiceNo}`); return; }
      if (dr.status === 'CANCELLED') { toast.error(`${dr.drNo} is cancelled`); return; }
      setPrefill({
        id: dr.id, drNo: dr.drNo, customerId: dr.customerId,
        lines: dr.lines.map((l) => ({
          accountId: l.item?.revenueAccountId ? String(l.item.revenueAccountId) : '',
          description: l.description, quantity: String(Number(l.quantity)),
          unitPrice: l.item ? String(Number(l.item.sellingPrice)) : '', vatCode: 'EXEMPT',
        })),
      });
      setModal({ type: 'create' });
    }).catch(() => toast.error('Could not load that delivery receipt'));
  }, []);
```

  In the `modal?.type === 'create'` block pass `prefill={prefill}` and change its `onClose` to `() => { setModal(null); setPrefill(null); }` and `onSaved` to `() => { setModal(null); setPrefill(null); load(); }`.

- [ ] **Step 4: "Create DR" row action and DR chips.** In `InvoicesPage` add `const router = useRouter();` and:

```jsx
  const createDr = async (inv) => {
    try {
      const { data } = await rApi.deliveryReceipts.create({ invoiceId: inv.id, drDate: todayPH() });
      toast.success(`${data.drNo} created`);
      router.push(`/receivable/delivery-receipts?open=${data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create delivery receipt');
    }
  };
```

  In the row action buttons, directly after the Truck button block (`{inv.status !== 'VOID' && ( <button ... Truck ... /> )}`) add:

```jsx
                        {inv.status !== 'VOID' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); createDr(inv); }}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Create delivery receipt"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
```

  In the invoice number cell, directly after `<span className="font-mono font-medium text-green-700 text-sm">{inv.invoiceNo}</span>` add:

```jsx
                      {(inv.deliveryReceipts || []).filter((d) => d.status !== 'CANCELLED').map((d) => (
                        <Link key={d.id} href={`/receivable/delivery-receipts?open=${d.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-2 text-[10px] font-mono text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 hover:bg-blue-100"
                          title={`Delivery receipt ${d.drNo} (${d.status.toLowerCase()})`}>
                          {d.drNo}
                        </Link>
                      ))}
```

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/receivable/page.jsx"
git commit -m "feat(dr): create DR from an invoice, DR chips, and convert a DR into an invoice"
```

---

### Task 7: Verify end to end

- [ ] **Step 1:** `npx jest` in the worktree. Expected: all suites pass.
- [ ] **Step 2:** `npm run build` in the worktree directory only. Expected: success.
- [ ] **Step 3:** With the user's sign-off (real business is businessId=2, so use small test data and cancel/void it afterwards), check in the browser:
  1. **A, from invoice:** Receivables > Invoices > the DR icon on an invoice creates `DR-xxxxxx` and opens it with the invoice's lines (a package line shows its contents) and the customer's/shipping address; the invoice row shows a blue DR chip.
  2. **Print:** Print shows letterhead, six info boxes, delivery address, item table with no prices, and three signature lines; fits one A4 page.
  3. **C, stock:** edit a draft, pick a stocked item on a line, tick "Deduct from inventory", Mark Delivered. Inventory > Stock on Hand drops by the quantity; Inventory > Transactions shows an `OUT` with reference = the DR no.; General Ledger shows `Inventory OUT — DR-…` (DR COGS, CR Inventory). The linked invoice now shows Shipped.
  4. **Cancel delivered:** Cancel DR with a reason: stock returns (`RETURN_IN`), a reversing journal entry posts, the invoice goes back to not shipped.
  5. **B, standalone then invoice:** New Delivery Receipt for a customer with a stocked item (no invoice), leave "Deduct" off, Mark Delivered, "Convert to Invoice": the invoice modal opens with the customer, the line quantities, the item's selling price and revenue account pre-filled; save; the DR now shows the invoice number, and the invoice is Shipped. Stock is not deducted twice (invoices never move stock).
  6. Edge: a delivered or cancelled DR is read-only; a DR already linked cannot be converted again (the button is hidden); `/receivable?fromDr=<linked id>` shows an "already linked" toast.
- [ ] **Step 4:** Report what passed and what was not checked. Then offer `superpowers:finishing-a-development-branch` (merge, PR, or keep the branch).

## Self-review against the spec (section 4)

- One `DeliveryReceipt` covering A/B/C: Tasks 1, 3, 5, 6.
- Fields (DR no. DR-000001, date, customer, address, driver, vehicle, notes, status DRAFT/DELIVERED/CANCELLED, optional `invoiceId`) and lines (optional `itemId`, description, quantity, unit; no prices): Task 1.
- A: "Create DR" on an invoice copies lines, links `invoiceId`: Tasks 3, 6. B: "Convert to Invoice": Tasks 4, 5, 6. C: per-DR stock checkbox, OUT on DELIVERED, RETURN_IN on cancel: Tasks 2, 3.
- Print with Prepared by / Delivered by / Received by (name, signature, date): Task 5.
- Invoice shows linked DR numbers; delivery status moves to SHIPPED when a linked DR is delivered: Tasks 3, 4, 6.
- Open question from the spec (does Cash Sales post COGS?): resolved. It does, DR mirrors it (Task 2).
