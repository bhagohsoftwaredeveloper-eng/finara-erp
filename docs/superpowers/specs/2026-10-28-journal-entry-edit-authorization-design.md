# Journal Entries: View First, Edit With Authorization (Design)

Today, clicking an entry on Journal Entries opens it straight into an editable form ("Edit — JE-2-000178") with **Save Entry**. Three problems:

- **Posted entries can't be saved.** Nearly every entry is POSTED, and `PUT /journal/:id` refuses anything but DRAFT ("Only DRAFT entries can be edited").
- **The date shows blank.** The form receives `entryDate` as an ISO timestamp, which a date input can't display. Because the date is required, the form can't even be submitted.
- **No approval.** Nothing stops a casual edit of the books.

Locally, 185 of 196 entries were created automatically by other modules: invoices (INV), expense vouchers (EV), AR collections (PAR), cash requests (CR), bills (BILL), cash sales (CS), AP payments (PAP) and subscription orders (ORD). Only 11 were entered by hand.

Change: an existing entry opens **read-only**, with an **Edit** button. Editing a POSTED entry first needs an approval popup, in which an ADMIN or MANAGER of this company enters their email and password and gives a reason. On auto-posted entries, amounts stay locked so the GL keeps matching the source document.

## Data

`JournalEntry` gets `origin` (enum `JournalOrigin { MANUAL AUTO }`, default `MANUAL`):

- `glPost.post()` (the only path other modules use) sets `AUTO`.
- `journalController.create` (the Journal Entries form) leaves the default `MANUAL`.

The migration backfills existing rows. An entry is `MANUAL` if the audit log has its manual creation (`entity = 'JournalEntry'`, `action = 'CREATE'`, `entityId` = the entry id); otherwise it is `AUTO`:

```sql
ALTER TABLE `journal_entries` ADD COLUMN `origin` ENUM('MANUAL', 'AUTO') NOT NULL DEFAULT 'MANUAL';

UPDATE `journal_entries` je SET je.`origin` = 'AUTO'
WHERE NOT EXISTS (
  SELECT 1 FROM `audit_logs` a
  WHERE a.`entity` = 'JournalEntry' AND a.`action` = 'CREATE'
    AND a.`entityId` = CAST(je.`id` AS CHAR) COLLATE utf8mb4_unicode_ci
);
```

The audit log predates every journal entry (its oldest record is 2026-07-02; the oldest entry is 2026-07-13), so no manual entry is missed. If one ever were, it would only have its amounts locked, which is the safe side.

## The modal (`app/(dashboard)/journal/page.jsx`)

- **New entry:** unchanged; opens editable.
- **Existing entry:** opens read-only.
  - **Title:** the entry number and its status badge (no more "Edit —").
  - **Body:** every field is visibly disabled (`<fieldset disabled>`).
  - **Footer:** **Edit**, **Print** and **Close**. VOIDED entries get no Edit.
- **Edit on a DRAFT** unlocks the form immediately; drafts aren't in the books yet.
- **Edit on a POSTED entry** opens the **Authorize Edit** popup:
  - **Fields:** approver email, approver password, reason (all required).
  - **On approval:** the form unlocks under a banner: "Editing approved by <name> — <reason>".
  - **On rejection:** the popup shows the server's message and stays open.
- **AUTO entries in edit mode:**
  - **Can change:** date, reference, description, notes, each line's account and memo.
  - **Locked:** debit and credit inputs, **Add Line**, and line removal.
  - **Note shown:** "Amounts come from the source document. To change them, void and re-record the source."
- **Saving** sends the approval token. If the server says the approval expired, the popup reopens; the user's changes are kept.
- **Date bug:** fixed. The form takes `entryDate.slice(0, 10)`.
- **Local draft autosave** (`useDraftGuard`) stays for new entries and DRAFT entries only. POSTED entries are never autosaved locally, because an approval covers one editing session.

## Server

### `POST /api/journal/:id/authorize-edit`

