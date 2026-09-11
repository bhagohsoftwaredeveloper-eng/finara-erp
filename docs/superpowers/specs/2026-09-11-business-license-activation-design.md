# Business License Activation — Design

## Purpose

Finara is being sold as a multi-tenant product: each `Business` record added going forward represents a new paying client, not just an internal business unit. Today `businessController.create` ([businessController.js:50-74](../../../server/controllers/businessController.js#L50-L74)) lets any ADMIN spin up a new `Business` that is immediately usable — there is no payment/license gate at all. This adds a license-status gate so a newly created business stays locked until payment is confirmed, with SUPER_ADMIN always retaining the ability to activate a license manually (offline payment), plus an optional PayMongo-generated payment link for online payment, full audit history of every license event, and email notifications.

## Scope

- New `licenseStatus` (`PENDING` / `ACTIVE` / `SUSPENDED`) on `Business`. New businesses are created `PENDING` and are invisible/inaccessible to everyone except SUPER_ADMIN until activated.
- SUPER_ADMIN can manually Activate / Suspend / Reactivate a business's license at any time (offline payment fallback — bank transfer, cash, personal GCash, etc.).
- ADMIN can generate a PayMongo Payment Link for a pending business and send/copy it to the client; a PayMongo webhook auto-activates the license once PayMongo confirms payment. This is additive to the manual path, never a replacement for it.
- Full audit trail (`LicenseEvent`) of every state change: created, payment link generated, payment received, activated, suspended, reactivated — who did it (or "system" for the webhook) and when.
- Email notifications (reusing the existing `mailer.js` SMTP infra) to SUPER_ADMINs on new pending business, and to the requester + business contact email on activation/suspension.
- Existing `isActive` archive flag on `Business` is untouched — orthogonal to `licenseStatus`.

## Out of scope

- No public self-service signup — business creation stays an internal, authenticated ADMIN action exactly as it is today; only the payment-collection step goes through PayMongo.
- No recurring billing / subscription expiry — a license, once `ACTIVE`, stays active until a SUPER_ADMIN manually suspends it.
- No fixed pricing / plans — the ADMIN types the amount per payment link, per client.
- No retry/reconciliation job for missed webhooks — if a webhook is lost, SUPER_ADMIN can always fall back to manual activation. (`GET /v1/payment_links/:id/payments` exists on PayMongo's side for manual reconciliation if ever needed, but no polling job is built here.)

## Data model — `prisma/schema.prisma`

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

model Business {
  ...existing fields...

  licenseStatus          LicenseStatus @default(ACTIVE)   // DB default grandfathers all existing businesses in as ACTIVE
  licenseActivatedAt     DateTime?
  licenseActivatedBy     Int?                              // userId; null when activated by the webhook
  createdByUserId        Int?                              // who requested this business — email target
  paymentLinkId          String?       @db.VarChar(100)    // PayMongo link id, e.g. "link_xxx" — used to correlate the webhook
  paymentLinkUrl         String?       @db.Text
  paymentLinkAmount      Decimal?      @db.Decimal(12, 2)
  paymentLinkGeneratedAt DateTime?

  licenseEvents LicenseEvent[]
}

model LicenseEvent {
  id          Int              @id @default(autoincrement())
  businessId  Int
  business    Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  eventType   LicenseEventType
  note        String?          @db.Text
  amount      Decimal?         @db.Decimal(12, 2)
  actorUserId Int?             // null = system/webhook-triggered
  createdAt   DateTime         @default(now())

  @@index([businessId])
  @@map("license_events")
}
```

`Business.create()` explicitly passes `licenseStatus: 'PENDING'` — the schema-level `@default(ACTIVE)` exists purely so the migration doesn't lock everyone out of businesses that already exist and are already paid for in practice.

After editing `schema.prisma`: `npm run db:generate && npm run db:migrate` (stop the dev server first — on Windows, `prisma generate` holds a DLL lock while the dev server is running and the command fails with EPERM).

## Access enforcement — `server/controllers/businessController.js` + `server/middleware/auth.js`

Same three chokepoints that already gate business visibility, all get the same added rule: **non-SUPER_ADMIN users only ever see or use `ACTIVE` businesses.**

- `list()` ([businessController.js:8-25](../../../server/controllers/businessController.js#L8-L25)) — the non-admin branch's `userBusiness.findMany` result gets filtered to `licenseStatus === 'ACTIVE'` in addition to the existing `isActive` filter. The SUPER_ADMIN/ADMIN branch is split: SUPER_ADMIN keeps seeing every status (they need to find PENDING ones to act on); ADMIN's branch adds `where: { licenseStatus: 'ACTIVE' }` so a regular ADMIN no longer sees a business they just requested until it's activated.
- `get(id)` ([businessController.js:28-47](../../../server/controllers/businessController.js#L28-L47)) — after loading `biz`, if `req.user.role !== 'SUPER_ADMIN'` and `biz.licenseStatus !== 'ACTIVE'`, throw 403 (`"License not yet activated"` for PENDING, `"Business license suspended"` for SUSPENDED).
- `resolveBusiness` middleware ([auth.js:27-68](../../../server/middleware/auth.js#L27-L68)) — same check applied before `req.businessId` is set, for both the "no header" default-lookup path and the explicit `x-business-id` switch path, whenever `req.user.role !== 'SUPER_ADMIN'`.

`create()` changes: sets `licenseStatus: 'PENDING'`, `createdByUserId: req.user.id`; after the existing COA-clone and admin-grant steps, writes a `LicenseEvent(CREATED)` row and fires `sendLicensePendingNotice` (fire-and-forget) to every `SUPER_ADMIN` user.

## License transition endpoint (manual path)

```
PATCH /api/businesses/:id/license
Body: { status: 'ACTIVE' | 'SUSPENDED', note?: string }
```

Route: `authorize('SUPER_ADMIN')` — note this is SUPER_ADMIN-only, not ADMIN. The bypass in `authorize()` ([auth.js:70-78](../../../server/middleware/auth.js#L70-L78)) only short-circuits *for* a SUPER_ADMIN caller; an ADMIN caller still gets checked against the `roles` list and is rejected, so `authorize('SUPER_ADMIN')` correctly means "SUPER_ADMIN only."

Valid transitions only:
- `PENDING → ACTIVE` (event `ACTIVATED`)
- `SUSPENDED → ACTIVE` (event `REACTIVATED`)
- `ACTIVE → SUSPENDED` (event `SUSPENDED`)

Anything else (e.g. re-activating an already-`ACTIVE` business, or `PENDING → SUSPENDED`) → 400. On success: updates `licenseStatus`, `licenseActivatedAt = now()`, `licenseActivatedBy = req.user.id` (only on the two "activate" transitions), inserts the matching `LicenseEvent` (with `note`, `actorUserId: req.user.id`), and fires the matching email (`sendLicenseActivatedNotice` / `sendLicenseSuspendedNotice`) to `createdByUserId` + `business.email`.

## Payment link generation (online path)

```
POST /api/businesses/:id/license/payment-link
Body: { amount: number, description?: string }
```

Route: `authorize('ADMIN')` (SUPER_ADMIN passes via the bypass as usual). Only valid when the business is `PENDING` or `SUSPENDED`.

Calls PayMongo's Payment Links API directly with `fetch`/`axios` (no SDK dependency needed for one endpoint):

```
POST https://api.paymongo.com/v1/payment_links
Authorization: Basic base64(PAYMONGO_SECRET_KEY + ':')
Content-Type: application/json

{
  "amount": <amount * 100>,          // PayMongo wants centavos; min 100 (PHP 1.00)
  "currency": "PHP",
  "description": description || `Finara license — ${business.name}`,
  "metadata": { "businessId": String(business.id) }   // correlation key read back in the webhook
}
```

Response: `{ data: { id: "link_xxx", url: "https://pm.link/...", status: "active", ... } }`. Store `paymentLinkId = data.id`, `paymentLinkUrl = data.url`, `paymentLinkAmount = amount`, `paymentLinkGeneratedAt = now()` on the `Business`; insert `LicenseEvent(PAYMENT_LINK_GENERATED, amount, actorUserId: req.user.id)`. Return the link to the frontend for Copy / "Send via email" (reuses the business's own `email` field — no separate contact-email input needed).

If `PAYMONGO_SECRET_KEY` is unset, this endpoint returns 501 with a clear message ("Online payment not configured — use manual activation") and the frontend hides the "Generate Payment Link" button — same graceful-degradation pattern `mailer.js` already uses for SMTP ([mailer.js:1-12](../../../server/utils/mailer.js#L1-L12)).

## Webhook — `POST /api/webhooks/paymongo`

New route file `server/routes/webhooks.js`, mounted **before** the global `express.json()` parser in `server/index.js` with its own raw-body parser, since PayMongo's signature is computed over the raw request bytes:

```js
// server/index.js — mount ahead of app.use(express.json())
app.use('/api/webhooks/paymongo', express.raw({ type: 'application/json' }), routes.webhooks);
```

Handler (`server/controllers/webhookController.js`):
1. Read the `Paymongo-Signature` header, format `t=<timestamp>,te=<test sig>,li=<live sig>`. Compute `HMAC-SHA256(PAYMONGO_WEBHOOK_SECRET, "${t}.${rawBody}")` and timing-safe-compare against `te` (test mode) or `li` (live mode, whichever is non-empty) per PayMongo's documented scheme. Reject with 401 on mismatch, no DB writes.
2. `JSON.parse(rawBody)`, check `data.attributes.type` is `link.payment.paid` (or the generic `payment.paid` with `data.attributes.data.attributes.origin === 'links'`, as a fallback — PayMongo's own docs describe `link.payment.paid` as the dedicated event but the field-level payload example on record is the generic `payment.paid` shape). Ignore/200 on any other event type.
3. Read `businessId` from `data.attributes.data.attributes.metadata.businessId` (the metadata we set at link-creation time). Load the `Business`; if not found, or `licenseStatus` is already `ACTIVE`, or the loaded business's `paymentLinkId` doesn't match the state we generated last (defensive — ignore stale/duplicate events), respond 200 and do nothing further.
4. Otherwise: set `licenseStatus: 'ACTIVE'`, `licenseActivatedAt: now()`, `licenseActivatedBy: null` (system), insert `LicenseEvent(PAYMENT_RECEIVED, amount: <paid amount>/100, actorUserId: null)` then `LicenseEvent(ACTIVATED, actorUserId: null)`, fire `sendLicenseActivatedNotice`. Always respond 200 quickly (PayMongo retries on non-2xx).

New env vars in `.env.example`:
```
PAYMONGO_SECRET_KEY=
PAYMONGO_WEBHOOK_SECRET=
```

## Email notifications — `server/utils/mailer.js`

Three new functions, following the existing `wrap()` / `sendMail()` pattern already used by `sendInvoiceEmail` / `sendPayslipEmail` ([mailer.js:103-170](../../../server/utils/mailer.js#L103-L170)) — all best-effort (return `false` and log on failure, never throw, never block the license transition itself):

- `sendLicensePendingNotice(business, requester)` — to every `SUPER_ADMIN` user's email, subject `New business pending license — ${business.name}`.
- `sendLicenseActivatedNotice(business, requester)` — to `requester.email` (looked up via `createdByUserId`) and `business.email` (if set and different), subject `Your Finara license is active — ${business.name}`.
- `sendLicenseSuspendedNotice(business, requester)` — same recipients, subject `Your Finara license has been suspended — ${business.name}`.

## Routes — `server/routes/businesses.js`

```js
router.patch('/:id/license',              authorize('SUPER_ADMIN'), ctrl.updateLicense);
router.post('/:id/license/payment-link',  adminOnly,                ctrl.generatePaymentLink);
```

New file `server/routes/webhooks.js` (no `authenticate` — PayMongo calls this unauthenticated; the HMAC signature check inside the controller is the auth), registered in `server/routes/index.js` and mounted per the raw-body note above.

## `lib/api.js`

Added to the existing `businesses` export ([api.js:377-380](../../../lib/api.js#L377-L380)):

```js
updateLicense:      (id, data) => api.patch(`/businesses/${id}/license`, data),
generatePaymentLink:(id, data) => api.post(`/businesses/${id}/license/payment-link`, data),
```

## UI — `app/(dashboard)/settings/businesses/page.jsx`

- License badge per row: `badge-yellow` Pending / `badge-green` Active / `badge-red` Suspended.
- Row expands to a license panel showing:
  - Event history table (date, type, actor name or "System", note, amount) sourced from `LicenseEvent`, newest first.
  - **ADMIN+**: "Generate Payment Link" button (only shown/enabled when `licenseStatus !== 'ACTIVE'` and PayMongo is configured) → modal with Amount (PHP) + optional Description → on success shows the link with Copy and "Send to client email" actions.
  - **SUPER_ADMIN only**: "Activate License" (Pending/Suspended rows) / "Suspend" (Active rows) buttons → small modal with an optional note textarea → confirm → calls `updateLicense`.
- ADMIN sees a toast after creating a business: "Business created — pending license activation."
- No change needed to the business switcher component — it already calls `businesses.list()`, which is now pre-filtered by license status for non-SUPER_ADMIN.

## Testing

- `list()`/`get()`/`resolveBusiness`: a PENDING or SUSPENDED business is invisible/inaccessible to ADMIN and regular roles, visible and switchable for SUPER_ADMIN.
- `create()`: new business lands `PENDING`, `LicenseEvent(CREATED)` written, `sendLicensePendingNotice` invoked (mock `mailer.sendMail` — same mocking pattern as `tests/mailerInvoiceEmail.test.js`).
- `PATCH /license`: each valid transition succeeds and writes the right `LicenseEvent`; each invalid transition (re-activate an ACTIVE business, PENDING→SUSPENDED) returns 400; ADMIN (non-SUPER_ADMIN) calling this endpoint gets 403.
- `POST /license/payment-link`: happy path stores link fields + `LicenseEvent(PAYMENT_LINK_GENERATED)`; missing `PAYMONGO_SECRET_KEY` returns 501; called on an already-ACTIVE business returns 400.
- Webhook: valid signature + `link.payment.paid` + matching `metadata.businessId` → business flips to ACTIVE, two `LicenseEvent`s written, email fired. Invalid signature → 401, no DB writes. Valid signature but unknown/mismatched `businessId` → 200, no-op. Replayed/duplicate event on an already-ACTIVE business → 200, no-op (no duplicate `LicenseEvent`s).
- UI: manually verify via `/verify` skill — create a business as ADMIN, confirm it doesn't appear in the switcher; as SUPER_ADMIN, activate it manually and confirm it now appears for ADMIN; generate a payment link (PayMongo test-mode key) and confirm the stored link fields and event history render correctly.
