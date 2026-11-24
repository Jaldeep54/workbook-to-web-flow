import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  clearDomainCollections,
  expectError,
  seedDatabase,
  signInAsAdmin,
  startTestServer,
  stopTestServer,
  type Agent,
} from "./helpers.js";

describe("Direct sales", () => {
  let admin: Agent;
  let productId: string;

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();
    productId = (await admin.get("/products")).body.data[0].id;
  });

  afterAll(stopTestServer);

  it("filters by month, seller text and till-date, and includes received payments in cash", async () => {
    const updatedProduct = await admin
      .patch(`/products/${productId}`)
      .send({ direct_selling_price: 100 });
    expect(updatedProduct.body.data.direct_selling_price).toBe(100);
    expect(updatedProduct.body.data.selling_price).toBe(95);

    const sale = (
      sold_by: string,
      sold_date: string,
      selling_price: number,
      payment_amount: number,
    ) => ({
      product_id: productId,
      product_name: "Test product",
      sold_by,
      sold_date,
      quantity: 1,
      selling_price,
      production_cost: 50,
      label_cost: 5,
      jar_pouch_cost: 10,
      payment_amount,
      payment_status: "partial",
    });

    await admin
      .post("/direct-sales")
      .send(sale("Alice", "2026-08-03", 100, 60));
    await admin.post("/direct-sales").send(sale("Bob", "2026-08-22", 150, 100));
    await admin
      .post("/direct-sales")
      .send(sale("Alice", "2026-09-01", 200, 150));

    const august = await admin.get("/direct-sales?month=2026-08-01");
    expect(august.status).toBe(200);
    expect(august.body.data.rows).toHaveLength(2);
    expect(august.body.data.rows.map((row: { selling_price: number }) => row.selling_price)).toEqual([
      100, 100,
    ]);
    expect(august.body.data.summary).toEqual({
      totalSales: 200,
      totalProfit: 70,
    });

    const filtered = await admin.get(
      "/direct-sales?toDate=2026-08-31&soldBy=ali",
    );
    expect(filtered.status).toBe(200);
    expect(
      filtered.body.data.rows.map((row: { sold_by: string }) => row.sold_by),
    ).toEqual(["Alice"]);

    const cash = await admin.get("/cash-position/summary");
    expect(cash.body.data.directSalePaymentsTotal).toBe(310);
    expect(cash.body.data.moneyInHand).toBe(310);
  });

  it("uses the configured direct-selling rate even if the request submits another price", async () => {
    const updatedProduct = await admin
      .patch(`/products/${productId}`)
      .send({ direct_selling_price: 250 });
    expect(updatedProduct.body.data.direct_selling_price).toBe(250);

    const created = await admin.post("/direct-sales").send({
      product_id: productId,
      product_name: "Test product",
      sold_by: "Alice",
      sold_date: "2026-10-05",
      quantity: 2,
      selling_price: 1,
      production_cost: 80,
      label_cost: 8,
      jar_pouch_cost: 12,
      payment_amount: 0,
      payment_status: "unpaid",
    });

    expect(created.status).toBe(201);
    expect(created.body.data.selling_price).toBe(500);
    expect(created.body.data.profit).toBe(400);

    const updated = await admin.patch(`/direct-sales/${created.body.data.id}`).send({
      quantity: 3,
      selling_price: 1,
    });
    expect(updated.body.data.selling_price).toBe(750);
    expect(updated.body.data.profit).toBe(650);
  });

  it("rejects malformed or contradictory list filters", async () => {
    expectError(await admin.get("/direct-sales?month=2026-08"), 422);
    expectError(
      await admin.get("/direct-sales?month=2026-08-01&toDate=2026-08-31"),
      422,
    );
    expectError(
      await admin.get("/direct-sales?fromDate=2026-09-01&toDate=2026-08-31"),
      422,
    );
  });
});
