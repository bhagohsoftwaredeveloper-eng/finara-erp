# Business License Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate new businesses behind a license (`PENDING` → `ACTIVE` / `SUSPENDED`) so a client only gets access after payment is confirmed, with SUPER_ADMIN able to activate manually and ADMIN able to generate a PayMongo payment link for online payment, all logged to a full audit trail with email notifications.

**Architecture:** Additive Prisma fields on `Business` plus a new `LicenseEvent` audit-log model. Three chokepoints (`businessController.list/get`, `auth.js#resolveBusiness`) gate access by `licenseStatus`. Two new endpoints (`PATCH /businesses/:id/license` for manual SUPER_ADMIN activation, `POST /businesses/:id/license/payment-link` for ADMIN-generated PayMongo links) plus one public signature-verified webhook (`POST /api/webhooks/paymongo`) drive the state machine. Email notifications reuse the existing `mailer.js` SMTP helper.

**Tech Stack:** Next.js 14 (App Router) + Express.js + MySQL 8 + Prisma ORM 5, CommonJS on the backend (`server/`), Jest for backend tests (prisma fully mocked via `jest.mock('../server/config/database')` — no real DB needed to run the suite), global `fetch` (Node 18+, already used in `server/utils/leadWebhook.js`) for outbound HTTP.

## Global Constraints

- Backend code is CommonJS (`require`/`module.exports`), not ESM or TypeScript.
- `SUPER_ADMIN` bypasses every `authorize(...)` role check automatically ([auth.js:70-78](../../../server/middleware/auth.js#L70-L78)) — never add `'SUPER_ADMIN'` to an `authorize()` roles list, and never assume `authorize('ADMIN')` excludes SUPER_ADMIN.
- All new Prisma models/fields must be added to `prisma/schema.prisma`, then `npm run db:generate && npm run db:migrate` — **stop the dev server first** (Windows holds a DLL lock on the Prisma client otherwise, causing `EPERM`).
- Controllers follow the `(req, res, next)` signature and call `next(err)` on failure; use `createError(message, statusCode)` from `server/middleware/errorHandler.js` for expected 4xx errors. **Only use status codes < 500 with `createError`** — the global error handler replaces the message with a generic "Internal server error" for any `statusCode >= 500` ([errorHandler.js:27-28](../../../server/middleware/errorHandler.js#L27-L28)), which would swallow our intended message.
- Backend tests mock Prisma per-model (`jest.mock('../server/config/database', () => ({ business: { findUnique: jest.fn() }, ... }))`) and call controllers directly with fake `req`/`res` objects — no supertest/real HTTP in this suite. Follow the exact style in [tests/businessGetAccessControl.test.js](../../../tests/businessGetAccessControl.test.js).
- No frontend test suite exists in this repo — frontend changes are verified manually against the running dev server, never by starting a competing `npm run dev` instance (the user runs their own).
- Money amounts on new `Decimal` Prisma fields are set with plain JS numbers (no `Prisma.Decimal` wrapper needed) — consistent with how the rest of the codebase writes Decimal columns.

---

## Task 1: Prisma schema — license fields + audit trail

**Files:**
- Modify: `prisma/schema.prisma` (the `Business` model, currently [schema.prisma:11-31](../../../prisma/schema.prisma#L11-L31))

**Interfaces:**
- Produces: `LicenseStatus` enum (`PENDING`/`ACTIVE`/`SUSPENDED`), `LicenseEventType` enum (`CREATED`/`PAYMENT_LINK_GENERATED`/`PAYMENT_RECEIVED`/`ACTIVATED`/`SUSPENDED`/`REACTIVATED`), `Business.licenseStatus`/`licenseActivatedAt`/`licenseActivatedBy`/`createdByUserId`/`paymentLinkId`/`paymentLinkUrl`/`paymentLinkAmount`/`paymentLinkGeneratedAt`, and the `LicenseEvent` model — every later task in this plan depends on these existing on the generated Prisma client.

- [ ] **Step 1: Add the enums and `Business` fields**

In `prisma/schema.prisma`, add these two enums directly above the `model Business {` line:

```prisma
enum LicenseStatus {
  PENDING
  ACTIVE
  SUSPENDED
}

enum LicenseEventType {
  CREATED
  PAYMENT_LINK_GENERATED
  PAYMENT_RECEIVED
  ACTIVATED
  SUSPENDED
  REACTIVATED
}

```

Then inside `model Business { ... }`, add these fields right before the closing `@@map("businesses")` line (after the existing `userBusinesses UserBusiness[]` line):

```prisma
  licenseStatus          LicenseStatus @default(ACTIVE)
  licenseActivatedAt     DateTime?
  licenseActivatedBy     Int?
  createdByUserId        Int?
  paymentLinkId          String?       @db.VarChar(100)
  paymentLinkUrl         String?       @db.Text
  paymentLinkAmount      Decimal?      @db.Decimal(12, 2)
  paymentLinkGeneratedAt DateTime?
  licenseEvents          LicenseEvent[]
```

- [ ] **Step 2: Add the `LicenseEvent` model**

Add this new model directly after the closing `}` of `model Business`:

```prisma
model LicenseEvent {
  id          Int              @id @default(autoincrement())
  businessId  Int
  business    Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  eventType   LicenseEventType
  note        String?          @db.Text
  amount      Decimal?         @db.Decimal(12, 2)
  actorUserId Int?
  createdAt   DateTime         @default(now())

  @@index([businessId])
  @@map("license_events")
}
```

- [ ] **Step 3: Stop the dev server, then generate and migrate**

Tell the user (or confirm) the dev server is stopped, then run:

```bash
npm run db:generate
npm run db:migrate
```

When prompted for a migration name, use `add_business_license`.

Expected: Prisma generates the client without error, a new folder appears under `prisma/migrations/` containing `add_business_license`, and the migration applies cleanly to the dev database (no `P1001`/`P2021` errors in the output).

- [ ] **Step 4: Verify the generated client exposes the new model**

Run:

```bash
node -e "const p = require('./server/config/database'); console.log(typeof p.licenseEvent.create, typeof p.business.update)"
```

Expected output: `function function`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add Business license status and LicenseEvent audit trail"
```

---

## Task 2: Access enforcement — gate list/get/resolveBusiness on license status

**Files:**
- Modify: `server/controllers/businessController.js:8-47` (`list`, `get`)
- Modify: `server/middleware/auth.js:26-68` (`resolveBusiness`)
- Modify: `tests/businessGetAccessControl.test.js` (existing fixtures need `licenseStatus: 'ACTIVE'` added so previously-passing tests still pass under the new gate)
- Test: `tests/businessLicenseAccessControl.test.js` (new)

**Interfaces:**
- Consumes: `Business.licenseStatus` from Task 1.
- Produces: `list()` and `get()` now only return/allow `ACTIVE` businesses to non-SUPER_ADMIN callers; `resolveBusiness` now 403s with `{ error: 'License not yet activated' }` (PENDING) or `{ error: 'Business license suspended' }` (SUSPENDED) for non-SUPER_ADMIN callers targeting a non-ACTIVE business. Later tasks (3–8) rely on this being the single source of truth for "is this business usable right now."

- [ ] **Step 1: Update the existing `get()` access-control tests for the new gate**

The current fixtures in `tests/businessGetAccessControl.test.js` mock `Business` rows without a `licenseStatus`, so once `get()` starts checking it, three currently-passing tests would start failing for the wrong reason (license gate, not grant check): `a non-admin with a matching grant can fetch that business`, `ADMIN bypasses the grant check entirely`, and `SUPER_ADMIN bypasses the grant check entirely too`. Fix all three `prisma.business.findUnique.mockResolvedValue(...)` calls:

```js
  test('a non-admin with a matching grant can fetch that business', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 1 });
    prisma.business.findUnique.mockResolvedValue({ id: 1, name: 'Demo Trading Co.', licenseStatus: 'ACTIVE' });

    const biz = await run({ id: 5, role: 'MANAGER' }, 1);

    expect(biz).toEqual({ id: 1, name: 'Demo Trading Co.', licenseStatus: 'ACTIVE' });
    expect(prisma.userBusiness.findUnique).toHaveBeenCalledWith({
      where: { userId_businessId: { userId: 5, businessId: 1 } },
    });
  });
```

```js
  test('ADMIN bypasses the grant check entirely', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 2, name: 'Beulah IT', licenseStatus: 'ACTIVE' });

    const biz = await run({ id: 1, role: 'ADMIN' }, 2);

    expect(biz).toEqual({ id: 2, name: 'Beulah IT', licenseStatus: 'ACTIVE' });
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });
```

```js
  test('SUPER_ADMIN bypasses the grant check entirely too', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 2, name: 'Beulah IT', licenseStatus: 'ACTIVE' });

    const biz = await run({ id: 1, role: 'SUPER_ADMIN' }, 2);

    expect(biz).toEqual({ id: 2, name: 'Beulah IT', licenseStatus: 'ACTIVE' });
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });
```

Leave the other three tests (`no grant is denied`, `cannot fetch a business they are not granted`, `nonexistent business still 404s`) unchanged — they never reach the license check.

- [ ] **Step 2: Run the existing suite to confirm it still fails for the right reason (red)**

Run: `npx jest tests/businessGetAccessControl.test.js -v`
Expected: all 5 tests still PASS (this step confirms the fixture update alone didn't break anything before the license gate is added — the gate itself is added in Step 4, which is when new failing behavior would appear if we test it now).

- [ ] **Step 3: Write the new failing tests for the license gate**

Create `tests/businessLicenseAccessControl.test.js`:

```js
jest.mock('../server/config/database', () => ({
  business:     { findMany: jest.fn(), findUnique: jest.fn() },
  userBusiness: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/businessController');
const { resolveBusiness } = require('../server/middleware/auth');

const runGet = (user, id) => new Promise((resolve, reject) => {
  ctrl.get({ params: { id: String(id) }, user }, { json: resolve }, reject);
});
const runList = (user) => new Promise((resolve, reject) => {
  ctrl.list({ user }, { json: resolve }, reject);
});
const runResolve = (user, headerBizId) => new Promise((resolve) => {
  const req = { user, headers: headerBizId ? { 'x-business-id': String(headerBizId) } : {} };
  const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }) };
  resolveBusiness(req, res, () => resolve({ code: 200, businessId: req.businessId }));
});

