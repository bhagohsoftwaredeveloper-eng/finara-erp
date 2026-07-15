---
name: verify
description: Build/launch/drive recipe for verifying changes in the Finara ERP app (Next.js :3000 + Express :5000)
---

# Verifying changes in this repo

## Launch

- `npm run dev` starts both servers via concurrently (API :5000, web :3000). Browser talks to :3000 only; Next.js rewrites `/api/*` to :5000.
- Check if already running first: `Get-NetTCPConnection -LocalPort 3000,5000 -State Listen`.
- Wait for readiness by curling `http://localhost:3000` until non-000.

## Auth handle (no login needed)

The local admin password is NOT the seed default, so don't try to log in. Mint a JWT directly:

```bash
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
console.log(jwt.sign({ id: 1, email: 'admin@ph-erp.com', role: 'ADMIN', name: 'Verify Bot' }, process.env.JWT_SECRET, { expiresIn: '1h' }));
"
```

- API calls: `Authorization: Bearer <token>`.
- UI session: on `http://localhost:3000/login`, set localStorage `accessToken`, `refreshToken`, and `user` (JSON `{id, email, role, firstName, lastName}`), then navigate. The refresh token won't survive a real refresh (it's signed with JWT_SECRET, not JWT_REFRESH_SECRET) — if the app bounces you to /login mid-session, just re-set localStorage.

## Gotchas

- **Stale Prisma client**: after pulling schema changes, `prisma generate` must run, but it EPERM-fails while the dev server holds the query-engine DLL. Stop the dev tree first (find PIDs on :3000/:5000, walk up to the `concurrently` node process, `taskkill /PID <root> /T /F`), then `npx prisma generate`, then restart `npm run dev`. Symptom of staleness: `/api/<newmodel>` returns 500 because `prisma.<model>` is undefined.
- **Viewport**: the dashboard switches to mobile layout below 1024px and a menu backdrop (`fixed inset-0 z-40`) intercepts clicks. Resize Playwright to 1440x900 before driving.
- Playwright MCP output (screenshots/snapshots) lands in `D:\Accounting System ERP\.playwright-mcp\`.
- The `Lead` table has no `@@map` — its MySQL table is `lead`/`Lead`, unlike the rest of the schema (snake_case maps).
