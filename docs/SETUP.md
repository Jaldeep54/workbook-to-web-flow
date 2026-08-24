# Setup

Everything needed to run Klinzo Operations locally and to deploy it.

## Requirements

- **Node.js 20+** (22 recommended) and npm 10+
- **MongoDB 6+** — a local `mongod`, Docker, or MongoDB Atlas

## 1. Database

Pick one:

**Local (Windows/macOS/Linux)** — install MongoDB Community Server, start it,
then use:

```
MONGODB_URI=mongodb://127.0.0.1:27017/klinzo_ops
```

**Docker**

```sh
docker run -d --name klinzo-mongo -p 27017:27017 -v klinzo-mongo:/data/db mongo:7
```

**Atlas** — create a free cluster, add a database user, allow your IP, then use
the connection string it gives you:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/klinzo_ops?retryWrites=true&w=majority
```

The database and its collections are created on first write. Indexes are built
at startup and by the seed — no manual DDL, and no migrations to apply for the
schema itself (`backend/src/migrations` holds the one-off Supabase import).

## 2. Backend

```sh
cd backend
cp .env.example .env
npm install
npm run seed     # permissions, roles, admin account, product catalogue
npm run dev
```

The API is at `http://localhost:4000/api/v1`; `GET /health` reports database
connectivity.

At minimum, set in `.env`:

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Connection string from step 1 |
| `JWT_ACCESS_SECRET` | 32+ random characters |
| `JWT_REFRESH_SECRET` | A *different* 32+ random string |
| `CORS_ORIGINS` | Where the frontend runs, e.g. `http://localhost:8080` |

Generate a secret:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The process refuses to start if a required variable is missing or a secret is
too short — a clear failure at boot beats a silent default in production.

## 3. Frontend

```sh
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:8080` and sign in as
`noobgaming2907@gmail.com` / `Dipak@123`.

Only `VITE_`-prefixed variables reach the browser bundle, and everything in the
frontend `.env` is public by design: the API base URL and an origin-restricted
Google Maps key. Database credentials and JWT secrets exist only in the backend
`.env`.

## 4. Seeding

`npm run seed` is idempotent — run it as often as you like:

- inserts or refreshes the **permission catalogue** (one row per module × action);
- creates the **Admin** role (always granted everything, including permissions
  added later) plus example **Marketing** and **Accounts** roles, which are
  ordinary editable roles;
- creates the **administrator account** from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
  if it doesn't exist, hashing the password with bcrypt. An existing account's
  password is never overwritten;
- seeds the **product and label catalogue** (the workbook's Inputs sheet)
  without overwriting rates you've edited.

`npm run seed:reset` clears users, roles, permissions and refresh tokens first.
It refuses to run when `NODE_ENV=production`.

## 5. Environment variable reference

### Backend

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `4000` | HTTP port |
| `API_PREFIX` | `/api/v1` | Path every route is mounted under |
| `LOG_LEVEL` | `info` | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `MONGODB_URI` | — | **Required.** Connection string |
| `MONGODB_DB_NAME` | — | Database name, when not in the URI |
| `MONGODB_MAX_POOL_SIZE` | `20` | Connections held per process — drop to ~5 on serverless |
| `JWT_ACCESS_SECRET` | — | **Required.** Signs access tokens |
| `JWT_REFRESH_SECRET` | — | **Required.** Signs/validates refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `CORS_ORIGINS` | `http://localhost:8080` | Comma-separated allowed origins |
| `COOKIE_DOMAIN` | — | Cookie domain in production |
| `COOKIE_SECURE` | follows `NODE_ENV` | Force secure cookies on/off |
| `FILE_STORAGE` | `disk` (`gridfs` on Vercel) | `disk` \| `gridfs` — where shop photos are stored |
| `UPLOAD_DIR` | `uploads` | Where shop photos are written (`disk` only) |
| `MAX_UPLOAD_BYTES` | `10485760` | Upload size limit (10 MB) |
| `FILE_URL_TTL_SECONDS` | `3600` | Lifetime of a signed image URL |
| `FILE_URL_SECRET` | access secret | Signs image URLs |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate-limit window |
| `RATE_LIMIT_MAX` | `1000` | Requests per window per IP |
| `AUTH_RATE_LIMIT_MAX` | `20` | Failed auth attempts per window per IP |
| `ADMIN_EMAIL` | `noobgaming2907@gmail.com` | Seeded administrator |
| `ADMIN_PASSWORD` | `Dipak@123` | Seeded administrator's password |
| `ADMIN_FULL_NAME` | `Klinzo Administrator` | Seeded administrator's name |
| `SUPABASE_URL` | — | Migration only |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Migration only |

### Frontend

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000/api/v1` | API base URL — absolute, or origin-relative (`/api/v1`) when the host proxies `/api` to the API |
| `VITE_GOOGLE_MAPS_API_KEY` | — | Maps JavaScript / Places / Geocoding |

## 6. Deployment

**Backend** — any Node host (Render, Railway, Fly, a VM, a container):

```sh
npm ci && npm run build && npm start
```

Checklist:

- `NODE_ENV=production`, fresh `JWT_*` secrets (not the development ones)
- `CORS_ORIGINS` set to the deployed frontend origin(s) — never `*`
- `COOKIE_SECURE=true` and HTTPS in front of the API, so the refresh cookie is
  only ever sent over TLS
- `FILE_STORAGE=disk` with `UPLOAD_DIR` on a persistent volume (or a mounted
  network share) if shop photos must survive redeploys — otherwise
  `FILE_STORAGE=gridfs`, which keeps them in MongoDB and needs no volume
- run `npm run seed` once against the production database

**Frontend** — `npm run build` produces a static `dist/` for Vercel, Netlify,
S3/CloudFront, nginx… Configure a SPA fallback (rewrite unknown paths to
`index.html`), and set `VITE_API_BASE_URL` at build time.

**Google Maps** — the shop location picker and "Shops on Map" use Maps
JavaScript, Places and Geocoding. Restrict the key in Google Cloud Console to
your domains (HTTP referrers) and to those three APIs.

Maps are optional. With no key (or a key Google rejects) both map views explain
what is wrong instead of sitting blank, and a shop's location can still be set
from the browser's own geolocation or by pasting `latitude, longitude` — the
format the Google Maps app copies — into the coordinate box under the map.

## 7. Deploying to Vercel

Two Vercel projects from this one repository — the API and the web app —
wired so the browser only ever talks to one origin. See
[docs/VERCEL.md](VERCEL.md) for the full walkthrough.
