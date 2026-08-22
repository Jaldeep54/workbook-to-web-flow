# Deploying to Vercel

This repository holds two independently deployable projects, and Vercel deploys
them as two projects from the same Git repository, distinguished by their
**Root Directory**:

| Vercel project | Root Directory | What it serves |
|---|---|---|
| `klinzo-ops-api` | `backend` | The Express API, as one serverless function |
| `klinzo-ops` | `frontend` | The React SPA, as static files |

The web app then **rewrites `/api/*` to the API project**, so the browser sees a
single origin. That matters more than it looks: the refresh token lives in an
`httpOnly` cookie, and a single origin keeps it a *first-party* cookie — no
third-party-cookie blocking (Safari today, Chrome tomorrow) can quietly break
sign-in a month after launch.

```
browser ──▶ https://klinzo-ops.vercel.app/…            static SPA
        └─▶ https://klinzo-ops.vercel.app/api/v1/…     rewritten ──▶ API project ──▶ MongoDB Atlas
```

## Before you start

- **MongoDB Atlas.** Vercel functions run from a shifting pool of IPs, so under
  Network Access either allow `0.0.0.0/0` or enable Atlas's Vercel integration.
  A local `mongodb://127.0.0.1` URI is not reachable from Vercel.
- **Two fresh JWT secrets** — not the ones in your local `.env`:
  ```sh
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

## 1. Deploy the API

Create a Vercel project from this repository with **Root Directory =
`backend`**. [`backend/vercel.json`](../backend/vercel.json) supplies the rest:
`npm run build` compiles TypeScript to `dist/`, and
[`backend/api/[[...slug]].js`](../backend/api/%5B%5B...slug%5D%5D.js) hands every
`/api/*` request to the same Express app that `npm run dev` runs.

Set these environment variables (Production, and Preview if you use it):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your Atlas connection string |
| `MONGODB_MAX_POOL_SIZE` | `5` |
| `JWT_ACCESS_SECRET` | a fresh 48-byte random string |
| `JWT_REFRESH_SECRET` | a *different* fresh 48-byte random string |
| `CORS_ORIGINS` | the web app's URL, e.g. `https://klinzo-ops.vercel.app` |
| `COOKIE_SECURE` | `true` |
| `FILE_STORAGE` | `gridfs` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the administrator the seed should create |

Leave `COOKIE_DOMAIN` unset — with the rewrite in place the browser attributes
the cookie to the web app's own domain.

Deploy, then check `https://<api-project>.vercel.app/api/v1/health`. It should
report `{"status":"ok","database":"connected"}`.

## 2. Point the web app at it

Edit the first rewrite in [`frontend/vercel.json`](../frontend/vercel.json),
replacing the placeholder with the API project's URL:

```json
{ "source": "/api/:path*", "destination": "https://klinzo-ops-api.vercel.app/api/:path*" }
```

Commit that change — Vercel reads `vercel.json` from the repository, not from
the dashboard.

## 3. Deploy the web app

Create a second Vercel project from the same repository with **Root Directory =
`frontend`**, and set:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `/api/v1` |
| `VITE_GOOGLE_MAPS_API_KEY` | your Maps key |

`/api/v1` is deliberately relative: the SPA calls its own origin and the rewrite
does the rest. `VITE_` variables are baked in at build time, so changing one
needs a redeploy, not just a restart.

Add the deployed URL to the **Google Maps** key's HTTP-referrer restrictions, or
the map will refuse to load.

## 4. Seed the database, once

The seed creates the permission catalogue, the three roles, the administrator
and the product catalogue, and builds every index. Run it from your machine
against the production database:

```sh
cd backend
MONGODB_URI="<atlas-uri>" \
JWT_ACCESS_SECRET="<same as Vercel>" \
JWT_REFRESH_SECRET="<same as Vercel>" \
ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="<a real password>" \
npm run seed
```

On PowerShell, set them with `$env:MONGODB_URI = "…"` first, then `npm run seed`.

Re-running the seed is safe: it never resets an existing account's password.
Deliberately, nothing seeds or builds indexes on a cold start — that work
belongs here, not to whichever request happens to wake a new instance.

Then sign in at the web app's URL.

## Notes and limits

**Shop photos live in MongoDB.** A serverless filesystem is read-only apart from
`/tmp`, which does not survive the request, so `FILE_STORAGE=gridfs` stores
photos in a GridFS bucket (`shop_images`) instead of under `UPLOAD_DIR`. Keys,
signed URLs and the API contract are identical either way. Two consequences:
photos count against the Atlas storage tier, and photos already on a disk-backed
deployment are not migrated automatically — re-upload them, or copy them into
the bucket with `mongofiles`.

**Cold starts.** The first request to an idle instance pays for a Mongo
connection (usually under a second). Both are cached on the module afterwards.

**Rate limiting is per instance.** `express-rate-limit` counts in memory, so the
effective limit across a scaled-out deployment is looser than
`RATE_LIMIT_MAX` suggests. Fine as abuse-dampening; not a quota. A shared store
(Redis/Upstash) is the fix if you ever need a real one.

**Function timeout.** `backend/vercel.json` asks for 30s, which the Hobby plan
caps at 10s. The workbook import is the only endpoint likely to notice.

## Deploying elsewhere

Nothing here is Vercel-specific beyond the two `vercel.json` files and
`backend/api/`. `src/server.ts` is still the real entry point — `npm run build
&& npm start` on any Node host works exactly as it did, and defaults to
`FILE_STORAGE=disk`. See [SETUP.md](SETUP.md#6-deployment).
