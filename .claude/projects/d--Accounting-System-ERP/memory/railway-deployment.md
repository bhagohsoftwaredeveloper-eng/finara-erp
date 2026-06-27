---
name: railway-deployment
description: How the Finara ERP backend deploys to Railway (project, DB wiring, deploy trigger)
metadata:
  type: project
---

The backend deploys to **Railway** — workspace `bhagohsoftwaredeveloper-eng's Projects`, project **Finara Accounting ERP** (`2493ba24-1215-4ca9-b4f2-bc5cbdcb1284`), `production` environment.

- **Services:** `finara-erp` (Express backend, root dir = `backend/`) + `MySQL` (db `ph_erp_db`, private host `mysql.railway.internal:3306`).
- **Deploy trigger:** GitHub auto-deploy. Pushing to `main` on `github.com/bhagohsoftwaredeveloper-eng/finara-erp` redeploys `finara-erp`.
- **DB wiring:** `finara-erp` reads `DATABASE_URL` (Prisma `schema.prisma`). It's set as a Railway reference var `${{MySQL.MYSQL_URL}}` → `mysql://root:***@mysql.railway.internal:3306/ph_erp_db`. Without it the service crash-loops.
- **Required env vars on `finara-erp` (all set):** `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (strong random, set via CLI), `NODE_ENV=production`, `JWT_EXPIRES_IN=8h`. STILL UNSET: `FRONTEND_URL` (CORS falls back to `http://localhost:3000` and blocks the hosted frontend until set). `authController.js` `jwt.sign` has NO fallback for `JWT_SECRET` — missing it = login 500s.
- **Production DB is migrated + seeded** (27 tables incl. `_prisma_migrations`; Prisma models map to snake_case tables, e.g. `User`→`users`). Seeded admins: `marinella@ph-erp.com` (ADMIN), `admin@ph-erp.com` (ADMIN), `manager@ph-erp.com` — passwords already changed from the `Admin@123` doc default.
- **Local mysql client path:** `C:\Program Files\MySQL\MySQL Server 9.4\bin\mysql.exe` (CLAUDE.md says 8.0 — outdated). Public DB proxy: `maglev.proxy.rlwy.net:43049`.
- **CLI auth:** uses a **project token** stored in the user env var `RAILWAY_TOKEN` (set via `setx`). Project tokens authorize status/logs/variables/up but CANNOT run `railway link` or persist `railway service` selection — pass `--service finara-erp` on each command.
- **Health check:** `GET /health` (not `/api/health`) → `{status:"ok"}`. Public URL `https://finara-erp-production.up.railway.app`.
- Stale unused `MYSQL*` vars exist on `finara-erp` (e.g. `MYSQLHOST=finara-erp.railway.internal`, self-referential) — harmless, code ignores them.
