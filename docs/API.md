# API reference

Base URL: `http://localhost:4000/api/v1` (configurable via `API_PREFIX`).

## Conventions

**Every response uses the same envelope.**

```jsonc
// success
{ "success": true, "data": { /* ... */ } }

// success, list endpoints
{ "success": true, "data": [ /* ... */ ], "meta": {
    "page": 1, "limit": 50, "total": 132, "totalPages": 3,
    "hasNextPage": true, "hasPrevPage": false } }

// failure
{ "success": false, "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "delivery_date", "message": "Delivery date cannot be before the order date" }] } }
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | OK / created / no content |
| 400 `BAD_REQUEST` | Malformed request or a reference that doesn't exist |
| 401 `UNAUTHENTICATED` | Missing, invalid or expired access token |
| 403 `FORBIDDEN` | Authenticated, but the permission is missing |
| 404 `NOT_FOUND` | No such record or route |
| 409 `CONFLICT` | Duplicate key, or a record still in use |
| 422 `VALIDATION_ERROR` | Body/query failed validation (`details` lists fields) |
| 429 `RATE_LIMITED` | Too many requests |
| 500 `INTERNAL_ERROR` | Unexpected failure (details are logged, never returned) |

**Authentication** — send the access token on every request except
`/auth/login`, `/auth/refresh`, `/health` and signed file URLs:

```
Authorization: Bearer <accessToken>
```

**Authorization** — each endpoint below lists the permission it requires as
`resource:action`. Holding `<resource>:manage` or `*:manage` satisfies any
action on that resource. See [RBAC.md](RBAC.md).

**Dates** — calendar dates are `YYYY-MM-DD` strings; a month is always the
first of the month (`2026-08-01`).

**Pagination and sorting** — list endpoints accept `?page=&limit=&search=&sortBy=&sortOrder=`.
`sortBy` is whitelisted per endpoint; an unknown field returns 400.

---

## Authentication

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password }` → `{ accessToken, user }`, sets the refresh cookie |
| POST | `/auth/refresh` | refresh cookie | Rotates the refresh token, returns a new access token |
| POST | `/auth/logout` | public | Revokes the presented refresh token and clears the cookie |
| GET | `/auth/me` | any signed-in user | Current user, role and flat permission list |
| PATCH | `/auth/me` | any signed-in user | `{ fullName }` |
| GET | `/auth/permissions` | any signed-in user | The caller's permissions, with labels |
| POST | `/auth/change-password` | any signed-in user | `{ currentPassword, newPassword }`; ends all sessions |

```jsonc
// POST /auth/login → 200
{ "success": true, "data": {
  "accessToken": "eyJhbGciOi…",
  "user": {
    "id": "5f0c…", "email": "noobgaming2907@gmail.com", "fullName": "Klinzo Administrator",
    "isActive": true, "lastLoginAt": "2026-08-21T09:12:44.108Z",
    "role": { "id": "9b1e…", "name": "Admin", "slug": "admin", "isSystem": true },
    "permissions": ["*:manage", "cash_position:view", "…"] } } }
```

Password policy (set/reset only): at least 8 characters with an uppercase
letter, a lowercase letter and a number.

## Users

| Method | Path | Permission |
|---|---|---|
| GET | `/users` | `users:view` |
| POST | `/users` | `users:create` |
| GET | `/users/:id` | `users:view` (or yourself) |
| PATCH | `/users/:id` | `users:update` |
| POST | `/users/:id/password` | `users:manage` |
| DELETE | `/users/:id` | `users:delete` |

`POST /users` body: `{ email, password, fullName, role, directPermissions?, isActive? }`.
`PATCH` accepts any subset of `{ email, fullName, role, directPermissions, isActive }`.

The API refuses to delete or deactivate the last active administrator, or your
own account. Deactivating a user, resetting their password or changing their
own password revokes their sessions immediately.

## Roles and permissions

| Method | Path | Permission |
|---|---|---|
| GET | `/roles` | `roles:view` |
| POST | `/roles` | `roles:create` |
| GET | `/roles/:id` | `roles:view` |
| PATCH | `/roles/:id` | `roles:update` |
| PUT | `/roles/:id/permissions` | `roles:manage` |
| DELETE | `/roles/:id` | `roles:delete` |
| GET | `/permissions` | `permissions:view` |
| POST | `/permissions` | `permissions:create` |
| DELETE | `/permissions/:id` | `permissions:delete` |

`GET /permissions` returns both a flat list and a `groups` tree (group →
resource → actions) — the shape the admin UI's permission matrix renders.

The Admin role can't be renamed, deleted, or stripped of full access. A role
still assigned to users can't be deleted (409).

## Shops and areas

