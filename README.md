# Klinzo Operations

A web app that replaced a ~100-sheet Excel workbook used to run Klinzo's shop
orders, deliveries, payments, label stock and cost tracking.

The system is split into two independently deployable projects:

| | |
|---|---|
| [`backend/`](backend) | REST API — Node.js, Express, MongoDB (Mongoose), JWT auth, configurable RBAC. Owns every database operation and business rule. |
| [`frontend/`](frontend) | React SPA — Vite, TanStack Router/Query, Tailwind + shadcn/ui. Renders and talks to the API. No database driver, no server code. |

The frontend never touches the database. It holds no credentials beyond the API
base URL, and every rule it appears to enforce (who may see a page, who may
delete a record) is enforced again by the API on each request.

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — install, run, environment variables, deployment
- [docs/API.md](docs/API.md) — every endpoint, with request/response shapes
- [docs/RBAC.md](docs/RBAC.md) — how roles and permissions work, and how to extend them
- [docs/MIGRATION.md](docs/MIGRATION.md) — moving data from Supabase/Postgres to MongoDB
- [docs/TESTING.md](docs/TESTING.md) — the automated suite and how to test the API by hand
- [docs/legacy-supabase/](docs/legacy-supabase) — the retired Postgres schema, kept for reference

## Quick start

```sh
# 1. API
cd backend
cp .env.example .env          # set MONGODB_URI and the two JWT secrets
npm install
npm run seed                  # permissions, roles, admin account, product catalogue
npm run dev                   # http://localhost:4000/api/v1

# 2. Web app (second terminal)
cd frontend
cp .env.example .env          # VITE_API_BASE_URL=http://localhost:4000/api/v1
npm install
npm run dev                   # http://localhost:8080
```

Sign in with the seeded administrator:

```
Email:    noobgaming2907@gmail.com
Password: Dipak@123
```

The password is stored as a bcrypt hash — change it from **Your profile** after
the first sign-in. Re-running the seed never resets an existing password.

## Architecture

```
Browser ── REST (JSON + Bearer token) ──▶ Express API ──▶ MongoDB
   │                                          │
   │  access token in memory                  ├── authenticate  (JWT, per request)
   └─ refresh token in httpOnly cookie        ├── authorize     (resource:action)
                                              └── services      (business rules)
```

- **Authentication** — email + bcrypt password. A short-lived access token is
  returned in the response body and kept in memory; a long-lived refresh token
  is stored hashed and delivered in an httpOnly, SameSite cookie, rotated on
  every use.
- **Authorization** — every route declares the permission it needs. Permissions
  are rows in MongoDB, not constants in code, so new modules and roles are
  added without touching authorization logic. See [docs/RBAC.md](docs/RBAC.md).
- **Business rules** live in `backend/src/services`. Marking an order delivered
  freezes its money figures onto a delivery and raises a payment — one code
  path, used by the UI, the Excel importer and the API alike.

### Where the workbook's rules live now

| Rule | Implementation |
|---|---|
| Sales, labelling, packaging, production, fixed cost, profit | `services/order.service.ts` (`computeOrderTotals`) |
| Label cost per unit = Σ sheet cost ÷ labels per sheet | `services/catalogue.service.ts` |
| Label stock = labels received − labels used | `services/label-stock.service.ts` |
| Reorder suggestion (1-month / 2-month targets) | `services/label-stock.service.ts` |
| Monthly KPIs, whole business or per area | `services/dashboard.service.ts` |
| Shop vs. area performance | `services/shop-analysis.service.ts` |
| Money in hand | `services/cash-position.service.ts` |

## Stack

- **Backend** — Node.js 20+, Express 4, Mongoose 8, Zod, JWT, bcrypt, Helmet,
  Multer, SheetJS; Vitest + Supertest + mongodb-memory-server for tests.
- **Frontend** — React 19, TanStack Router + Query, Tailwind CSS v4,
  shadcn/ui, Recharts, react-pdf, Google Maps.

## Scripts

Backend (`cd backend`):

| Script | What it does |
|---|---|
| `npm run dev` | API with reload on change |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run seed` | Permissions, roles, admin account, catalogue (idempotent) |
| `npm run seed:reset` | Same, after clearing users/roles/permissions (never in production) |
| `npm run migrate` | Copy data from Supabase into MongoDB |
| `npm test` | Full API test suite |
| `npm run typecheck` | TypeScript, no emit |

Frontend (`cd frontend`):

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on :8080 |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` / `npm run format` | ESLint / Prettier |
