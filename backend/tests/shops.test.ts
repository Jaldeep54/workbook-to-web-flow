import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  API,
  clearDomainCollections,
  expectError,
  seedDatabase,
  signInAsAdmin,
  startTestServer,
  stopTestServer,
  type Agent,
} from "./helpers.js";

describe("Shops, areas and files", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let admin: Agent;
  let productIds: string[];
  let areaId: string;

  beforeAll(async () => {
    server = await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();
    productIds = (await admin.get("/products")).body.data.map((p: { id: string }) => p.id);
    areaId = (await admin.post("/shop-areas").send({ name: "Varachha" })).body.data.id;
  });

  afterAll(stopTestServer);

  it("creates a shop with its product list and returns the next code", async () => {
    const nextCode = await admin.get("/shops/next-code");
    expect(nextCode.body.data.code).toBe("1");

    const created = await admin.post("/shops").send({
      code: nextCode.body.data.code,
      shop_name: "Krishna Provision",
      label_name: "Krishna",
      bill_name: "Krishna Provision Store",
      design_type: 2,
      area_id: areaId,
      mobile: "9876543210",
      address: "Ring Road, Surat",
      latitude: 21.1702,
      longitude: 72.8311,
      joined_on: "2026-01-15",
      product_ids: productIds.slice(0, 2),
    });

    expect(created.status).toBe(201);
    expect(created.body.data.shop_name).toBe("Krishna Provision");
    expect(created.body.data.product_ids).toHaveLength(2);

    const fetched = await admin.get(`/shops/${created.body.data.id}`);
    expect(fetched.body.data.bill_name).toBe("Krishna Provision Store");
    expect(fetched.body.data.product_ids).toHaveLength(2);

    // The next code advances with the shop count.
    expect((await admin.get("/shops/next-code")).body.data.code).toBe("2");
  });

  it("rejects duplicate shop codes and invalid coordinates", async () => {
    expectError(
      await admin.post("/shops").send({
        code: "1",
        shop_name: "Duplicate Code",
        area_id: areaId,
        product_ids: productIds.slice(0, 1),
      }),
      409,
    );
    expectError(
      await admin.post("/shops").send({
        code: "99",
        shop_name: "Bad Coordinates",
        area_id: areaId,
        latitude: 200,
        longitude: 0,
        product_ids: productIds.slice(0, 1),
      }),
      422,
    );
    expectError(
      await admin
        .post("/shops")
        .send({ code: "98", shop_name: "No Products", area_id: areaId, product_ids: [] }),
      422,
    );
    // Shop area is mandatory — every area filter in the app depends on it.
    expectError(
      await admin
        .post("/shops")
        .send({ code: "97", shop_name: "No Area", product_ids: productIds.slice(0, 1) }),
      422,
    );
  });

  it("updates a shop and re-syncs its product list", async () => {
    const shop = (await admin.get("/shops")).body.data[0];

    const updated = await admin
      .patch(`/shops/${shop.id}`)
      .send({ handled_by: "Amisha", product_ids: productIds });

    expect(updated.status).toBe(200);
    expect(updated.body.data.handled_by).toBe("Amisha");
    expect(updated.body.data.product_ids).toHaveLength(productIds.length);

    const links = await admin.get("/shops/products");
    expect(links.body.data.filter((l: { shop_id: string }) => l.shop_id === shop.id)).toHaveLength(
      productIds.length,
    );
  });

  it("offers users of shop-handling roles as a shop's handler", async () => {
    // "Handled by" is driven by a role flag rather than a hardcoded slug, so
    // an administrator can add or rename sales roles without a code change.
    const role = await admin
      .post("/roles")
      .send({ name: "Field Sales", handlesShops: true, permissions: [] });
    expect(role.status).toBe(201);
    expect(role.body.data.handlesShops).toBe(true);

    const salesman = await admin.post("/users").send({
      email: "field.sales@example.com",
      password: "Salesman@123",
      fullName: "Ravi Desai",
      role: role.body.data.id,
    });
    expect(salesman.status).toBe(201);

    const handlers = await admin.get("/shops/handlers");
    expect(handlers.status).toBe(200);
    expect(handlers.body.data).toContainEqual({
      id: salesman.body.data.id,
      full_name: "Ravi Desai",
      role_name: "Field Sales",
    });
    // Users of roles without the flag are not handlers.
    expect(
      handlers.body.data.some((h: { role_name: string }) => h.role_name === "Admin"),
    ).toBe(false);

    // Picking a handler copies their name onto the shop, so the shop still
    // reads correctly once that account is gone.
    const shop = (await admin.get("/shops?search=Krishna")).body.data[0];
    const assigned = await admin
      .patch(`/shops/${shop.id}`)
      .send({ handled_by_user_id: salesman.body.data.id });
    expect(assigned.body.data.handled_by).toBe("Ravi Desai");
    expect(assigned.body.data.handled_by_user_id).toBe(salesman.body.data.id);

    // Retiring the salesman drops them from the picker but leaves the shop's
    // record intact — this is how a salesman is removed from "Handled by".
    expect((await admin.patch(`/users/${salesman.body.data.id}`).send({ isActive: false })).status).toBe(200);
    expect((await admin.get("/shops/handlers")).body.data).toHaveLength(0);
    expect((await admin.get(`/shops/${shop.id}`)).body.data.handled_by).toBe("Ravi Desai");

    expectError(
      await admin.patch(`/shops/${shop.id}`).send({ handled_by_user_id: "no-such-user" }),
      400,
    );
  });

  it("searches, filters and sorts the shop list", async () => {
    const area = await admin.post("/shop-areas").send({ name: "Adajan" });
    await admin.post("/shops").send({
      code: "50",
      shop_name: "Zebra Mart",
      area_id: area.body.data.id,
      product_ids: productIds.slice(0, 1),
    });

    expect((await admin.get("/shops?search=Zebra")).body.data).toHaveLength(1);
    expect((await admin.get("/shops?search=nothing-matches")).body.data).toHaveLength(0);
    expect((await admin.get(`/shops?areaId=${area.body.data.id}`)).body.data).toHaveLength(1);

    const sorted = await admin.get("/shops?sortBy=shop_name&sortOrder=desc");
    expect(sorted.body.data[0].shop_name).toBe("Zebra Mart");
    expectError(await admin.get("/shops?sortBy=passwordHash"), 400);
  });

  it("deactivates a shop with history instead of deleting it", async () => {
    const shop = (await admin.get("/shops?search=Krishna")).body.data[0];
    await admin.post("/orders").send({
      shop_id: shop.id,
      order_date: "2026-08-01",
      delivery_date: "2026-08-01",
      order_lines: [{ product_id: productIds[0], qty: 1 }],
    });

    expectError(await admin.delete(`/shops/${shop.id}`), 409);

    const deactivated = await admin.post(`/shops/${shop.id}/deactivate`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.is_active).toBe(false);
    expect((await admin.get("/shops?isActive=false")).body.data.length).toBeGreaterThan(0);
  });

  it("finds or creates areas case-insensitively", async () => {
    const first = await admin.post("/shop-areas").send({ name: "Piplod" });
    expect(first.status).toBe(201);

    const again = await admin.post("/shop-areas").send({ name: "  piplod " });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);

    const areas = await admin.get("/shop-areas");
    expect(areas.body.data.filter((a: { name: string }) => /piplod/i.test(a.name))).toHaveLength(1);

    expectError(await admin.post("/shop-areas").send({ name: "   " }), 422);
    expectError(await admin.patch(`/shop-areas/${first.body.data.id}`).send({ name: "Adajan" }), 409);
  });

  it("reports how many shops each area holds", async () => {
    const area = await admin.post("/shop-areas").send({ name: "Counted Area" });
    const areaId = area.body.data.id;
    expect(area.body.data.shop_count).toBeUndefined();

    const listed = (await admin.get("/shop-areas")).body.data;
    expect(listed.find((a: { id: string }) => a.id === areaId).shop_count).toBe(0);

    await admin.post("/shops").send({
      code: "80",
      shop_name: "Counted Shop",
      area_id: areaId,
      product_ids: productIds.slice(0, 1),
    });

    const recounted = (await admin.get("/shop-areas")).body.data;
    expect(recounted.find((a: { id: string }) => a.id === areaId).shop_count).toBe(1);
  });

  it("refuses to delete an area while shops are still in it", async () => {
    const area = await admin.post("/shop-areas").send({ name: "Occupied Area" });
    const shop = await admin.post("/shops").send({
      code: "78",
      shop_name: "Occupied Shop",
      area_id: area.body.data.id,
      product_ids: productIds.slice(0, 1),
    });

    expectError(await admin.delete(`/shop-areas/${area.body.data.id}`), 409);
    // Refused means untouched: the shop keeps its area.
    expect((await admin.get(`/shops/${shop.body.data.id}`)).body.data.area_id).toBe(
      area.body.data.id,
    );
  });

  it("moves the shops to another area when one is named", async () => {
    const from = await admin.post("/shop-areas").send({ name: "Merge Source" });
    const to = await admin.post("/shop-areas").send({ name: "Merge Target" });
    const shop = await admin.post("/shops").send({
      code: "79",
      shop_name: "Merged Shop",
      area_id: from.body.data.id,
      product_ids: productIds.slice(0, 1),
    });

    // The area being deleted is not a valid destination for its own shops.
    expectError(
      await admin.delete(`/shop-areas/${from.body.data.id}?reassignTo=${from.body.data.id}`),
      400,
    );

    const deleted = await admin.delete(
      `/shop-areas/${from.body.data.id}?reassignTo=${to.body.data.id}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.shops_affected).toBe(1);
    expect((await admin.get(`/shops/${shop.body.data.id}`)).body.data.area_id).toBe(to.body.data.id);
  });

  it("unassigns the area from its shops when the delete is forced", async () => {
    const area = await admin.post("/shop-areas").send({ name: "Temporary Area" });
    const shop = await admin.post("/shops").send({
      code: "77",
      shop_name: "Area Test Shop",
      area_id: area.body.data.id,
      product_ids: productIds.slice(0, 1),
    });

    expect((await admin.delete(`/shop-areas/${area.body.data.id}?force=true`)).status).toBe(200);
    const after = await admin.get(`/shops/${shop.body.data.id}`);
    expect(after.body.data.area_id).toBeNull();
  });

  it("deletes an unused area with no ceremony", async () => {
    const area = await admin.post("/shop-areas").send({ name: "Unused Area" });
    expect((await admin.delete(`/shop-areas/${area.body.data.id}`)).status).toBe(200);
  });

  it("stores a shop image behind a signed URL", async () => {
    const shop = (await admin.get("/shops?search=Zebra")).body.data[0];
    // A 1x1 PNG is enough to prove the round trip.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    const uploaded = await request(server)
      .post(`${API}/shops/${shop.id}/image`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("image", png, { filename: "storefront.png", contentType: "image/png" });

    expect(uploaded.status).toBe(200);
    expect(uploaded.body.data.image_path).toContain(shop.id);
    const signedUrl = uploaded.body.data.image_url as string;
    expect(signedUrl).toContain("signature=");

    // The signed link works as-is (no bearer token — an <img> can't send one)...
    const fetched = await request(server).get(signedUrl);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");

    // ...but only with a valid signature.
    const tampered = signedUrl.replace(/signature=\w+/, "signature=deadbeef");
    expectError(await request(server).get(tampered), 401);
    expectError(await request(server).get(signedUrl.split("?")[0]), 401);

    expect((await admin.delete(`/shops/${shop.id}/image`)).status).toBe(200);
  });

  it("rejects a non-image upload", async () => {
    const shop = (await admin.get("/shops?search=Zebra")).body.data[0];
    const response = await request(server)
      .post(`${API}/shops/${shop.id}/image`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("image", Buffer.from("not an image"), {
        filename: "payload.exe",
        contentType: "application/octet-stream",
      });
    expectError(response, 400);
  });

  it("returns a shop's full trading history", async () => {
    const shop = (await admin.get("/shops?search=Krishna")).body.data[0];
    const history = await admin.get(`/shops/${shop.id}/history`);

    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.data.orders)).toBe(true);
    expect(Array.isArray(history.body.data.deliveries)).toBe(true);
    expect(Array.isArray(history.body.data.payments)).toBe(true);
    expect(history.body.data.orders.length).toBeGreaterThan(0);

    expectError(await admin.get("/shops/missing-shop/history"), 404);
  });

  it("handles unknown routes, malformed JSON and health checks", async () => {
    const health = await request(server).get(`${API}/health`);
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe("ok");
    expect(health.body.data.database).toBe("connected");

    // Unknown paths outside the API surface 404; unknown paths *inside* the
    // authenticated area answer 401 first, so an anonymous caller can't map
    // which endpoints exist.
    expectError(await request(server).get("/definitely-not-a-route"), 404, "NOT_FOUND");
    expectError(await request(server).get(`${API}/nope`), 401);
    expectError(await admin.get("/nope"), 404, "NOT_FOUND");

    const malformed = await request(server)
      .post(`${API}/auth/login`)
      .set("content-type", "application/json")
      .send('{"email": ');
    expectError(malformed, 400);
  });
});