| Method | Path | Permission |
|---|---|---|
| GET | `/shops` | `shops:view` |
| GET | `/shops/next-code` | `shops:create` |
| GET | `/shops/products` | `shops:view` |
| GET | `/shops/handlers` | `shops:view` |
| POST | `/shops` | `shops:create` |
| GET | `/shops/:id` | `shops:view` |
| PATCH | `/shops/:id` | `shops:update` |
| POST | `/shops/:id/image` | `shops:update` |
| DELETE | `/shops/:id/image` | `shops:update` |
| POST | `/shops/:id/deactivate` | `shops:delete` |
| DELETE | `/shops/:id` | `shops:manage` |
| GET | `/shops/:id/analysis` | `shops:view` |
| GET | `/shops/:id/history` | `shops:view` |
| GET | `/shop-areas` | `shop_areas:view` |
| POST | `/shop-areas` | `shop_areas:create` |
| PATCH | `/shop-areas/:id` | `shop_areas:update` |
| DELETE | `/shop-areas/:id` | `shop_areas:delete` |

- `GET /shops` filters: `?search=&areaId=&isActive=`; sorts by `shop_name`,
  `code`, `created_at`, `joined_on`, `design_type`.
- Creating or updating a shop takes `product_ids` — the products it works with
  are saved with the shop.
- `area_id`, `shop_name` and a non-empty `product_ids` are required: every area
  filter, every shop label and everything orderable depends on them.
- `GET /shops/handlers` lists who a shop can be "Handled by" — the active users
  of every role with `handlesShops` (see [RBAC.md](RBAC.md)). It is guarded by
  `shops:view`, not `users:view`, so editing a shop doesn't require access to
  the user directory. Passing `handled_by_user_id` on create/update copies that
  user's name into `handled_by`, which is what every screen reads; the name
  therefore survives the account being deactivated or deleted.
- `POST /shops/:id/image` is `multipart/form-data` with an `image` field
  (JPG/PNG/HEIC/HEIF). Responses carry `image_url`, a short-lived signed link.
- `DELETE /shops/:id` only succeeds for a shop with no trading history;
  otherwise use `/deactivate`, which is what the UI's "Delete shop" does.
- `POST /shop-areas` is find-or-create, case- and whitespace-insensitive: it
  returns 200 with the existing area, or 201 with a new one.
- `GET /shop-areas` returns `shop_count` per area — how many shops sit in it.
- `DELETE /shop-areas/:id` refuses with 409 while shops are still in the area,
  rather than silently stripping it off them. Resolve it explicitly with one of:
  `?reassignTo=<areaId>` (move those shops to another area first) or
  `?force=true` (leave them with no area). An unused area deletes as-is. The
  response carries `shops_affected`.

## Catalogue

| Method | Path | Permission |
|---|---|---|
| GET | `/products` | `products:view` |
| POST | `/products` | `products:create` |
| PATCH | `/products/:id` | `products:update` |
| DELETE | `/products/:id` | `products:delete` |
| GET | `/label-products` | `label_products:view` |
| POST | `/label-products` | `label_products:create` |
| PATCH | `/label-products/:id` | `label_products:update` |
| DELETE | `/label-products/:id` | `label_products:delete` |

`label_cost_per_unit` is derived, never accepted from a client: it is the sum
of `sheet_cost ÷ labels_per_sheet` across a product's labels, recalculated
whenever a label is added, re-priced, reassigned or removed.

## Orders

| Method | Path | Permission |
|---|---|---|
| GET | `/orders` | `orders:view` |
| GET | `/orders/delivery-sheet?date=` | `orders:view` |
| GET | `/orders/due-dates?financialYear=` | `orders:view` |
| GET | `/orders/next-no?shopId=` | `orders:create` |
| POST | `/orders` | `orders:create` |
| GET | `/orders/:id` | `orders:view` |
| PUT | `/orders/:id` | `orders:update` |
| PATCH | `/orders/:id/status` | `orders:manage` |
| DELETE | `/orders/:id` | `orders:delete` |

Filters: `?month=&shopId=&areaId=&date=&status=&pending=true`
(`pending=true` means "no delivery recorded yet").

```jsonc
// POST /orders
{ "shop_id": "…", "order_date": "2026-08-05", "delivery_date": "2026-08-06",
  "notes": null,
  "order_lines": [{ "product_id": "…", "qty": 12 }] }
```

A shop takes at most one order per calendar day: a second `POST` for the same
`shop_id` and `order_date` answers 409, as does a `PUT` that moves an order onto
a day that shop already has one (an order never clashes with itself).