beforeEach(() => jest.clearAllMocks());

describe('businessController.get license gate', () => {
  test('ADMIN is denied a PENDING business with 403', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'New Client Co.', licenseStatus: 'PENDING' });
    await expect(runGet({ id: 1, role: 'ADMIN' }, 3)).rejects.toMatchObject({ statusCode: 403, message: 'License not yet activated' });
  });

  test('ADMIN is denied a SUSPENDED business with 403', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'New Client Co.', licenseStatus: 'SUSPENDED' });
    await expect(runGet({ id: 1, role: 'ADMIN' }, 3)).rejects.toMatchObject({ statusCode: 403, message: 'Business license suspended' });
  });

  test('SUPER_ADMIN can fetch a PENDING business', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'New Client Co.', licenseStatus: 'PENDING' });
    const biz = await runGet({ id: 1, role: 'SUPER_ADMIN' }, 3);
    expect(biz.licenseStatus).toBe('PENDING');
  });
});

describe('businessController.list license gate', () => {
  test('ADMIN only sees ACTIVE businesses', async () => {
    prisma.business.findMany.mockResolvedValue([{ id: 1, licenseStatus: 'ACTIVE' }]);
    await runList({ id: 1, role: 'ADMIN' });
    expect(prisma.business.findMany).toHaveBeenCalledWith({
      where: { isActive: true, licenseStatus: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  });

  test('SUPER_ADMIN sees every license status', async () => {
    prisma.business.findMany.mockResolvedValue([{ id: 1, licenseStatus: 'PENDING' }]);
    await runList({ id: 1, role: 'SUPER_ADMIN' });
    expect(prisma.business.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  test('a regular user only sees their ACTIVE granted businesses', async () => {
    prisma.userBusiness.findMany.mockResolvedValue([
      { business: { id: 1, isActive: true, licenseStatus: 'ACTIVE' } },
      { business: { id: 2, isActive: true, licenseStatus: 'PENDING' } },
    ]);
    const result = await runList({ id: 5, role: 'MANAGER' });
    expect(result).toEqual([{ id: 1, isActive: true, licenseStatus: 'ACTIVE' }]);
  });
});

describe('resolveBusiness license gate', () => {
  test('ADMIN defaulting to business 1 is blocked when business 1 is not ACTIVE', async () => {
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'SUSPENDED' });
    const result = await runResolve({ id: 1, role: 'ADMIN' });
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('Business license suspended');
  });

  test('ADMIN switching via header to a PENDING business is blocked', async () => {
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'PENDING' });
    const result = await runResolve({ id: 1, role: 'ADMIN' }, 7);
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('License not yet activated');
  });

  test('SUPER_ADMIN switching to a PENDING business is never blocked (no license lookup at all)', async () => {
    const result = await runResolve({ id: 1, role: 'SUPER_ADMIN' }, 7);
    expect(result.businessId).toBe(7);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  test('a granted regular user is blocked from a SUSPENDED business', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 7 });
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'SUSPENDED' });
    const result = await runResolve({ id: 5, role: 'MANAGER' }, 7);
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('Business license suspended');
  });

  test('an ACTIVE business resolves normally for a regular user', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 7 });
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'ACTIVE' });
    const result = await runResolve({ id: 5, role: 'MANAGER' }, 7);
    expect(result.businessId).toBe(7);
  });
});
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npx jest tests/businessLicenseAccessControl.test.js -v`
Expected: FAIL — `list`/`get` don't yet filter/check `licenseStatus`, and `resolveBusiness` doesn't yet look it up (most assertions on `prisma.business.findMany`/`findUnique` calls or 403 responses will not match).

- [ ] **Step 5: Implement the gate in `businessController.js`**

Replace `exports.list` ([businessController.js:8-25](../../../server/controllers/businessController.js#L8-L25)):

```js
exports.list = async (req, res, next) => {
  try {
    let businesses;
    if (req.user.role === 'SUPER_ADMIN') {
      businesses = await prisma.business.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    } else if (req.user.role === 'ADMIN') {
      businesses = await prisma.business.findMany({
        where: { isActive: true, licenseStatus: 'ACTIVE' },
        orderBy: { name: 'asc' },
      });
    } else {
      const ubs = await prisma.userBusiness.findMany({
        where: { userId: req.user.id },
        include: { business: true },
      });
      businesses = ubs.map((ub) => ub.business).filter((b) => b.isActive && b.licenseStatus === 'ACTIVE');
    }
    res.json(businesses);
  } catch (err) { next(err); }
};
```

Replace `exports.get` ([businessController.js:28-47](../../../server/controllers/businessController.js#L28-L47)):

```js
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    // Non-admins may only fetch a business they've been granted access to —
    // same restriction list() already applies. Without this, any authenticated
    // user could read another business's profile (name, TIN, address, contact
    // info) just by guessing its id.
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      const ub = await prisma.userBusiness.findUnique({
        where: { userId_businessId: { userId: req.user.id, businessId: id } },
      });
      if (!ub) throw createError('Access denied to this business', 403);
    }

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);

    if (req.user.role !== 'SUPER_ADMIN' && biz.licenseStatus !== 'ACTIVE') {
      throw createError(
        biz.licenseStatus === 'PENDING' ? 'License not yet activated' : 'Business license suspended',
        403
      );
    }

    res.json(biz);
  } catch (err) { next(err); }
};
```

- [ ] **Step 6: Implement the gate in `resolveBusiness` (`server/middleware/auth.js`)**

Replace the whole `resolveBusiness` function ([auth.js:26-68](../../../server/middleware/auth.js#L26-L68)) with:

```js
// SUPER_ADMIN bypasses the license gate entirely; every other caller must
// resolve to an ACTIVE business or be rejected before req.businessId is
// trusted downstream.
async function assertLicenseActive(req, res, businessId) {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { licenseStatus: true },
  });
  if (biz && biz.licenseStatus !== 'ACTIVE') {
    res.status(403).json({
      error: biz.licenseStatus === 'PENDING' ? 'License not yet activated' : 'Business license suspended',
    });
    return false;
  }
  return true;
}

