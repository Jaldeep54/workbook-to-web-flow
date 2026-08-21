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

  beforeAll(async () => {
    server = await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();
    productIds = (await admin.get("/products")).body.data.map((p: { id: string }) => p.id);
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
        product_ids: productIds.slice(0, 1),
      }),
      409,
    );
    expectError(
      await admin.post("/shops").send({
        code: "99",
        shop_name: "Bad Coordinates",
        latitude: 200,
        longitude: 0,
        product_ids: productIds.slice(0, 1),
      }),
      422,
    );
    expectError(
      await admin.post("/shops").send({ code: "98", shop_name: "No Products", product_ids: [] }),
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

  it("unassigns the area from its shops when the area is deleted", async () => {
    const area = await admin.post("/shop-areas").send({ name: "Temporary Area" });
    const shop = await admin.post("/shops").send({
      code: "77",
      shop_name: "Area Test Shop",
      area_id: area.body.data.id,
      product_ids: productIds.slice(0, 1),
    });

    expect((await admin.delete(`/shop-areas/${area.body.data.id}`)).status).toBe(200);
    const after = await admin.get(`/shops/${shop.body.data.id}`);
    expect(after.body.data.area_id).toBeNull();
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