Request body: `{ email, password, reason }`.

**Rate limit:** 10 requests per 15 minutes per IP, with the message "Too many approval attempts. Try again in 15 minutes."

1. The entry must belong to this company (404 otherwise) and be POSTED (400 "Only posted entries need edit approval").
2. `reason` is required (400).
3. **Approver checks** (403 if any fails):
   - **The account:** a user with that email exists, is active, and has role ADMIN, MANAGER or SUPER_ADMIN.
   - **The password** matches. bcrypt runs even when no user matches, so response time doesn't reveal whether an email exists.
   - **Company access:** `canAccessBusinessData(approver, businessId)`.
   - **One message for every failure:** "Those credentials can't approve edits for this company."
4. **Success:**
   - **Token:** returns `{ token, approverName, expiresAt }`. The token is a JWT valid for 15 minutes.
   - **Token contents:** entry, company, requesting user, approver and reason.
   - **Signing key:** derived from `JWT_SECRET` with audience `je-edit`, so it can never be used as an access token, and vice versa.
   - **Audit:** records `AUTHORIZE_EDIT` with the approver and reason.

### `PUT /api/journal/:id`

1. **Lookup:** by id **and** `businessId` (404 otherwise). VOIDED → 400 "Voided entries can't be edited".
2. **POSTED entries need `editToken`.** The server checks:
   - the signature and audience
   - that the token's entry, company and requesting user match this request
   - expiry: an expired token returns 403 with code `EDIT_APPROVAL_EXPIRED`; any other failure is a 403.
3. **Date:** `entryDate` is now saved, for drafts too. A POSTED entry's new date can't fall before the company's opening-balance cutover (400, message names the cutover date).
4. **AUTO entries** (any status):
   - The submitted lines must keep the same count and order.
   - Each line keeps its debit and credit to the cent.
   - Accounts, memos and cost tags may change.
   - A violation returns 400 "Amounts on auto-posted entries can't be changed."
5. **MANUAL entries:** full edit, still validated and balanced by the existing `validateLines`.
6. **Saving and audit:**
   - Lines are replaced and the entry updated in one transaction. A posted entry's new values count in reports immediately.
   - The audit records `UPDATE`, with the approver and reason when approved, and a before/after of every field that changed.

### Fixes in the same controller

- **Company scoping:** `update`, `post` and `void` look entries up by id **and** `businessId`. Today a user could change another company's entry by its id.
- **Void's admin check:** the password now only matches active ADMIN or SUPER_ADMIN users with access to **this** company. Today it accepts any ADMIN anywhere in the system. Locally every company has at least one such user. The void route gets the same rate limit as approval.

## Tests

- **Unit tests** cover:
  - the amount-lock comparison: same amounts with a changed account passes; a changed amount fails; an added or removed line fails; values match to the cent
  - edit tokens: round trip; another entry, company or user is rejected; expiry; an access-token secret can't verify an edit token
- **Controller tests** cover:
  - `authorize-edit`:
    - success
    - wrong password, wrong role, inactive user, or no access to this company all return the same 403
    - DRAFT or VOIDED returns 400
    - another company's entry returns 404
  - `update`:
    - posted entry without a token: 403
    - expired token: 403 with code `EDIT_APPROVAL_EXPIRED`
    - auto entry with changed amounts: 400
    - auto entry with a changed account: OK
    - manual entry, full edit: OK
    - date before the cutover: 400
    - another company's entry: 404
    - the audit carries the approver and reason
  - `post` and `void` are scoped to the company; void only accepts this company's admin-tier passwords
  - `glPost.post` creates entries with `origin: 'AUTO'`
- **Live check:** view mode, the popup, approved editing of a manual entry and of an auto entry (amounts locked), the blank-date fix. Only with the user's go-ahead on which entries may be changed.

## Out of scope

- Reversing-entry workflows. Corrections to amounts on auto-posted entries are still made by voiding and re-recording the source document.
- Changing who may void (still admin-tier) or the Void popup's design.