Order numbers are assigned per shop by the server. `PATCH /:id/status` with
`{"status":"Delivered"}` freezes the money figures onto a delivery and raises
its payment; moving away from Delivered removes them again, unless the payment
was already received (then the delivery is kept and its status follows the
order). Editing a delivered order re-runs the same sync.

## Deliveries

| Method | Path | Permission |
|---|---|---|
| GET | `/deliveries` | `deliveries:view` |
| POST | `/deliveries` | `deliveries:create` |
| GET | `/deliveries/:id` | `deliveries:view` |
| PATCH | `/deliveries/:id` | `deliveries:update` |
| DELETE | `/deliveries/:id` | `deliveries:delete` |

`POST` takes `{ order_id, delivery_date, status? }` — quantities and money
figures come from the order, so a delivery can never disagree with it.
Deleting one returns the order to Pending; it is refused (409) when the
payment has already been received.

## Payments

| Method | Path | Permission |
|---|---|---|
| GET | `/payments` | `payments:view` |
| GET | `/payments/:id` | `payments:view` |
| PATCH | `/payments/:id` | `payments:update` |

Payments are raised by the delivery flow — there is no create endpoint.
`PATCH` accepts `{ status?, collected_by?, collected_date?, amount? }`.

## Label orders and stock

| Method | Path | Permission |
|---|---|---|
| GET | `/label-orders` | `label_orders:view` |
| POST | `/label-orders` | `label_orders:create` |
| POST | `/label-orders/bulk` | `label_orders:create` |
| DELETE | `/label-orders/:id` | `label_orders:delete` |
| GET | `/labels/stock` | `label_stock:view` |
| GET | `/labels/stock-summary` | `label_stock:view` |
| GET | `/labels/suggestions?historyMonths=3` | `label_stock:view` |

```jsonc
// POST /label-orders/bulk — "place selected orders" from the suggestion screen
{ "order_date": "2026-08-07",
  "orders": [ { "shop_id": "…", "lines": [{ "label_product_id": "…", "sheets": 6 }] } ] }
// → 201 { "successes": [{ "shop_id": "…", "id": "…", "order_no": 4 }], "failures": [] }
```

Each shop in a bulk request is attempted independently, so one failure doesn't
discard the rest of the batch.

`/labels/suggestions` returns, per shop × label:
`current_stock`, `has_stock_data_issue`, `avg_monthly_usage`,
`one_month_target`, `two_month_target`, `additional_required`,
`suggested_sheets`, `expected_stock_after_order` and a `status` of
`urgent` | `recommended` | `monitor` | `no_order_required`.

## Costs and cash position

| Method | Path | Permission |
|---|---|---|
| GET | `/costs` | `costs:view` |
| POST | `/costs` | `costs:create` |
| PATCH | `/costs/:id` | `costs:update` |
| DELETE | `/costs/:id` | `costs:delete` |
| GET | `/cash-position/summary` | `cash_position:view` |
| GET | `/cash-position/investments` | `cash_position:view` |
| POST | `/cash-position/investments` | `cash_position:create` |
| DELETE | `/cash-position/investments/:id` | `cash_position:delete` |
| GET | `/cash-position/payouts` | `cash_position:view` |
| POST | `/cash-position/payouts` | `cash_position:create` |
| DELETE | `/cash-position/payouts/:id` | `cash_position:delete` |

`/cash-position/summary` returns all-time totals plus
`moneyInHand = investments + payments received − (variable costs + payouts)`.

## Dashboard and reports

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard/summary?month=&areaId=` | `dashboard:view` |
| GET | `/dashboard/available-months` | `dashboard:view` |
| GET | `/dashboard/order-qty-by-product` | `reports:view` |
| GET | `/dashboard/sku-opportunity` | `sku_opportunity:view` |
| GET | `/shops/:id/analysis?months=3` | `shops:view` |

`/dashboard/summary` returns order/delivery/payment/label totals for the month,
a 3-month sales trend, the product revenue mix and the top 5 shops. `areaId`
scopes everything except `variableCost`, which has no area dimension.

## Bills, import and files

| Method | Path | Permission |
|---|---|---|
| POST | `/bills` | `bills:create` |
| POST | `/import/workbook` | `imports:create` |
| GET | `/files/shop-images/:shopId/:filename?expires=&signature=` | signed URL |
| GET | `/health` | public |

`POST /bills` takes `{ orderIds: [...] }` and returns one payload per order —
invoice number (stable per order), line items, totals — in the order given. The
PDF is rendered by the frontend from that payload.

`POST /import/workbook` is `multipart/form-data` with a `workbook` field
(`.xlsx`/`.xlsm`/`.xls`) and returns counts plus warnings. Re-running updates
instead of duplicating.

Image URLs are signed with an expiry so an `<img>` tag can load them without an
Authorization header; tampering with either parameter returns 401.