const resolveBusiness = async (req, res, next) => {
  try {
    const headerBizId = Number(req.headers['x-business-id']);

    if (!headerBizId) {
      if (req.user?.role === 'SUPER_ADMIN') {
        req.businessId = 1;
        return next();
      }
      if (req.user?.role === 'ADMIN') {
        if (!(await assertLicenseActive(req, res, 1))) return;
        req.businessId = 1;
        return next();
      }
      const ub = await prisma.userBusiness.findFirst({
        where: { userId: req.user.id },
        orderBy: { businessId: 'asc' },
      });
      const bizId = ub?.businessId || 1;
      if (!(await assertLicenseActive(req, res, bizId))) return;
      req.businessId = bizId;
      return next();
    }

    if (req.user?.role === 'SUPER_ADMIN') {
      req.businessId = headerBizId;
      return next();
    }
    if (req.user?.role === 'ADMIN') {
      if (!(await assertLicenseActive(req, res, headerBizId))) return;
      req.businessId = headerBizId;
      return next();
    }

    // Non-admin: verify they have access to this business
    const ub = await prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId: headerBizId } },
    });
    if (!ub) {
      return res.status(403).json({ error: 'Access denied to this business' });
    }
    if (!(await assertLicenseActive(req, res, headerBizId))) return;
    req.businessId = headerBizId;
    next();
  } catch (err) {
    // If user_businesses table doesn't exist yet (migration pending), default to business 1
    if (err.code === 'P2021' || err.message?.includes('user_businesses') || err.message?.includes('does not exist')) {
      req.businessId = 1;
      return next();
    }
    next(err);
  }
};
```

- [ ] **Step 7: Run both test files to verify everything passes**

Run: `npx jest tests/businessGetAccessControl.test.js tests/businessLicenseAccessControl.test.js -v`
Expected: all tests PASS (5 + 11 = 16 tests).

- [ ] **Step 8: Commit**

```bash
git add server/controllers/businessController.js server/middleware/auth.js tests/businessGetAccessControl.test.js tests/businessLicenseAccessControl.test.js
git commit -m "feat(business): gate list/get/resolveBusiness on license status"
```

---

## Task 3: Mailer — license notification emails

**Files:**
- Modify: `server/utils/mailer.js` (add functions, extend `module.exports` at [mailer.js:172-175](../../../server/utils/mailer.js#L172-L175))
- Test: `tests/mailerLicenseNotices.test.js` (new)

**Interfaces:**
- Consumes: existing `sendMail`, `wrap`, `escapeHtml` (all already defined in `mailer.js`, module-private except `wrap`/`sendMail` which are already exported).
- Produces: `sendLicensePendingNotice(business, requester, superAdminEmails)`, `sendLicenseActivatedNotice(business, requester)`, `sendLicenseSuspendedNotice(business, requester)` — all `async`, all return `boolean` (mirrors `sendInvoiceEmail`'s contract), all never throw. `requester` is `{ email, name }` shaped (matches the JWT payload shape from `authController.js`, or `{ email, firstName, lastName }` from a Prisma `User` row — both are read via `requester?.name || requester?.firstName`). Tasks 4, 6, 7, and 8 call these.

- [ ] **Step 1: Write the failing tests**

Create `tests/mailerLicenseNotices.test.js`:

```js
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'user@test.local';
process.env.SMTP_PASS = 'secret';

jest.mock('nodemailer');

const mailer = require('../server/utils/mailer');
const nodemailer = require('nodemailer');

const sendMailMock = jest.fn().mockResolvedValue({});
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const business = { id: 3, name: 'New Client Co.', code: 'NCC', email: 'client@newclient.ph' };

beforeEach(() => sendMailMock.mockClear());

