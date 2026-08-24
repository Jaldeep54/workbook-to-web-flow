# Roles and permissions

## The model

Three collections, and nothing hard-coded:

```
permissions            roles                      users
─────────────          ─────────────              ─────────────
resource   "orders"    name        "Marketing"    email
action     "create"    slug        "marketing"    role  ───────▶ roles._id
name       "orders:create"                        directPermissions[] ─┐
label      "Orders"    permissions[] ─────────────────────────────────┴──▶ permissions._id
group      "Operations"
```

- A **permission** is a `(resource, action)` pair — a *page or module* plus one
  of `view`, `create`, `update`, `delete`, `manage`.
- A **role** is a named bundle of permission ids. Roles are created and edited
  at runtime by an administrator.
- A **user** has exactly one role, plus optional `directPermissions` granted to
  them individually.

A user's effective permissions are `role.permissions ∪ user.directPermissions`.

## How a check is evaluated

A request for `(resource, action)` is allowed when the user's set contains any
of:

1. `*:manage` — the superuser grant the Admin role holds. It covers permissions
   added in future releases too, so a new module never locks administrators out.
2. `<resource>:manage` — full control of one module implies every action on it.
3. `<resource>:<action>` — the exact grant.

`backend/src/services/rbac.service.ts` implements this; the frontend's
`usePermissions()` mirrors it exactly for showing and hiding UI.

## Where it is enforced

Every route declares its permission:

```ts
orderRouter.post("/", authorize(RESOURCES.orders, "create"), …);
orderRouter.patch("/:id/status", authorize(RESOURCES.orders, "manage"), …);
```

`authenticate` re-reads the user on **every** request, so a role change, a new
permission or a deactivated account takes effect immediately — there is no
waiting for a token to expire.

The frontend hides what a user can't do (navigation entries, buttons, whole
pages via `<RequirePermission>`), but that is only a convenience. Calling the
endpoint directly with a valid token and the wrong role returns:

```jsonc
{ "success": false, "error": {
  "code": "FORBIDDEN",
  "message": "Missing permission \"users:create\" for this action" } }
```

## The permission catalogue

Seeded from `backend/src/config/permissions.ts`.

| Group | Resource | Actions |
|---|---|---|
| Operations | `dashboard` | view |
| Operations | `shops` | view, create, update, delete, manage |
| Operations | `shop_areas` | view, create, update, delete |
| Operations | `orders` | view, create, update, delete, manage |
| Operations | `deliveries` | view, create, update, delete |
| Operations | `payments` | view, update |
| Operations | `bills` | view, create |
| Labels | `label_orders` | view, create, update, delete |
| Labels | `label_stock` | view |
| Finance | `costs` | view, create, update, delete |
| Finance | `cash_position` | view, create, update, delete |
| Insights | `reports` | view |
| Insights | `sku_opportunity` | view |
| Settings | `products` | view, create, update, delete |
| Settings | `label_products` | view, create, update, delete |
| Administration | `imports` | create |
| Administration | `users` | view, create, update, delete, manage |
| Administration | `roles` | view, create, update, delete, manage |
| Administration | `permissions` | view, create, delete |
| Administration | `*` | manage (full access) |

Notes on two deliberate choices:

- `orders:manage` guards **status changes**, because marking an order delivered
  cascades into deliveries and payments — a heavier action than editing a row.
- `users:manage` guards **password resets**, separately from `users:update`.

## Seeded roles

| Role | Intent |
|---|---|
| **Admin** | Everything, including user/role/permission management. System role: it can't be renamed, deleted or stripped of full access. |
| **Marketing** | Shops and orders (view/create/update), dashboard, reports, SKU opportunity, read-only catalogue. No payments, finance or administration. |
| **Accounts** | Payments, costs, cash position and bills; read-only elsewhere. |
| **Salesman** | Field sales: shops and orders (view/create/update), dashboard, read-only catalogue. Flagged **handles shops** (below). |

Marketing, Accounts and Salesman are ordinary roles — rename, re-scope or
delete them. Only Admin is protected.

## Roles that handle shops

A role carries one flag beyond its permissions: `handlesShops`, toggled with
**Members handle shops** on Admin → Roles & permissions. The active users of
every flagged role are exactly the people a shop can be **Handled by**, served
by `GET /shops/handlers`.

It is a role flag rather than a hardcoded `salesman` slug so sales teams can be
renamed, split or added without a code change — the same reason roles
themselves are data.

**Retiring a salesman** is therefore deactivating their user account: they
disappear from the picker at once, and no new shop can be assigned to them. The
shops they already handled are untouched — a shop stores the handler's *name*
alongside the account id, so history keeps reading correctly after the account
is deactivated or deleted. Such a shop shows its stored name in the picker
marked "no active account" until someone reassigns it.

## Worked example

> Role **Marketing**: Dashboard → View, Shops → View/Create/Update, Reports →
> View, User Management → no access, Settings → no access.

Create it in **Roles & permissions**, tick those boxes, then assign a user to
it in **Users**. The result:

| Action | Result |
|---|---|
| Opens the Overview | Works |
| Opens Users from the menu | The menu entry isn't there |
| Types `/admin/users` into the address bar | "You don't have access to this page" |
| `GET /api/v1/users` with their token | `403 FORBIDDEN` |
| Creates a shop | Works |
| Deletes a shop (button hidden; endpoint called directly) | `403 FORBIDDEN` |

The last two rows are the point: `shops:create` and `shops:delete` are separate
permissions, and the server checks the one that matters for each request.

## Common tasks

**Give one user an extra permission.** Users → edit → *Extra permissions*. Use
this for exceptions instead of creating a role for a single person.

**Add a permission for a new module.**

1. Add an entry to `PERMISSION_CATALOGUE` in `backend/src/config/permissions.ts`.
2. Guard the new routes with `authorize("your_module", "view" | …)`.
3. Run `npm run seed` — the Admin role picks it up automatically, and it
   appears in the permission matrix for every other role.

You can also create one at runtime via `POST /permissions` (no deploy needed),
which is what makes the system extensible without code changes for pages that
are governed but not code-guarded.

**Guard a page in the UI.**

```tsx
component: () => (
  <RequirePermission resource={RESOURCES.reports}>
    <ReportsPage />
  </RequirePermission>
),
```

and, for an individual control:

```tsx
<Can resource={RESOURCES.orders} action="delete">
  <Button onClick={…}>Delete order</Button>
</Can>
```

## Safeguards

- The last active administrator can't be deleted, deactivated, or moved to a
  role without full access.
- You can't delete or deactivate your own account.
- The Admin role can't be renamed, deleted, or have full access removed.
- A role with users assigned can't be deleted.
- Seeded permissions can't be deleted; custom ones can, and are removed from
  every role and user that referenced them.
