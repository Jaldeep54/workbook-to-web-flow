# Klinzo Operations

A web app that replaced a ~100-sheet Excel workbook used to run Klinzo's shop
orders, deliveries, payments, label stock, and cost tracking.

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, server-rendered) + [TanStack Router](https://tanstack.com/router)
- [TanStack Query](https://tanstack.com/query) for data fetching/caching
- [Supabase](https://supabase.com) (Postgres + Auth) — see `supabase/migrations/` for the schema
- [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) components
- Deployed on [Vercel](https://vercel.com)

## Development

Requires Node.js.

```sh
npm install
cp .env.example .env   # fill in your Supabase project's values
npm run dev
```

Other scripts: `npm run build` (production build), `npm run lint`, `npm run format`.

## Database

Schema changes live as SQL files in `supabase/migrations/`, applied in filename
order through the Supabase SQL Editor (or the Supabase CLI once linked to a
project).

## Environment variables

See `.env.example` for the full list. `VITE_`-prefixed variables are exposed to
the browser bundle; `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never
be exposed to the client.
