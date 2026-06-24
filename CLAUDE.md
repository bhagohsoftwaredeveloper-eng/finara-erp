# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Philippine-compliant ERP system (Finara). Modules: Chart of Accounts, General Ledger, Accounts Payable, Accounts Receivable, Payroll (SSS/PhilHealth/Pag-IBIG/BIR TRAIN Law), BIR Compliance, and Reports.

Stack: **Next.js 14 (App Router) + Express.js + MySQL 8 + Prisma ORM 5**

## Commands

### Backend (`cd backend`)
```bash
npm run dev          # Start with nodemon (port 5000)
npm start            # Production start
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Create & apply new migration (prisma migrate dev)
npm run db:seed      # Seed COA + sample data + admin user
npm run db:studio    # Open Prisma Studio
```

### Frontend (`cd frontend`)
```bash
npm run dev    # Next.js dev server (port 3000)
npm run build  # Production build
npm start      # Serve production build
```

### Environment files
- `backend/.env` — copy from `backend/.env.example`
- `frontend/.env.local` — copy from `frontend/.env.example`

MySQL path on this machine: `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`

## Architecture

### Backend (`backend/src/`)
- `index.js` — Express app wiring: Helmet, CORS, rate limiting, route mounting, error handler
- `routes/` — Thin routers; each file mounts to `/api/<module>`. All routes exported from `routes/index.js`
- `controllers/` — Business logic per module. Prisma queries live here
- `middleware/auth.js` — `authenticate` (JWT verify) and `authorize(...roles)` (RBAC). Roles: ADMIN, MANAGER, ACCOUNTANT, VIEWER
- `middleware/errorHandler.js` — Global Express error handler
- `config/database.js` — Prisma client singleton
- `utils/phCompliance.js` — SSS, PhilHealth, Pag-IBIG, TRAIN Law tax computation helpers
- `prisma/schema.prisma` — All models. After changes: `npm run db:generate && npm run db:migrate`
- `prisma/seed.js` — Seeds 52 PFRS-aligned accounts, admin user, sample vendor/customer/employee

### Frontend (`frontend/`)
- `app/(auth)/` — Login page (no layout wrapper)
- `app/(dashboard)/` — All authenticated pages; `layout.jsx` wraps with Sidebar + Header
- `lib/api.js` — All API calls via Axios. One named export per module (`auth`, `journal`, `accounts`, `payable`, `receivable`, `payroll`, `bir`, `settings`). Auto-refreshes JWT on 401
- `lib/auth.js` — Session helpers (`getToken`, `getUser`, `setSession`, `clearSession`), `formatCurrency`, `formatDate`
- `lib/print.js` — `printDocument(title, subtitle, bodyHTML)` — opens print window with company letterhead. Also exports `phpFmt()` and `dateFmt()` for formatting inside print HTML
- `components/layout/Sidebar.jsx` — Navigation defined in the `NAV` array. Add new routes here

### UI conventions
Pages follow a consistent pattern:
1. `page-header` div with `page-title` + `page-subtitle` + action buttons
2. Filter `card` with `card-body`
3. Data `card` with table or content

CSS utility classes to reuse: `card`, `card-body`, `btn-primary`, `btn-secondary`, `btn-danger`, `input`, `label`, `badge`, `badge-blue/green/red/yellow`, `page-header`, `page-title`, `page-subtitle`, `sidebar-link`, `sidebar-link-active`, `sidebar-link-inactive`

Icons: Lucide React (`lucide-react`). Charts: Recharts. Toasts: `react-hot-toast`.

### Adding a new module (pattern)
1. Add Prisma model → `npm run db:generate && npm run db:migrate`
2. Create `backend/src/controllers/<module>Controller.js`
3. Create `backend/src/routes/<module>.js` and register in `routes/index.js` + `index.js`
4. Add API helpers to `frontend/lib/api.js`
5. Create pages under `frontend/app/(dashboard)/<module>/`
6. Add nav entry to `NAV` array in `frontend/components/layout/Sidebar.jsx`

### Auth flow
- JWT stored in `localStorage` as `accessToken` / `refreshToken`
- Axios interceptor auto-refreshes on `401 TOKEN_EXPIRED`
- Backend: wrap routes with `authenticate` then optionally `authorize('ADMIN', 'MANAGER')`

### Print
Always use `printDocument` from `@/lib/print` — it fetches company settings and builds a branded A4 letterhead. Pass raw HTML as `bodyHTML`. Use `phpFmt()` and `dateFmt()` inside the HTML string (not React formatters).
