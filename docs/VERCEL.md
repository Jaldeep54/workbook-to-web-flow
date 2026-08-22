# Deploying to Vercel

Both projects are deployed and live:

| Vercel project | Directory | URL |
|---|---|---|
| `klinzo-ops` | `frontend` | <https://klinzo-ops.vercel.app> |
| `klinzo-ops-api` | `backend` | <https://klinzo-ops-api.vercel.app> |

The web app **rewrites `/api/*` to the API project**, so the browser only ever
talks to one origin. That matters more than it looks: the refresh token lives in
an `httpOnly` cookie, and a single origin keeps it a *first-party* cookie — no
third-party-cookie blocking (Safari today, Chrome tomorrow) can quietly break
sign-in a month after launch.

```
browser ──▶ https://klinzo-ops.vercel.app/…            static SPA
        └─▶ https://klinzo-ops.vercel.app/api/v1/…     rewritten ──▶ klinzo-ops-api ──▶ MongoDB Atlas
```

Data lives in MongoDB Atlas (`cluster0.9ywqnoh.mongodb.net`, database
`klinzo_ops`), seeded with the permission catalogue, three roles, the
administrator and the product catalogue.

## Redeploying

Neither project is linked to GitHub: the Vercel account's GitHub connection
covers the `sarvadhi-acutaas` namespace, not `Jaldeep54/workbook-to-web-flow`,
so pushing to the repository does **not** trigger a deploy. Deploys are uploads:

```sh
npm i -g vercel
vercel login

cd backend  && vercel --prod    # or: cd frontend && vercel --prod
```

To switch to deploy-on-push instead, connect the repository's GitHub account
under the Vercel project's Settings → Git, and set **Root Directory** to
`backend` / `frontend` respectively.

## Configuration that is not optional

Three settings look like boilerplate and are not. Each one cost a failed
deploy.

**`"framework": null`** — Vercel sees `express` in the dependency list and
auto-detects the project as an Express server, then fails the build looking for
a `server.js` entrypoint in the output directory. The project's framework is
pinned to null in the dashboard *and* in `vercel.json`; the dashboard setting is
the one that actually decides.

**`"installCommand": "npm install --include=dev"`** — `NODE_ENV=production` is
set as an environment variable (the app needs it for secure cookies), and npm
reads that variable and skips `devDependencies`. Without the flag, `tsc` is not
installed and the build dies with exit 127.

**The `/api` rewrite in `backend/vercel.json`** — Vercel matches a file-based
catch-all (`api/[...slug].js`) against a *single* path segment, so `/api/foo`
reaches the function but `/api/v1/health` returns a platform 404. Instead
[`backend/api/index.js`](../backend/api/index.js) is a plain function and
`vercel.json` rewrites `/api/:rest*` to it, passing the tail as a `rest` query
parameter that the handler turns back into the path Express expects.

## Environment variables

Set on `klinzo-ops-api`:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | the Atlas connection string, including `/klinzo_ops` |
| `MONGODB_MAX_POOL_SIZE` | `5` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | two different 48-byte random strings |
| `COOKIE_SECURE` | `true` |
| `FILE_STORAGE` | `gridfs` |
| `CORS_ORIGINS` | `https://klinzo-ops.vercel.app` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the seeded administrator |

`COOKIE_DOMAIN` is deliberately unset — with the rewrite in place the browser
attributes the cookie to the web app's own domain.

Set on `klinzo-ops`:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `/api/v1` |
| `VITE_GOOGLE_MAPS_API_KEY` | **not set** — see below |

`/api/v1` is deliberately relative: the SPA calls its own origin and the rewrite
does the rest. `VITE_` variables are baked in at build time, so changing one
needs a redeploy, not just a restart.

A connection string, both JWT secrets and the admin password reach Vercel as
plain environment variables. Rotating the two JWT secrets invalidates every
issued token, which is the point if one ever leaks.

## Re-seeding

The seed is idempotent and never resets an existing account's password:

```sh
cd backend
MONGODB_URI="<atlas-uri>" JWT_ACCESS_SECRET="…" JWT_REFRESH_SECRET="…" \
ADMIN_EMAIL="…" ADMIN_PASSWORD="…" npm run seed
```

On PowerShell, set them with `$env:MONGODB_URI = "…"` first, then `npm run seed`.

Nothing seeds or builds indexes on a cold start, deliberately — that work
belongs here, not to whichever request happens to wake a new instance.

## Open items and limits

**Change the administrator password.** It is currently the development default
from `.env.example`, on a database now reachable from the public internet. Sign
in and change it, or re-run the seed against a fresh account.

**Google Maps is not configured.** No `VITE_GOOGLE_MAPS_API_KEY` was set,
because none exists locally either. The shop location picker and "Shops on Map"
will not render until a key is created, restricted in Google Cloud Console to
`https://klinzo-ops.vercel.app` (HTTP referrers) and to the Maps JavaScript,
Places and Geocoding APIs, and added to the `klinzo-ops` project.

**Atlas network access is open to `0.0.0.0/0`.** Vercel functions have no fixed
IP, so this is the usual trade-off; the database user's password is the only
thing protecting it. Atlas's Vercel integration narrows this if you want it
narrowed.

**Shop photos live in MongoDB.** A serverless filesystem is read-only apart from
`/tmp`, which does not survive the request, so `FILE_STORAGE=gridfs` stores
photos in a GridFS bucket (`shop_images`) instead of under `UPLOAD_DIR`. Keys,
signed URLs and the API contract are identical either way. Two consequences:
photos count against the Atlas storage tier, and photos from a disk-backed
deployment are not migrated automatically — re-upload them, or copy them into
the bucket with `mongofiles`.

**Rate limiting is per instance.** `express-rate-limit` counts in memory, so the
effective limit across a scaled-out deployment is looser than `RATE_LIMIT_MAX`
suggests. Fine as abuse-dampening; not a quota. A shared store (Redis/Upstash)
is the fix if you ever need a real one.

**Function timeout.** `backend/vercel.json` asks for 30s, which the Hobby plan
caps at 10s. The workbook import is the only endpoint likely to notice.

**Cold starts.** The first request to an idle instance pays for a Mongo
connection (usually under a second). It is cached on the module afterwards.

## Deploying elsewhere

Nothing here is Vercel-specific beyond the two `vercel.json` files and
`backend/api/`. `src/server.ts` is still the real entry point — `npm run build
&& npm start` on any Node host works exactly as it did, and defaults to
`FILE_STORAGE=disk`. See [SETUP.md](SETUP.md#6-deployment).