describe('mailer.sendLicensePendingNotice', () => {
  test('emails every super admin recipient', async () => {
    await mailer.sendLicensePendingNotice(business, { name: 'Juan Dela Cruz', email: 'juan@finara.ph' }, ['super1@finara.ph', 'super2@finara.ph']);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls.map((c) => c[0].to)).toEqual(['super1@finara.ph', 'super2@finara.ph']);
    expect(sendMailMock.mock.calls[0][0].subject).toBe('New business pending license — New Client Co.');
  });

  test('returns false and sends nothing when there are no super admin recipients', async () => {
    const result = await mailer.sendLicensePendingNotice(business, { name: 'Juan' }, []);
    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('escapes the business name and requester name in the HTML body', async () => {
    const evilBusiness = { ...business, name: '<script>alert(1)</script>' };
    await mailer.sendLicensePendingNotice(evilBusiness, { name: '<img src=x onerror=alert(1)>' }, ['super1@finara.ph']);
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });
});

describe('mailer.sendLicenseActivatedNotice', () => {
  test('emails the requester and the business contact email', async () => {
    await mailer.sendLicenseActivatedNotice(business, { email: 'requester@finara.ph', firstName: 'Ana' });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls.map((c) => c[0].to).sort()).toEqual(['client@newclient.ph', 'requester@finara.ph'].sort());
  });

  test('deduplicates when requester email equals business email', async () => {
    await mailer.sendLicenseActivatedNotice(business, { email: 'client@newclient.ph' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  test('returns false when there is no requester and no business email', async () => {
    const result = await mailer.sendLicenseActivatedNotice({ ...business, email: null }, null);
    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('mailer.sendLicenseSuspendedNotice', () => {
  test('emails the requester with a suspension notice', async () => {
    await mailer.sendLicenseSuspendedNotice(business, { email: 'requester@finara.ph' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'requester@finara.ph',
      subject: 'Your Finara license has been suspended — New Client Co.',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/mailerLicenseNotices.test.js -v`
Expected: FAIL with `mailer.sendLicensePendingNotice is not a function` (and similar for the other two).

- [ ] **Step 3: Implement the three functions in `mailer.js`**

Add these three functions directly above `module.exports` (after `sendPayslipEmail`, [mailer.js:158-170](../../../server/utils/mailer.js#L158-L170)):

```js
async function sendLicensePendingNotice(business, requester, superAdminEmails) {
  if (!superAdminEmails?.length) return false;
  const requesterLabel = requester?.name || requester?.firstName || requester?.email || 'A user';
  const html = wrap('New Business Pending License',
    `<p><strong>${escapeHtml(requesterLabel)}</strong> created a new business that is awaiting license activation.</p>
     <p><strong>Business:</strong> ${escapeHtml(business.name)} (${escapeHtml(business.code)})</p>
     <p>Sign in as SUPER_ADMIN and open Settings &rarr; Businesses to activate its license.</p>`);
  const results = await Promise.all(
    superAdminEmails.map((to) => sendMail({ to, subject: `New business pending license — ${business.name}`, html }))
  );
  return results.some(Boolean);
}

async function sendLicenseActivatedNotice(business, requester) {
  const recipients = [...new Set([requester?.email, business.email].filter(Boolean))];
  if (!recipients.length) return false;
  const html = wrap('Your Finara License Is Active',
    `<p>Good news — the license for <strong>${escapeHtml(business.name)}</strong> has been activated. You now have full access.</p>`);
  const results = await Promise.all(
    recipients.map((to) => sendMail({ to, subject: `Your Finara license is active — ${business.name}`, html }))
  );
  return results.some(Boolean);
}

async function sendLicenseSuspendedNotice(business, requester) {
  const recipients = [...new Set([requester?.email, business.email].filter(Boolean))];
  if (!recipients.length) return false;
  const html = wrap('Your Finara License Has Been Suspended',
    `<p>The license for <strong>${escapeHtml(business.name)}</strong> has been suspended. Access is locked until it is reactivated.</p>`);
  const results = await Promise.all(
    recipients.map((to) => sendMail({ to, subject: `Your Finara license has been suspended — ${business.name}`, html }))
  );
  return results.some(Boolean);
}
```

Update `module.exports` ([mailer.js:172-175](../../../server/utils/mailer.js#L172-L175)):

```js
module.exports = {
  sendMail, sendPasswordReset, sendInvoiceEmail, sendOverdueReminder, sendPayslipEmail,
  sendLicensePendingNotice, sendLicenseActivatedNotice, sendLicenseSuspendedNotice,
  wrap, getTransporter, APP_URL, fillTemplate,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/mailerLicenseNotices.test.js -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/utils/mailer.js tests/mailerLicenseNotices.test.js
git commit -m "feat(mailer): add business license notification emails"
```

---

## Task 4: `create()` wiring — new businesses start PENDING

**Files:**
- Modify: `server/controllers/businessController.js:50-74` (`create`)
- Test: `tests/businessLicenseCreate.test.js` (new)

**Interfaces:**
- Consumes: `prisma.licenseEvent.create` (Task 1), `mailer.sendLicensePendingNotice` (Task 3).
- Produces: every new `Business` now has `licenseStatus: 'PENDING'` and `createdByUserId` set; a `LicenseEvent(eventType: 'CREATED')` row exists for it; SUPER_ADMINs get notified. Tasks 6/7/8 read `createdByUserId` back off the `Business` row to find who to notify on activation/suspension.

- [ ] **Step 1: Write the failing test**

Create `tests/businessLicenseCreate.test.js`:

```js
jest.mock('../server/config/database', () => ({
  business:     { create: jest.fn() },
  user:         { findMany: jest.fn() },
  userBusiness: { createMany: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ clearBusinessCache: jest.fn() }));
jest.mock('../server/utils/cloneChartOfAccounts', () => ({ cloneChartOfAccounts: jest.fn().mockResolvedValue() }));
jest.mock('../prisma/seedDemo', () => ({ resetDemoBusiness: jest.fn() }));
jest.mock('../server/utils/mailer', () => ({ sendLicensePendingNotice: jest.fn().mockResolvedValue(true) }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl   = require('../server/controllers/businessController');

const run = (user, body) => new Promise((resolve, reject) => {
  ctrl.create({ user, body }, { status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findMany.mockImplementation(({ where }) =>
    where.role === 'ADMIN'
      ? Promise.resolve([{ id: 1 }])
      : Promise.resolve([{ id: 9, email: 'super1@finara.ph' }, { id: 10, email: 'super2@finara.ph' }]));
});

describe('businessController.create license wiring', () => {
  test('creates the business as PENDING with the requesting user recorded', async () => {
    prisma.business.create.mockResolvedValue({ id: 3, name: 'New Client Co.', code: 'NCC' });

    await run({ id: 7, name: 'Juan Dela Cruz', email: 'juan@finara.ph' }, { code: 'ncc', name: 'New Client Co.' });

    expect(prisma.business.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ licenseStatus: 'PENDING', createdByUserId: 7 }),
    }));
  });

  test('logs a CREATED license event', async () => {
    prisma.business.create.mockResolvedValue({ id: 3, name: 'New Client Co.', code: 'NCC' });

    await run({ id: 7, name: 'Juan Dela Cruz' }, { code: 'ncc', name: 'New Client Co.' });

    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'CREATED', actorUserId: 7 },
    });
  });

  test('notifies every SUPER_ADMIN', async () => {
    prisma.business.create.mockResolvedValue({ id: 3, name: 'New Client Co.', code: 'NCC' });
    const requester = { id: 7, name: 'Juan Dela Cruz' };

    await run(requester, { code: 'ncc', name: 'New Client Co.' });

    expect(mailer.sendLicensePendingNotice).toHaveBeenCalledWith(
      { id: 3, name: 'New Client Co.', code: 'NCC' },
      requester,
      ['super1@finara.ph', 'super2@finara.ph'],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/businessLicenseCreate.test.js -v`
Expected: FAIL — `data` passed to `prisma.business.create` has no `licenseStatus`/`createdByUserId`, `prisma.licenseEvent.create` is never called, `mailer.sendLicensePendingNotice` is never called.

- [ ] **Step 3: Implement in `businessController.js`**

Add these two requires near the top of the file (after the existing `const { cloneChartOfAccounts } = ...` line, [businessController.js:1-5](../../../server/controllers/businessController.js#L1-L5)):

```js
const mailer = require('../utils/mailer');
```

Replace `exports.create` ([businessController.js:50-74](../../../server/controllers/businessController.js#L50-L74)):

```js
// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { code, name, tin, address, phone, email, industry, booksStartDate } = req.body;
    if (!code || !name) throw createError('code and name are required', 400);

    const biz = await prisma.business.create({
      data: {
        code: code.toUpperCase(), name, tin, address, phone, email, industry,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
        licenseStatus: 'PENDING',
        createdByUserId: req.user.id,
      },
    });

    // Auto-clone the default COA from business 1 into the new business
    await cloneChartOfAccounts(1, biz.id);

    // Grant all ADMIN users access to the new business
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.userBusiness.createMany({
      data: admins.map((u) => ({ userId: u.id, businessId: biz.id })),
      skipDuplicates: true,
    });

    await prisma.licenseEvent.create({
      data: { businessId: biz.id, eventType: 'CREATED', actorUserId: req.user.id },
    });

    // Fire-and-forget: sendMail never throws, so this never blocks the response.
    const superAdmins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
    mailer.sendLicensePendingNotice(biz, req.user, superAdmins.map((u) => u.email));

    res.status(201).json(biz);
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/businessLicenseCreate.test.js -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/controllers/businessController.js tests/businessLicenseCreate.test.js
git commit -m "feat(business): new businesses start PENDING and notify SUPER_ADMIN"
```

---

## Task 5: PayMongo utility module

**Files:**
- Create: `server/utils/paymongo.js`
- Test: `tests/paymongo.test.js` (new)

**Interfaces:**
- Produces: `isConfigured(): boolean`, `createPaymentLink({ amount, description, businessId }): Promise<{ id: string, url: string }>` (throws on failure/non-2xx), `verifyWebhookSignature(rawBody: Buffer|string, signatureHeader: string, secret: string): boolean`. Tasks 7 and 8 both depend on these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

Create `tests/paymongo.test.js`:

```js
const crypto = require('crypto');

const OLD_ENV = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...OLD_ENV };
  global.fetch = jest.fn();
});
afterEach(() => { process.env = OLD_ENV; });

describe('paymongo.isConfigured', () => {
  test('false when PAYMONGO_SECRET_KEY is unset', () => {
    delete process.env.PAYMONGO_SECRET_KEY;
    const paymongo = require('../server/utils/paymongo');
    expect(paymongo.isConfigured()).toBe(false);
  });

  test('true when PAYMONGO_SECRET_KEY is set', () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    const paymongo = require('../server/utils/paymongo');
    expect(paymongo.isConfigured()).toBe(true);
  });
});

describe('paymongo.createPaymentLink', () => {
  test('POSTs to /v1/payment_links with Basic auth, centavos amount, and businessId metadata', async () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    const paymongo = require('../server/utils/paymongo');
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'link_123', url: 'https://pm.link/finara/abc' } }),
    });

    const result = await paymongo.createPaymentLink({ amount: 15000, description: 'License fee', businessId: 3 });

    expect(result).toEqual({ id: 'link_123', url: 'https://pm.link/finara/abc' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.paymongo.com/v1/payment_links');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('sk_test_abc:').toString('base64')}`);
    const body = JSON.parse(options.body);
    expect(body).toEqual({ amount: 1500000, currency: 'PHP', description: 'License fee', metadata: { businessId: '3' } });
  });

  test('throws PayMongo\'s error detail on a non-2xx response', async () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    const paymongo = require('../server/utils/paymongo');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: [{ detail: 'Invalid API key.' }] }),
    });

    await expect(paymongo.createPaymentLink({ amount: 100, description: 'x', businessId: 1 }))
      .rejects.toThrow('Invalid API key.');
  });

  test('throws when PAYMONGO_SECRET_KEY is unset', async () => {
    delete process.env.PAYMONGO_SECRET_KEY;
    const paymongo = require('../server/utils/paymongo');
    await expect(paymongo.createPaymentLink({ amount: 100, description: 'x', businessId: 1 }))
      .rejects.toThrow('PAYMONGO_SECRET_KEY not configured');
  });
});

describe('paymongo.verifyWebhookSignature', () => {
  const secret = 'whsec_test123';
  function sign(t, rawBody) {
    return crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  }

  test('accepts a valid test-mode signature (te)', () => {
    const paymongo = require('../server/utils/paymongo');
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const t = '1700000000';
    const te = sign(t, rawBody);
    const header = `t=${t},te=${te},li=`;
    expect(paymongo.verifyWebhookSignature(rawBody, header, secret)).toBe(true);
  });

  test('accepts a valid live-mode signature (li)', () => {
    const paymongo = require('../server/utils/paymongo');
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const t = '1700000000';
    const li = sign(t, rawBody);
    const header = `t=${t},te=,li=${li}`;
    expect(paymongo.verifyWebhookSignature(rawBody, header, secret)).toBe(true);
  });

  test('rejects a tampered body', () => {
    const paymongo = require('../server/utils/paymongo');
    const t = '1700000000';
    const te = sign(t, Buffer.from(JSON.stringify({ hello: 'world' })));
    const header = `t=${t},te=${te},li=`;
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'tampered' }));
    expect(paymongo.verifyWebhookSignature(tamperedBody, header, secret)).toBe(false);
  });

  test('rejects a missing signature header', () => {
    const paymongo = require('../server/utils/paymongo');
    expect(paymongo.verifyWebhookSignature(Buffer.from('{}'), undefined, secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/paymongo.test.js -v`
Expected: FAIL with `Cannot find module '../server/utils/paymongo'`.

- [ ] **Step 3: Implement `server/utils/paymongo.js`**

```js
const crypto = require('crypto');

const API_BASE = 'https://api.paymongo.com/v1';
const TIMEOUT_MS = 10000;

function isConfigured() {
  return !!process.env.PAYMONGO_SECRET_KEY;
}

async function createPaymentLink({ amount, description, businessId }) {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) throw new Error('PAYMONGO_SECRET_KEY not configured');

  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  const res = await fetch(`${API_BASE}/payment_links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: Math.round(Number(amount) * 100),
      currency: 'PHP',
      description,
      metadata: { businessId: String(businessId) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await res.json();
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail || `PayMongo responded ${res.status}`;
    throw new Error(detail);
  }
  return { id: body.data.id, url: body.data.url };
}

/** t=<epoch>,te=<test-mode sig>,li=<live-mode sig> — use whichever of te/li is non-empty. */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const parts = {};
  for (const pair of signatureHeader.split(',')) {
    const [k, v] = pair.split('=');
    parts[k] = v;
  }
  const { t, te, li } = parts;
  const signature = li || te;
  if (!t || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false; // length mismatch, non-hex signature, etc.
  }
}

module.exports = { isConfigured, createPaymentLink, verifyWebhookSignature };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/paymongo.test.js -v`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/utils/paymongo.js tests/paymongo.test.js
git commit -m "feat(paymongo): add payment link creation and webhook signature verification"
```

---

## Task 6: Manual license transition endpoint (SUPER_ADMIN)

**Files:**
- Modify: `server/controllers/businessController.js` (add `exports.updateLicense`)
- Modify: `server/routes/businesses.js`
- Test: `tests/businessLicenseUpdate.test.js` (new)

**Interfaces:**
- Consumes: `mailer.sendLicenseActivatedNotice`/`sendLicenseSuspendedNotice` (Task 3).
- Produces: `PATCH /api/businesses/:id/license` — route + controller. No other task depends on this one's internals, but it's part of the state machine described in the spec.

- [ ] **Step 1: Write the failing test**

Create `tests/businessLicenseUpdate.test.js`:

```js
jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn() },
  user:         { findUnique: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({
  sendLicenseActivatedNotice: jest.fn().mockResolvedValue(true),
  sendLicenseSuspendedNotice: jest.fn().mockResolvedValue(true),
}));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl   = require('../server/controllers/businessController');

const run = (user, id, body) => new Promise((resolve, reject) => {
  ctrl.updateLicense({ params: { id: String(id) }, user, body }, { json: resolve }, reject);
});

const superAdmin = { id: 1, role: 'SUPER_ADMIN' };

beforeEach(() => jest.clearAllMocks());

describe('businessController.updateLicense', () => {
  test('PENDING -> ACTIVE activates and logs ACTIVATED', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7 });
    prisma.business.update.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'juan@finara.ph' });

    const result = await run(superAdmin, 3, { status: 'ACTIVE', note: 'Paid via GCash ref #12345' });

    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { licenseStatus: 'ACTIVE', licenseActivatedAt: expect.any(Date), licenseActivatedBy: 1 },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'ACTIVATED', note: 'Paid via GCash ref #12345', actorUserId: 1 },
    });
    expect(mailer.sendLicenseActivatedNotice).toHaveBeenCalledWith(
      { id: 3, name: 'NCC', licenseStatus: 'ACTIVE' },
      { id: 7, email: 'juan@finara.ph' },
    );
    expect(result).toEqual({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE' });
  });

  test('SUSPENDED -> ACTIVE logs REACTIVATED', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'SUSPENDED', createdByUserId: null });
    prisma.business.update.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE' });

    await run(superAdmin, 3, { status: 'ACTIVE' });

    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'REACTIVATED', note: null, actorUserId: 1 },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('ACTIVE -> SUSPENDED logs SUSPENDED and does not touch licenseActivatedAt/By', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE', createdByUserId: null });
    prisma.business.update.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'SUSPENDED' });

    await run(superAdmin, 3, { status: 'SUSPENDED', note: 'Non-payment dispute' });

    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { licenseStatus: 'SUSPENDED' },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'SUSPENDED', note: 'Non-payment dispute', actorUserId: 1 },
    });
    expect(mailer.sendLicenseSuspendedNotice).toHaveBeenCalled();
  });

  test('rejects re-activating an already-ACTIVE business with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE' });
    await expect(run(superAdmin, 3, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  test('rejects PENDING -> SUSPENDED with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'PENDING' });
    await expect(run(superAdmin, 3, { status: 'SUSPENDED' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an invalid status value with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'PENDING' });
    await expect(run(superAdmin, 3, { status: 'BOGUS' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('404s when the business does not exist', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(run(superAdmin, 99, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/businessLicenseUpdate.test.js -v`
Expected: FAIL with `ctrl.updateLicense is not a function`.

- [ ] **Step 3: Implement `exports.updateLicense` in `businessController.js`**

Add near the top of the file, alongside the other module-level constants (after the `require` lines):

```js
const LICENSE_TRANSITIONS = {
  PENDING:   { ACTIVE: 'ACTIVATED' },
  SUSPENDED: { ACTIVE: 'REACTIVATED' },
  ACTIVE:    { SUSPENDED: 'SUSPENDED' },
};
```

Add this new exported function (place it after `exports.update`, before the `resetDemo` section):

```js
// ─── License transition (manual, SUPER_ADMIN only) ────────────────
exports.updateLicense = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, note } = req.body;
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      throw createError('status must be ACTIVE or SUSPENDED', 400);
    }

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);

    const eventType = LICENSE_TRANSITIONS[biz.licenseStatus]?.[status];
    if (!eventType) {
      throw createError(`Cannot transition license from ${biz.licenseStatus} to ${status}`, 400);
    }

    const isActivating = status === 'ACTIVE';
    const updated = await prisma.business.update({
      where: { id },
      data: isActivating
        ? { licenseStatus: status, licenseActivatedAt: new Date(), licenseActivatedBy: req.user.id }
        : { licenseStatus: status },
    });

    await prisma.licenseEvent.create({
      data: { businessId: id, eventType, note: note || null, actorUserId: req.user.id },
    });

    const requester = biz.createdByUserId
      ? await prisma.user.findUnique({ where: { id: biz.createdByUserId } })
      : null;
    if (isActivating) mailer.sendLicenseActivatedNotice(updated, requester);
    else mailer.sendLicenseSuspendedNotice(updated, requester);

    res.json(updated);
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Wire the route in `server/routes/businesses.js`**

Add this line after `router.put('/:id', adminOnly, ctrl.update);` ([businesses.js:13](../../../server/routes/businesses.js#L13)):

```js
router.patch('/:id/license', authorize('SUPER_ADMIN'), ctrl.updateLicense);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/businessLicenseUpdate.test.js -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/businessController.js server/routes/businesses.js tests/businessLicenseUpdate.test.js
git commit -m "feat(business): add manual SUPER_ADMIN license activate/suspend endpoint"
```

---

## Task 7: Payment link generation endpoint (ADMIN)

**Files:**
- Modify: `server/controllers/businessController.js` (add `exports.generatePaymentLink`)
- Modify: `server/routes/businesses.js`
- Test: `tests/businessPaymentLink.test.js` (new)

**Interfaces:**
- Consumes: `paymongo.isConfigured`/`createPaymentLink` (Task 5).
- Produces: `POST /api/businesses/:id/license/payment-link`. Task 9 (frontend) calls this via `lib/api.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/businessPaymentLink.test.js`:

```js
jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/paymongo', () => ({
  isConfigured: jest.fn(),
  createPaymentLink: jest.fn(),
}));

const prisma = require('../server/config/database');
const paymongo = require('../server/utils/paymongo');
const ctrl = require('../server/controllers/businessController');

const run = (user, id, body) => new Promise((resolve, reject) => {
  ctrl.generatePaymentLink({ params: { id: String(id) }, user, body }, { json: resolve }, reject);
});

const admin = { id: 2, role: 'ADMIN' };

beforeEach(() => jest.clearAllMocks());

describe('businessController.generatePaymentLink', () => {
  test('generates a link and stores it on the business', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING' });
    paymongo.isConfigured.mockReturnValue(true);
    paymongo.createPaymentLink.mockResolvedValue({ id: 'link_123', url: 'https://pm.link/finara/abc' });
    prisma.business.update.mockResolvedValue({ id: 3, paymentLinkUrl: 'https://pm.link/finara/abc' });

    const result = await run(admin, 3, { amount: 15000, description: 'License fee' });

    expect(paymongo.createPaymentLink).toHaveBeenCalledWith({ amount: 15000, description: 'License fee', businessId: 3 });
    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        paymentLinkId: 'link_123',
        paymentLinkUrl: 'https://pm.link/finara/abc',
        paymentLinkAmount: 15000,
        paymentLinkGeneratedAt: expect.any(Date),
      },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'PAYMENT_LINK_GENERATED', amount: 15000, actorUserId: 2 },
    });
    expect(result).toEqual({ paymentLinkUrl: 'https://pm.link/finara/abc' });
  });

  test('defaults the description when none is given', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING' });
    paymongo.isConfigured.mockReturnValue(true);
    paymongo.createPaymentLink.mockResolvedValue({ id: 'link_1', url: 'https://pm.link/x' });
    prisma.business.update.mockResolvedValue({});

    await run(admin, 3, { amount: 5000 });

    expect(paymongo.createPaymentLink).toHaveBeenCalledWith({ amount: 5000, description: 'Finara license — NCC', businessId: 3 });
  });

  test('rejects a zero or missing amount with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'PENDING' });
    await expect(run(admin, 3, { amount: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(paymongo.createPaymentLink).not.toHaveBeenCalled();
  });

  test('rejects generating a link for an already-ACTIVE business with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE' });
    await expect(run(admin, 3, { amount: 5000 })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects with 400 when PayMongo is not configured', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING' });
    paymongo.isConfigured.mockReturnValue(false);
    await expect(run(admin, 3, { amount: 5000 })).rejects.toMatchObject({ statusCode: 400 });
    expect(paymongo.createPaymentLink).not.toHaveBeenCalled();
  });

  test('404s when the business does not exist', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(run(admin, 99, { amount: 5000 })).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/businessPaymentLink.test.js -v`
Expected: FAIL with `ctrl.generatePaymentLink is not a function`.

- [ ] **Step 3: Implement `exports.generatePaymentLink` in `businessController.js`**

Add this require near the top of the file, next to the `mailer` require added in Task 4:

```js
const paymongo = require('../utils/paymongo');
```

Add this new exported function (place it directly after `exports.updateLicense` from Task 6):

```js
// ─── Payment link generation (ADMIN, online path) ──────────────────
exports.generatePaymentLink = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) throw createError('amount must be a positive number', 400);

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    if (biz.licenseStatus === 'ACTIVE') throw createError('Business license is already active', 400);
    if (!paymongo.isConfigured()) {
      throw createError('Online payment not configured — use manual activation', 400);
    }

    const link = await paymongo.createPaymentLink({
      amount,
      description: req.body.description || `Finara license — ${biz.name}`,
      businessId: id,
    });

    const updated = await prisma.business.update({
      where: { id },
      data: {
        paymentLinkId: link.id,
        paymentLinkUrl: link.url,
        paymentLinkAmount: amount,
        paymentLinkGeneratedAt: new Date(),
      },
    });

    await prisma.licenseEvent.create({
      data: { businessId: id, eventType: 'PAYMENT_LINK_GENERATED', amount, actorUserId: req.user.id },
    });

    res.json({ paymentLinkUrl: updated.paymentLinkUrl });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Wire the route in `server/routes/businesses.js`**

Add this line directly after the `router.patch('/:id/license', ...)` line added in Task 6:

```js
router.post('/:id/license/payment-link', adminOnly, ctrl.generatePaymentLink);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/businessPaymentLink.test.js -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/businessController.js server/routes/businesses.js tests/businessPaymentLink.test.js
git commit -m "feat(business): add ADMIN PayMongo payment link generation endpoint"
```

---

## Task 8: PayMongo webhook — auto-activation

**Files:**
- Create: `server/controllers/webhookController.js`
- Create: `server/routes/webhooks.js`
- Modify: `server/routes/index.js`
- Modify: `server/index.js` (mount raw-body parser before the global JSON parser)
- Test: `tests/paymongoWebhook.test.js` (new)

**Interfaces:**
- Consumes: `paymongo.verifyWebhookSignature` (Task 5), `mailer.sendLicenseActivatedNotice` (Task 3).
- Produces: `POST /api/webhooks/paymongo` (public, signature-verified).

- [ ] **Step 1: Write the failing test**

Create `tests/paymongoWebhook.test.js`:

```js
const crypto = require('crypto');

jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn() },
  user:         { findUnique: jest.fn() },
  licenseEvent: { create: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../server/utils/mailer', () => ({ sendLicenseActivatedNotice: jest.fn().mockResolvedValue(true) }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl = require('../server/controllers/webhookController');

const WEBHOOK_SECRET = 'whsec_test123';
process.env.PAYMONGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

function signedRequest(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const t = '1700000000';
  const te = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.`).update(rawBody).digest('hex');
  return { headers: { 'paymongo-signature': `t=${t},te=${te},li=` }, body: rawBody };
}

function linkPaymentPaidPayload({ businessId, amount = 1500000 }) {
  return {
    data: {
      id: 'evt_1', type: 'event',
      attributes: {
        type: 'link.payment.paid',
        data: {
          id: 'pay_1', type: 'payment',
          attributes: { amount, currency: 'PHP', status: 'paid', origin: 'links', metadata: { businessId: String(businessId) } },
        },
      },
    },
  };
}

const run = (req) => new Promise((resolve) => {
  const res = { statusCode: null, sendStatus(code) { this.statusCode = code; resolve(this); } };
  ctrl.paymongo(req, res);
});

beforeEach(() => jest.clearAllMocks());

describe('webhookController.paymongo', () => {
  test('rejects an invalid signature with 401 and makes no DB writes', async () => {
    const req = { headers: { 'paymongo-signature': 't=123,te=bogus,li=' }, body: Buffer.from('{}') };
    const res = await run(req);
    expect(res.statusCode).toBe(401);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  test('activates a PENDING business on a valid link.payment.paid event', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7 });
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'juan@finara.ph' });

    const req = signedRequest(linkPaymentPaidPayload({ businessId: 3 }));
    const res = await run(req);

    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3);
    expect(mailer.sendLicenseActivatedNotice).toHaveBeenCalledWith(
      { id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7 },
      { id: 7, email: 'juan@finara.ph' },
    );
  });

  test('is a no-op (200, no writes) when the business is already ACTIVE', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE' });
    const req = signedRequest(linkPaymentPaidPayload({ businessId: 3 }));
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is a no-op (200) when the businessId in metadata does not match any business', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    const req = signedRequest(linkPaymentPaidPayload({ businessId: 999 }));
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is a no-op (200) for an unrelated event type', async () => {
    const req = signedRequest({ data: { attributes: { type: 'source.chargeable', data: {} } } });
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/paymongoWebhook.test.js -v`
Expected: FAIL with `Cannot find module '../server/controllers/webhookController'`.

- [ ] **Step 3: Implement `server/controllers/webhookController.js`**

```js
const prisma = require('../config/database');
const logger = require('../utils/logger');
const mailer = require('../utils/mailer');
const { verifyWebhookSignature } = require('../utils/paymongo');

exports.paymongo = async (req, res) => {
  const signatureHeader = req.headers['paymongo-signature'];
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  const rawBody = req.body; // Buffer — this route is mounted with express.raw(), see server/index.js

  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    logger.warn('[paymongoWebhook] signature verification failed');
    return res.sendStatus(401);
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }

  const eventType = event?.data?.attributes?.type;
  const payment = event?.data?.attributes?.data;
  const isLinkPayment = eventType === 'link.payment.paid'
    || (eventType === 'payment.paid' && payment?.attributes?.origin === 'links');
  if (!isLinkPayment) return res.sendStatus(200);

  const businessId = Number(payment?.attributes?.metadata?.businessId);
  if (!businessId) return res.sendStatus(200);

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || business.licenseStatus === 'ACTIVE') return res.sendStatus(200);

  const amount = Number(payment?.attributes?.amount || 0) / 100;

  await prisma.$transaction([
    prisma.business.update({
      where: { id: businessId },
      data: { licenseStatus: 'ACTIVE', licenseActivatedAt: new Date(), licenseActivatedBy: null },
    }),
    prisma.licenseEvent.create({
      data: { businessId, eventType: 'PAYMENT_RECEIVED', amount, actorUserId: null },
    }),
    prisma.licenseEvent.create({
      data: { businessId, eventType: 'ACTIVATED', actorUserId: null },
    }),
  ]);

  const requester = business.createdByUserId
    ? await prisma.user.findUnique({ where: { id: business.createdByUserId } })
    : null;
  mailer.sendLicenseActivatedNotice(business, requester);

  res.sendStatus(200);
};
```

- [ ] **Step 4: Create `server/routes/webhooks.js`**

```js
const router = require('express').Router();
const ctrl = require('../controllers/webhookController');

// No `authenticate` — PayMongo calls this unauthenticated. The HMAC
// signature check inside the controller is the authentication.
router.post('/paymongo', ctrl.paymongo);

module.exports = router;
```

- [ ] **Step 5: Register the route module in `server/routes/index.js`**

Add this line to the exported object (after the `cashPosition` line, [routes/index.js:35](../../../server/routes/index.js#L35)):

```js
  webhooks:      require('./webhooks'),
```

- [ ] **Step 6: Mount with a raw-body parser ahead of the global JSON parser in `server/index.js`**

Insert this line between `app.use(compression());` and `app.use(express.json({ limit: '2mb' }));` ([index.js:65-67](../../../server/index.js#L65-L67)) — it must come before the global JSON parser or PayMongo's signature (computed over the raw bytes) can never be verified:

```js
app.use(globalLimiter);
app.use(compression());

// Mounted ahead of the global JSON parser: PayMongo signs the raw request
// body, so this route needs the unparsed Buffer, not a parsed object.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), routes.webhooks);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest tests/paymongoWebhook.test.js -v`
Expected: PASS (5 tests).

- [ ] **Step 8: Run the full backend suite to confirm nothing else broke**

Run: `npx jest`
Expected: all suites PASS.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/webhookController.js server/routes/webhooks.js server/routes/index.js server/index.js tests/paymongoWebhook.test.js
git commit -m "feat(webhook): auto-activate license on PayMongo payment link confirmation"
```

---

## Task 9: Frontend — license UI + env vars

**Files:**
- Modify: `lib/api.js:377-386` (`businesses` export)
- Modify: `app/(dashboard)/settings/businesses/page.jsx`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `PATCH /businesses/:id/license`, `POST /businesses/:id/license/payment-link` (Tasks 6, 7).
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Add the two new calls to `lib/api.js`**

In the `businesses` export ([api.js:377-386](../../../lib/api.js#L377-L386)), add these two lines after `update`:

```js
export const businesses = {
  list:        ()           => api.get('/businesses'),
  get:         (id)         => api.get(`/businesses/${id}`),
  create:      (data)       => api.post('/businesses', data),
  update:      (id, data)   => api.put(`/businesses/${id}`, data),
  updateLicense:       (id, data) => api.patch(`/businesses/${id}/license`, data),
  generatePaymentLink: (id, data) => api.post(`/businesses/${id}/license/payment-link`, data),
  listUsers:   (id)         => api.get(`/businesses/${id}/users`),
  grantUser:   (id, userId) => api.post(`/businesses/${id}/users`, { userId }),
  revokeUser:  (id, userId) => api.delete(`/businesses/${id}/users/${userId}`),
  resetDemo:   ()           => api.post('/businesses/reset-demo'),
};
```

- [ ] **Step 2: Add the PayMongo env vars to `.env.example`**

Add this block after the "Lead webhook" section ([`.env.example`:26-29](../../../.env.example#L26-L29)):

```
# ─── PayMongo (optional — enables online payment links for business licenses) ──
# Leave PAYMONGO_SECRET_KEY blank to disable; SUPER_ADMIN can still activate licenses manually.
PAYMONGO_SECRET_KEY=
PAYMONGO_WEBHOOK_SECRET=
```

- [ ] **Step 3: Add license state to `settings/businesses/page.jsx`**

In `app/(dashboard)/settings/businesses/page.jsx`, add `AlertCircle`, `ShieldCheck`, `ShieldOff`, `Link as LinkIcon`, `Copy`, `Mail` to the `lucide-react` import ([page.jsx:3](../../../app/(dashboard)/settings/businesses/page.jsx#L3)):

```jsx
import { Plus, Pencil, Users, Check, X, Building2, Trash2, RotateCcw, AlertTriangle, ShieldCheck, ShieldOff, Link as LinkIcon, Copy, Mail } from 'lucide-react';
```

Add new state alongside the existing modal state (after the `resetting` line, [page.jsx:38](../../../app/(dashboard)/settings/businesses/page.jsx#L38)):

```jsx
  const [licenseBiz,    setLicenseBiz]    = useState(null);   // business object for the license panel
  const [licenseAction, setLicenseAction] = useState(null);   // 'activate' | 'suspend'
  const [licenseNote,   setLicenseNote]   = useState('');
  const [linkAmount,      setLinkAmount]      = useState('');
  const [linkDescription, setLinkDescription] = useState('');
  const [generatingLink,  setGeneratingLink]  = useState(false);
  const [savingLicense,   setSavingLicense]   = useState(false);

  const isSuperAdmin = me?.role === 'SUPER_ADMIN';
```

Add these handlers after `saveBiz` ([page.jsx:83](../../../app/(dashboard)/settings/businesses/page.jsx#L83), right before the "Demo data reset" section):

```jsx
  // ── License ──────────────────────────────────────────────────
  async function confirmLicenseAction() {
    setSavingLicense(true);
    try {
      const status = licenseAction === 'activate' ? 'ACTIVE' : 'SUSPENDED';
      await bizApi.updateLicense(licenseBiz.id, { status, note: licenseNote || undefined });
      toast.success(status === 'ACTIVE' ? 'License activated' : 'License suspended');
      setLicenseAction(null);
      setLicenseNote('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update license');
    } finally {
      setSavingLicense(false);
    }
  }

  async function generatePaymentLink() {
    setGeneratingLink(true);
    try {
      const { data } = await bizApi.generatePaymentLink(licenseBiz.id, {
        amount: Number(linkAmount),
        description: linkDescription || undefined,
      });
      toast.success('Payment link generated');
      setLicenseBiz((b) => ({ ...b, paymentLinkUrl: data.paymentLinkUrl }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate payment link');
    } finally {
      setGeneratingLink(false);
    }
  }

  function copyPaymentLink(url) {
    navigator.clipboard.writeText(url);
    toast.success('Link copied');
  }
```

- [ ] **Step 4: Add the license badge and "License" action to the table**

Add `'License'` to the table header array ([page.jsx:159](../../../app/(dashboard)/settings/businesses/page.jsx#L159)):

```jsx
                {['Code','Name','TIN','Status','License','Actions'].map((h) => (
```

Add a new `<td>` for the license badge right after the existing Status `<td>` ([page.jsx:170-174](../../../app/(dashboard)/settings/businesses/page.jsx#L170-L174)):

```jsx
                  <td className="px-4 py-3">
                    <span className={`badge ${
                      biz.licenseStatus === 'ACTIVE' ? 'badge-green' :
                      biz.licenseStatus === 'SUSPENDED' ? 'badge-red' : 'badge-yellow'
                    }`}>
                      {biz.licenseStatus === 'ACTIVE' ? 'Active' : biz.licenseStatus === 'SUSPENDED' ? 'Suspended' : 'Pending'}
                    </span>
                  </td>
```

Add a "License" button inside the Actions `<td>`'s button group ([page.jsx:176-192](../../../app/(dashboard)/settings/businesses/page.jsx#L176-L192)), right after the "Users" button:

```jsx
                      <button onClick={() => { setLicenseBiz(biz); setLinkAmount(''); setLinkDescription(''); }} className="btn-secondary py-1 px-2 text-xs flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> License
                      </button>
```

Update `colSpan` on the "No businesses found" row from `5` to `6` ([page.jsx:197](../../../app/(dashboard)/settings/businesses/page.jsx#L197)).

- [ ] **Step 5: Add the toast for pending license activation on create**

In `saveBiz` ([page.jsx:71-73](../../../app/(dashboard)/settings/businesses/page.jsx#L71-L73)), change the create-branch toast:

```jsx
      if (editBiz === 'new') {
        await bizApi.create(form);
        toast.success('Business created — pending license activation');
      } else {
```

- [ ] **Step 6: Add the License modal**

Add this new modal block right after the "Reset demo data modal" block, before the closing `</div>` of the component ([page.jsx:322-323](../../../app/(dashboard)/settings/businesses/page.jsx#L322-L323)):

```jsx
      {/* License modal */}
      {licenseBiz !== null && (
        <Modal title={`License — ${licenseBiz.name}`} onClose={() => setLicenseBiz(null)}>
          <div className="mb-4">
            <span className={`badge ${
              licenseBiz.licenseStatus === 'ACTIVE' ? 'badge-green' :
              licenseBiz.licenseStatus === 'SUSPENDED' ? 'badge-red' : 'badge-yellow'
            }`}>
              {licenseBiz.licenseStatus === 'ACTIVE' ? 'Active' : licenseBiz.licenseStatus === 'SUSPENDED' ? 'Suspended' : 'Pending'}
            </span>
          </div>

          {licenseBiz.licenseStatus !== 'ACTIVE' && (
            <div className="mb-5 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                <LinkIcon className="w-4 h-4" /> Generate Payment Link
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="label">Amount (PHP)</label>
                  <input className="input" type="number" min="1" step="0.01" value={linkAmount}
                    onChange={(e) => setLinkAmount(e.target.value)} placeholder="15000" />
                </div>
                <div>
                  <label className="label">Description</label>
                  <input className="input" value={linkDescription}
                    onChange={(e) => setLinkDescription(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <button className="btn-secondary text-xs" disabled={!linkAmount || generatingLink} onClick={generatePaymentLink}>
                {generatingLink ? 'Generating…' : 'Generate Link'}
              </button>
              {licenseBiz.paymentLinkUrl && (
                <div className="mt-3 flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <span className="truncate flex-1">{licenseBiz.paymentLinkUrl}</span>
                  <button className="text-blue-600 hover:underline flex items-center gap-1" onClick={() => copyPaymentLink(licenseBiz.paymentLinkUrl)}>
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                  {licenseBiz.email && (
                    <a className="text-blue-600 hover:underline flex items-center gap-1"
                      href={`mailto:${licenseBiz.email}?subject=${encodeURIComponent(`Finara license payment — ${licenseBiz.name}`)}&body=${encodeURIComponent(licenseBiz.paymentLinkUrl)}`}>
                      <Mail className="w-3 h-3" /> Send
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {isSuperAdmin && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">Manual Activation (offline payment)</p>
              {licenseAction === null ? (
                <div className="flex gap-2">
                  {licenseBiz.licenseStatus !== 'ACTIVE' && (
                    <button className="btn-primary text-xs flex items-center gap-1" onClick={() => setLicenseAction('activate')}>
                      <ShieldCheck className="w-3 h-3" /> Activate License
                    </button>
                  )}
                  {licenseBiz.licenseStatus === 'ACTIVE' && (
                    <button className="btn-danger text-xs flex items-center gap-1" onClick={() => setLicenseAction('suspend')}>
                      <ShieldOff className="w-3 h-3" /> Suspend
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <label className="label">Note (optional)</label>
                  <textarea className="input" rows={2} value={licenseNote} onChange={(e) => setLicenseNote(e.target.value)}
                    placeholder="e.g. GCash ref #12345, PHP 15,000, paid 2026-09-11" />
                  <div className="flex justify-end gap-2 pt-3">
                    <button className="btn-secondary text-xs" onClick={() => { setLicenseAction(null); setLicenseNote(''); }}>Cancel</button>
                    <button className="btn-primary text-xs" disabled={savingLicense} onClick={confirmLicenseAction}>
                      {savingLicense ? 'Saving…' : licenseAction === 'activate' ? 'Confirm Activate' : 'Confirm Suspend'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button className="btn-secondary" onClick={() => setLicenseBiz(null)}>Close</button>
          </div>
        </Modal>
      )}
```

- [ ] **Step 7: Manual verification against the running dev server**

The dev server belongs to the user — do not start a competing instance; ask the user to confirm `npm run dev` is running (or run it yourself only if the user says nothing is running), then in a browser at `http://localhost:3000`:

1. Sign in as an ADMIN, go to Settings → Businesses, click "New Business", create one. Confirm the toast says "Business created — pending license activation" and the new row shows a yellow "Pending" license badge.
2. Still as ADMIN, confirm the newly created business does **not** appear in the business switcher (top of the layout).
3. Click "License" on the pending row → confirm the "Generate Payment Link" panel is visible but the manual Activate/Suspend panel is **not** (ADMIN isn't SUPER_ADMIN).
4. Sign out, sign in as a SUPER_ADMIN account, open the same business's License panel, click "Activate License", add a note, confirm. Badge flips to green "Active".
5. Sign back in as the ADMIN — confirm the business now appears in the switcher and is usable.
6. Back as SUPER_ADMIN, click "Suspend" on the now-active business, confirm. Badge flips to red "Suspended"; confirm the ADMIN can no longer switch into it (repeat step 2's check).
7. If a PayMongo test-mode `PAYMONGO_SECRET_KEY` is available, set it in `.env`, restart the server, and confirm "Generate Payment Link" on a Pending business returns a real `https://pm.link/...` URL with Copy/Send working. If not available, confirm the button instead returns the "Online payment not configured" toast error — either outcome is acceptable to consider this step done.

- [ ] **Step 8: Commit**

```bash
git add lib/api.js "app/(dashboard)/settings/businesses/page.jsx" .env.example
git commit -m "feat(business): add license activation UI to Settings > Businesses"
```
