import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRoleWithUser,
  expectError,
  seedDatabase,
  signIn,
  signInAsAdmin,
  startTestServer,
  stopTestServer,
  type Agent,
} from "./helpers.js";

/**
 * The security requirement in one suite: a user who lacks a permission must be
 * refused *by the API*, not merely by a hidden button. Every case below calls
 * the endpoint directly with a perfectly valid token.
 */
describe("Role-based access control", () => {
  let admin: Agent;
  let marketing: Agent;
  let marketingRoleId: string;
  let marketingUserId: string;

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    admin = await signInAsAdmin();

    // The worked example from the brief: Dashboard view, Marketing page
    // view/create/update, Reports view, nothing else.
    const created = await createRoleWithUser(admin, {
      roleName: "Marketing Test",
      email: "marketing.tester@klinzo.test",
      permissions: [
        "dashboard:view",
        "shops:view",
        "shops:create",
        "shops:update",
        "reports:view",
        "products:view",
      ],
    });
    marketing = created.agent;
    marketingRoleId = created.roleId;
    marketingUserId = created.userId;
  });

  afterAll(stopTestServer);

  it("grants exactly the permissions the role holds", async () => {
    const me = await marketing.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toEqual(
      expect.arrayContaining(["dashboard:view", "shops:view", "shops:create", "reports:view"]),
    );
    expect(me.body.data.permissions).not.toContain("*:manage");
    expect(me.body.data.permissions).not.toContain("users:view");
  });

  it("allows the actions the role has", async () => {
    expect((await marketing.get("/dashboard/summary?month=2026-08-01")).status).toBe(200);
    expect((await marketing.get("/shops")).status).toBe(200);
    expect((await marketing.get("/products")).status).toBe(200);
  });

  it("refuses reads the role does not have, even when called directly", async () => {
    expectError(await marketing.get("/users"), 403, "FORBIDDEN");
    expectError(await marketing.get("/roles"), 403, "FORBIDDEN");
    expectError(await marketing.get("/permissions"), 403, "FORBIDDEN");
    expectError(await marketing.get("/payments"), 403, "FORBIDDEN");
    expectError(await marketing.get("/cash-position/summary"), 403, "FORBIDDEN");
    expectError(await marketing.get("/costs"), 403, "FORBIDDEN");
  });

  it("refuses writes the role does not have", async () => {
    expectError(
      await marketing.post("/users").send({
        email: "sneaky@klinzo.test",
        password: "Sneaky@123",
        fullName: "Sneaky",
        role: marketingRoleId,
      }),
      403,
    );
    expectError(
      await marketing.post("/costs").send({ cost_date: "2026-08-01", cost_type: "Others", amount: 100 }),
      403,
    );
    expectError(await marketing.delete(`/users/${marketingUserId}`), 403);
  });

  it("distinguishes actions on the same resource — create is allowed, delete is not", async () => {
    const area = await admin.post("/shop-areas").send({ name: "RBAC Area" });
    const shop = await marketing.post("/shops").send({
      code: "RBAC-1",
      shop_name: "RBAC Shop",
      area_id: area.body.data.id,
      product_ids: [(await marketing.get("/products")).body.data[0].id],
    });
    expect(shop.status).toBe(201);

    // shops:create and shops:update were granted; shops:delete was not.
    expect(
      (await marketing.patch(`/shops/${shop.body.data.id}`).send({ mobile: "9876543210" })).status,
    ).toBe(200);
    expectError(await marketing.post(`/shops/${shop.body.data.id}/deactivate`), 403);
  });

  it("applies permission changes immediately, without a new sign-in", async () => {
    expectError(await marketing.get("/costs"), 403);

    const permissions = await admin.get("/permissions");
    const costsView = permissions.body.data.permissions.find(
      (p: { name: string }) => p.name === "costs:view",
    );
    const role = await admin.get(`/roles/${marketingRoleId}`);

    await admin
      .put(`/roles/${marketingRoleId}/permissions`)
      .send({ permissions: [...role.body.data.permissionIds, costsView.id] });

    // Same token, new permission — the middleware re-reads the user's grants.
    expect((await marketing.get("/costs")).status).toBe(200);
  });

  it("supports per-user grants on top of the role", async () => {
    const permissions = await admin.get("/permissions");
    const skuView = permissions.body.data.permissions.find(
      (p: { name: string }) => p.name === "sku_opportunity:view",
    );

    expectError(await marketing.get("/dashboard/sku-opportunity"), 403);
    await admin.patch(`/users/${marketingUserId}`).send({ directPermissions: [skuView.id] });
    expect((await marketing.get("/dashboard/sku-opportunity")).status).toBe(200);
  });

  it("creates a role with no permissions that can reach nothing", async () => {
    const { agent } = await createRoleWithUser(admin, {
      roleName: "No Access",
      email: "no.access@klinzo.test",
      permissions: [],
    });

    expect((await agent.get("/auth/me")).status).toBe(200); // still a valid session
    for (const path of ["/shops", "/orders", "/dashboard/summary?month=2026-08-01", "/users"]) {
      expectError(await agent.get(path), 403);
    }
  });

  it("lets an administrator build a role from the permission catalogue", async () => {
    const catalogue = await admin.get("/permissions");
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.data.groups.length).toBeGreaterThan(0);

    const editorPermissions = catalogue.body.data.permissions
      .filter((p: { name: string }) => ["orders:view", "orders:update"].includes(p.name))
      .map((p: { id: string }) => p.id);

    const role = await admin
      .post("/roles")
      .send({ name: "Editor", description: "Edits orders only", permissions: editorPermissions });
    expect(role.status).toBe(201);
    expect(role.body.data.permissions).toHaveLength(2);

    await admin.post("/users").send({
      email: "editor@klinzo.test",
      password: "Editor@123",
      fullName: "Editor User",
      role: role.body.data.id,
    });
    const editor = await signIn("editor@klinzo.test", "Editor@123");

    expect((await editor.get("/orders")).status).toBe(200);
    expectError(await editor.post("/orders").send({}), 403);
    expectError(await editor.get("/deliveries"), 403);
  });

  it("supports runtime-created permissions for new modules", async () => {
    const created = await admin.post("/permissions").send({
      resource: "marketing_page",
      action: "view",
      label: "Marketing Page",
      group: "Operations",
      description: "A module added after go-live",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe("marketing_page:view");

    // Duplicates are rejected rather than silently shadowing the original.
    expectError(
      await admin.post("/permissions").send({
        resource: "marketing_page",
        action: "view",
        label: "Marketing Page",
      }),
      409,
    );
  });

  it("protects the Admin role and the last administrator", async () => {
    const roles = await admin.get("/roles");
    const adminRole = roles.body.data.find((r: { slug: string }) => r.slug === "admin");

    expectError(await admin.delete(`/roles/${adminRole.id}`), 400);
    expectError(await admin.patch(`/roles/${adminRole.id}`).send({ name: "Superadmin" }), 400);
    expectError(await admin.patch(`/roles/${adminRole.id}`).send({ permissions: [] }), 400);

    // You can't delete or deactivate yourself out of the system either.
    const me = await admin.get("/auth/me");
    expectError(await admin.delete(`/users/${me.body.data.id}`), 400);
    expectError(await admin.patch(`/users/${me.body.data.id}`).send({ isActive: false }), 400);
  });

  it("refuses to delete a role that still has users", async () => {
    expectError(await admin.delete(`/roles/${marketingRoleId}`), 409);
  });

  it("rejects unknown roles and permissions when creating users", async () => {
    expectError(
      await admin.post("/users").send({
        email: "bad.role@klinzo.test",
        password: "Valid@123",
        fullName: "Bad Role",
        role: "does-not-exist",
      }),
      400,
    );
    expectError(
      await admin.post("/roles").send({ name: "Bad Permissions", permissions: ["nope"] }),
      400,
    );
  });
});
