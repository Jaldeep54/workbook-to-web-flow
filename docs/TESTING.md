# Testing

## Automated API suite

```sh
cd backend
npm test
```

The suite boots the **real Express app** against an in-memory MongoDB
(`mongodb-memory-server`), so requests travel through the same routing,
validation, authentication, authorization and Mongoose layers a deployed
instance uses. No database installation is needed; the first run downloads a
MongoDB binary.

| File | Covers |
|---|---|
| `tests/auth.test.ts` | Login, token refresh and rotation, replay detection, logout, password policy, session invalidation, deactivated accounts |
| `tests/rbac.test.ts` | Permission enforcement per action, direct grants, live permission changes, runtime-created permissions, admin safeguards |
| `tests/orders.test.ts` | Order lifecycle and the workbook's money formulas, delivery/payment sync, filters, pagination, invoice numbering, validation |
| `tests/labels.test.ts` | Label orders, derived stock, reorder suggestions, negative-stock guard, bulk placement, label-cost recalculation |
| `tests/reporting.test.ts` | Dashboard totals, area scoping, shop analysis, SKU opportunity, cash position |
| `tests/shops.test.ts` | Shop CRUD, area de-duplication, image upload and signed URLs, history, health and error handling |

Run one file, or watch:

```sh
npx vitest run tests/rbac.test.ts
npm run test:watch
```

### What the suite asserts, beyond status codes

- **Numbers.** Delivery sales, labelling, packaging and production costs are
  checked against the products' rates; the area average is checked against the
  per-shop-then-average methodology; money in hand against its formula.
- **Permission boundaries.** Each restricted role calls the endpoints it should
  not reach *directly* and must receive 403 — that is the requirement that
  hiding a button is not enough.
- **Edge cases.** Unknown ids (404), duplicates (409), bad payloads (422),
  malformed JSON (400), missing/expired/tampered tokens (401), sorting by a
  field that isn't whitelisted (400), and tampered image signatures (401).

## Testing the API by hand

Sign in and keep the token:

```sh
BASE=http://localhost:4000/api/v1

TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"noobgaming2907@gmail.com","password":"Dipak@123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

curl -s $BASE/auth/me -H "Authorization: Bearer $TOKEN"
```

Then exercise a flow:

```sh
# Catalogue and a shop
curl -s $BASE/products -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/shops -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"code":"1","shop_name":"Test Shop","product_ids":["<productId>"]}'

# Order → delivered (creates the delivery and its payment)
curl -s -X POST $BASE/orders -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"shop_id":"<shopId>","order_date":"2026-08-05","delivery_date":"2026-08-05",
       "order_lines":[{"product_id":"<productId>","qty":10}]}'

curl -s -X PATCH $BASE/orders/<orderId>/status -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"Delivered"}'

curl -s "$BASE/dashboard/summary?month=2026-08-01" -H "Authorization: Bearer $TOKEN"
```

### Verifying RBAC by hand

1. **Roles & permissions** → New role "Marketing Test" → tick Dashboard: View,
   Shops: View/Create.
2. **Users** → New user in that role.
3. Sign in as them: Payments, Cash Position and Administration are gone from
   the menu, and `/admin/users` shows the no-access screen.
4. With *their* token, call a restricted endpoint directly:

```sh
curl -i $BASE/users -H "Authorization: Bearer $MARKETING_TOKEN"
# HTTP/1.1 403 Forbidden
# {"success":false,"error":{"code":"FORBIDDEN","message":"Missing permission \"users:view\" …"}}
```

That last step is the one that matters: the UI is a convenience, the API is the
boundary.

## Frontend checks

```sh
cd frontend
npm run typecheck   # TypeScript across the app
npm run lint        # ESLint
npm run build       # typecheck + production build
```

## End-to-end smoke test

With both processes running and the seed applied:

1. Sign in as the administrator.
2. **Rates & settings** — confirm the six products and seven labels, and that
   "Label / unit" is the sum of a product's label components.
3. **Shops** — create a shop with an area, products and a photo.
4. **Orders** — record an order for it.
5. **Delivery sheet** — pick the delivery date, set the order to Delivered,
   then generate its bill.
6. **Deliveries / Payments** — the delivery carries the right figures and its
   payment was raised; mark it received.
7. **Labels & stock** — record a label order, watch stock and the suggestion
   status change.
8. **Costs** and **Cash position** — add a cost, an investment and a payout;
   check money in hand.
9. **Overview** — the month's totals reflect all of the above.
10. **Users / Roles** — create the restricted role from the section above and
    confirm both the hidden UI and the 403 from a direct call.
