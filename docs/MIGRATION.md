# Migrating from Supabase to MongoDB

Two independent paths into the new database:

1. **`npm run migrate`** — copies an existing Supabase/Postgres dataset into
   MongoDB.
2. **Excel import** — if there is no Supabase data (or it was never populated),
   the original workbook can be imported from the app's **Excel import** page.

Both are re-runnable and neither creates duplicates.

## What maps to what

| Postgres table | MongoDB collection | Notes |
|---|---|---|
| `shop_areas` | `shop_areas` | Adds `name_key` (lowercased) for the case-insensitive unique index |
| `products` | `products` | |
| `label_products` | `label_products` | |
| `shops` | `shops` | |
| `shop_products` | `shop_products` | |
| `orders` + `order_lines` | `orders` | Lines become the embedded `order_lines` array |
| `deliveries` + `delivery_lines` | `deliveries` | Lines become `delivery_lines` |
| `payments` | `payments` | |
| `label_orders` + `label_order_lines` | `label_orders` | Lines become `label_order_lines` |
| `variable_costs` | `variable_costs` | |
| `investments`, `payouts` | `investments`, `payouts` | |
| `invoices` | `invoices` (+ `counters`) | The invoice sequence continues where Postgres' serial stopped |
| `profiles` + `user_roles` | `users` | Role mapped to the new Admin/Marketing roles |
| Views and RPCs | — | Recomputed on demand by `backend/src/services` |

Design decisions worth knowing:

- **IDs are preserved.** Every document keeps the UUID its Postgres row had, so
  every foreign key still resolves without a remapping table, and any bookmark
  or exported id in the old app still points at the same record.
- **Child tables are embedded.** Lines are only ever read and written with
  their parent, so they belong in the same document. Reports `$unwind` them.
- **Re-runnable.** Every write is an upsert keyed by that id: run it twice and
  the database is identical. A failed run can simply be repeated.
- **Errors are collected, not thrown.** A bad row is reported and the rest
  continues; the summary lists everything that failed.
- **Views and functions aren't migrated** — `label_stock_view`,
  `dashboard_summary()`, `shop_analysis()`, `label_order_suggestions()` and the
  rest are now MongoDB aggregations in the services layer, computing the same
  figures from the same source data.

## Running it

```sh
cd backend
# In .env (remove both again once the migration is done):
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service role key>

npm run migrate -- --dry-run   # reads and reports, writes nothing
npm run migrate                # seeds RBAC + catalogue, then copies the data
```

The service role key bypasses every Supabase security rule — keep it out of
version control and delete it from `.env` afterwards.

Output:

```
[INFO] Migration complete
  shop_areas         read      6  written 6
  products           read      6  written 6
  shops              read    118  written 118
  orders             read   2431  written 2431
  deliveries         read   2190  written 2190
  ...
[WARN] 3 migrated user(s) need a password set by an administrator:
[WARN]   - amisha@example.com
```

The migration runs the seed first, so the permission catalogue, the Admin role
and the administrator account exist before any user row references them.

## Users and passwords

Supabase Auth never exposes password hashes, so passwords cannot be migrated.
Each migrated profile becomes a user with a random, unusable password and is
listed at the end of the run. An administrator sets a password for each from
**Users → Reset password**; the person can change it afterwards from
**Your profile**.

Role mapping: `user_roles.role = 'admin'` → **Admin**, anything else →
**Marketing** (a safe, limited default). Adjust roles in the UI afterwards.

## Shop images

`shops.image_path` values are carried across unchanged, because the new file
storage uses the same `<shopId>/<timestamp>-<filename>` key shape as the
Supabase bucket. Copy the bucket's contents into the backend's `UPLOAD_DIR`
(default `backend/uploads/shop-images/`) and every existing photo resolves:

```sh
# example: after downloading the bucket locally
cp -r ./shop-images/* backend/uploads/shop-images/
```

Photos that aren't copied simply show the placeholder; nothing else breaks.

## Verifying

After the run:

```sh
# Row counts should match the Postgres source
mongosh klinzo_ops --eval 'db.getCollectionNames().forEach(c => print(c, db[c].countDocuments()))'
```

Then, in the app:

1. **Overview** for a month with known figures — sales, payments and profit
   should match the old dashboard exactly.
2. **Labels & stock** — stock is recomputed from received minus used, so it
   should match the old `label_stock_view`.
3. A **shop detail** page — orders, deliveries and payments all present.
4. **Cash position** — money in hand matches the old figure.

If a number disagrees, check `warnings`/`errors` in the migration output first;
re-running is always safe.

## Rollback

Nothing is written to Supabase, so rollback is simply "keep using the old app".
To start the MongoDB side over:

```sh
mongosh klinzo_ops --eval 'db.dropDatabase()'
cd backend && npm run seed && npm run migrate
```
