import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  clearDomainCollections,
  createRoleWithUser,
  expectError,
  seedDatabase,
  signInAsAdmin,
  startTestServer,
  stopTestServer,
  type Agent,
} from "./helpers.js";

/**
 * Field Operations: a manager only sees the shops they work, "Make Payment"
 * settles pending deliveries oldest first, and change money only leaves cash
 * in hand once a manager marks it paid.
 */
describe("Field operations and team dashboards", () => {
  let admin: Agent;
  let manager: Agent;
  let managerId: string;
  let areaId: string;
  let ownShopId: string;
  let otherShopId: string;
  let productId: string;
  let price: number;

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();

    const created = await createRoleWithUser(admin, {
      roleName: "Field Manager",
      permissions: [
        "orders:view",
        "orders:create",
        "orders:manage",
        "shops:view",
        "field_operations:view",
        "field_operations:create",
      ],
      email: "field.manager@example.com",
    });
    manager = created.agent;
    managerId = created.userId;
    await admin.patch(`/roles/${created.roleId}`).send({ fieldRole: "manager" });

    const products = (await admin.get("/products")).body.data;
    productId = products[0].id;
    price = Number(products[0].selling_price);
    areaId = (await admin.post("/shop-areas").send({ name: "Vesu" })).body.data.id;

    const own = await admin.post("/shops").send({
      code: "FO1",
      shop_name: "Manager's Shop",
      area_id: areaId,
      handled_by_user_id: managerId,
      product_ids: [productId],
    });
    ownShopId = own.body.data.id;
    const other = await admin.post("/shops").send({
      code: "FO2",
      shop_name: "Someone Else's Shop",
      area_id: areaId,
      product_ids: [productId],
    });
    otherShopId = other.body.data.id;
  });

  afterAll(stopTestServer);

  async function deliveredOrder(shopId: string, date: string, qty: number) {
    const order = await manager.post("/orders").send({
      shop_id: shopId,
      order_date: date,
      delivery_date: date,
      order_lines: [{ product_id: productId, qty }],
    });
    expect(order.status).toBe(201);
    await manager.patch(`/orders/${order.body.data.id}/status`).send({ status: "Delivered" });
    return order.body.data.id as string;
  }

  it("scopes the shops list to the manager's own shops until access is given", async () => {
    let list = await manager.get("/field-ops/shops");
    expect(list.status).toBe(200);
    expect(list.body.data.scope).toBe("manager");
    expect(list.body.data.shops.map((s: { id: string }) => s.id)).toEqual([ownShopId]);

    expectError(await manager.get(`/field-ops/shops/${otherShopId}/pending`), 404);

    const grant = await admin.post(`/team/managers/${managerId}/shops`).send({ all: true });
    expect(grant.status).toBe(200);
    list = await manager.get("/field-ops/shops");
    expect(list.body.data.shops).toHaveLength(2);

    await admin.delete(`/team/managers/${managerId}/shops/${otherShopId}`).expect(200);
    list = await manager.get("/field-ops/shops");
    expect(list.body.data.shops).toHaveLength(1);
  });

  it("applies a collection to pending deliveries oldest first", async () => {
    // Created out of date order, to prove allocation follows delivery date.
    await deliveredOrder(ownShopId, "2026-09-03", 4);
    await deliveredOrder(ownShopId, "2026-09-01", 2);
    await deliveredOrder(ownShopId, "2026-09-02", 3);

    const pending = await manager.get(`/field-ops/shops/${ownShopId}/pending`);
    expect(pending.body.data.deliveries.map((d: { delivery_date: string }) => d.delivery_date)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(pending.body.data.total_pending).toBe(9 * price);

    expectError(
      await manager.post(`/field-ops/shops/${ownShopId}/collections`).send({ amount: 10 * price }),
      400,
    );

    // Pays the first two in full and half a unit's worth into the third.
    const amount = 5 * price + price / 2;
    const paid = await manager
      .post(`/field-ops/shops/${ownShopId}/collections`)
      .send({ amount, change_money: 20, collection_date: "2026-09-05" });
    expect(paid.status).toBe(201);
    expect(paid.body.data.collection.allocations).toHaveLength(3);
    expect(paid.body.data.total_pending).toBe(9 * price - amount);

    const after = await manager.get(`/field-ops/shops/${ownShopId}/pending`);
    expect(after.body.data.deliveries).toHaveLength(1);
    expect(after.body.data.deliveries[0].delivery_date).toBe("2026-09-03");
    expect(after.body.data.deliveries[0].balance).toBe(4 * price - price / 2);
  });

  it("lists the manager's activity with totals", async () => {
    const orders = await admin.get(`/team/managers/${managerId}/activity?type=orders&month=2026-09`);
    expect(orders.status).toBe(200);
    expect(orders.body.data.summary.count).toBe(3);
    expect(orders.body.data.summary.qty).toBe(9);

    const deliveries = await admin.get(`/team/managers/${managerId}/activity?type=deliveries&year=2026`);
    expect(deliveries.body.data.summary.count).toBe(3);
    expect(deliveries.body.data.summary.total).toBe(9 * price);

    const collections = await admin.get(`/team/managers/${managerId}/activity?type=collections`);
    expect(collections.body.data.summary.total).toBe(5 * price + price / 2);
  });

  it("takes change money out of cash in hand only once it is marked paid", async () => {
    const before = (await admin.get("/cash-position/summary")).body.data;
    expect(before.changeMoneyPaidTotal).toBe(0);

    const change = await admin.get(`/team/managers/${managerId}/activity?type=change_money`);
    expect(change.body.data.summary.unpaid).toBe(20);
    const collectionId = change.body.data.rows[0].id;

    await admin.patch(`/team/managers/change-money/${collectionId}`).send({ paid: true }).expect(200);
    const after = (await admin.get("/cash-position/summary")).body.data;
    expect(after.changeMoneyPaidTotal).toBe(20);
    expect(after.moneyInHand).toBe(before.moneyInHand - 20);
  });

  it("keeps team dashboards behind their own permission", async () => {
    expectError(await manager.get("/team/managers"), 403);
    const list = await admin.get("/team/managers");
    expect(list.body.data.map((m: { id: string }) => m.id)).toContain(managerId);
  });
});
