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

/**
 * Dashboards, shop analysis and cash position all aggregate in the database.
 * These tests build a small, fully known dataset and assert the totals — the
 * numbers, not just the status codes.
 */
describe("Dashboard, analysis and cash position", () => {
  let admin: Agent;
  let areaId: string;
  let shopA: string;
  let shopB: string;
  let product: { id: string; key: string; short_name: string; selling_price: number };

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();

    product = (await admin.get("/products")).body.data[0];
    areaId = (await admin.post("/shop-areas").send({ name: "Varachha" })).body.data.id;

    shopA = (
      await admin.post("/shops").send({
        code: "A1",
        shop_name: "Alpha Store",
        area_id: areaId,
        product_ids: [product.id],
      })
    ).body.data.id;

    shopB = (
      await admin.post("/shops").send({
        code: "B1",
        shop_name: "Beta Store",
        area_id: areaId,
        product_ids: [product.id],
      })
    ).body.data.id;

    // Alpha: 10 units delivered; Beta: 4 units delivered — both in Aug 2026.
    for (const [shopId, qty] of [
      [shopA, 10],
      [shopB, 4],
    ] as const) {
      const order = await admin.post("/orders").send({
        shop_id: shopId,
        order_date: "2026-08-10",
        delivery_date: "2026-08-12",
        order_lines: [{ product_id: product.id, qty }],
      });
      await admin
        .patch(`/orders/${order.body.data.id}/status`)
        .send({ status: "Delivered", delivery_date: "2026-08-12" });
    }

    await admin
      .post("/costs")
      .send({ cost_date: "2026-08-15", cost_type: "Transportation", amount: 500, note: "Van hire" });
  });

  afterAll(stopTestServer);

  it("totals the month across the whole business", async () => {
    const response = await admin.get("/dashboard/summary?month=2026-08-01");
    expect(response.status).toBe(200);

    const data = response.body.data;
    expect(data.orderCount).toBe(2);
    expect(data.orderQty).toBe(14);
    expect(data.deliveryCount).toBe(2);
    expect(data.totalSales).toBeCloseTo(14 * product.selling_price, 2);
    expect(data.orderByProduct[product.key]).toBe(14);
    expect(data.variableCost).toBe(500);
    expect(data.paymentsReceived).toBe(0);
    expect(data.paymentsPending).toBeCloseTo(14 * product.selling_price, 2);
    expect(data.monthlySales).toHaveLength(3);
    expect(data.monthlySales.at(-1)).toEqual({
      month: "2026-08-01",
      totalSales: expect.closeTo(14 * product.selling_price, 2),
    });
    expect(data.topShops[0].shopName).toBe("Alpha Store");
    expect(data.productMix[0].sharePct).toBe(100);
  });

  it("scopes the summary to one area but keeps variable cost business-wide", async () => {
    const other = (await admin.post("/shop-areas").send({ name: "Katargam" })).body.data.id;
    const scoped = await admin.get(`/dashboard/summary?month=2026-08-01&areaId=${other}`);

    expect(scoped.body.data.orderCount).toBe(0);
    expect(scoped.body.data.totalSales).toBe(0);
    // The cost register has no area dimension, so it stays whole-business.
    expect(scoped.body.data.variableCost).toBe(500);

    const inArea = await admin.get(`/dashboard/summary?month=2026-08-01&areaId=${areaId}`);
    expect(inArea.body.data.orderCount).toBe(2);
  });

  it("lists the months that actually have data", async () => {
    const months = await admin.get("/dashboard/available-months");
    expect(months.body.data).toContain("2026-08-01");
  });

  it("reports lifetime quantity per product and SKU opportunity", async () => {
    const qty = await admin.get("/dashboard/order-qty-by-product");
    const row = qty.body.data.find((r: { product_key: string }) => r.product_key === product.key);
    expect(row.total_qty).toBe(14);

    const sku = await admin.get("/dashboard/sku-opportunity");
    const alpha = sku.body.data.find((r: { shop_name: string }) => r.shop_name === "Alpha Store");
    expect(alpha.active_products).toContain(product.short_name);
    expect(alpha.inactive_products.length).toBeGreaterThan(0);
    expect(alpha.active_months).toBe(1);
    expect(alpha.avg_monthly_sales).toBeCloseTo(10 * product.selling_price, 2);
  });

  it("compares a shop against its area peers", async () => {
    const analysis = await admin.get(`/shops/${shopA}/analysis`);
    expect(analysis.status).toBe(200);

    const data = analysis.body.data;
    expect(data.shop.areaName).toBe("Varachha");
    expect(data.analysisPeriod.months).toBe(3);
    expect(data.productMix.shop[0].sharePct).toBe(100);
    expect(data.monthlySales.shop.average).toBeCloseTo(10 * product.selling_price, 2);
    expect(data.monthlySales.areaEligibleShopCount).toBe(2);
    // Area average is per-shop-then-averaged: (10 + 4) / 2 shops x price.
    expect(data.monthlySales.area.average).toBeCloseTo(7 * product.selling_price, 2);
  });

  it("reports insufficient area data for a shop alone in its area", async () => {
    const soloArea = (await admin.post("/shop-areas").send({ name: "Solo Area" })).body.data.id;
    const solo = await admin.post("/shops").send({
      code: "S1",
      shop_name: "Solo Store",
      area_id: soloArea,
      product_ids: [product.id],
    });

    const analysis = await admin.get(`/shops/${solo.body.data.id}/analysis`);
    expect(analysis.body.data.monthlySales.areaEligibleShopCount).toBe(1);
    expect(analysis.body.data.monthlySales.area).toBeNull();
  });

  it("computes money in hand from investments, payments, costs and payouts", async () => {
    await admin
      .post("/cash-position/investments")
      .send({ investment_date: "2026-08-01", amount: 10_000, done_by: "Bhavin" });
    await admin
      .post("/cash-position/investments")
      .send({ investment_date: "2026-08-02", amount: 5_000, done_by: "Jaldeep" });
    await admin
      .post("/cash-position/payouts")
      .send({ payout_date: "2026-08-03", amount: 2_000, done_by: "Bhavin" });

    const payments = await admin.get("/payments?month=2026-08-01");
    await admin.patch(`/payments/${payments.body.data[0].id}`).send({ status: "Received" });
    const received = payments.body.data[0].amount;

    const summary = await admin.get("/cash-position/summary");
    const data = summary.body.data;

    expect(data.investmentsTotal).toBe(15_000);
    expect(data.investmentsByBhavin).toBe(10_000);
    expect(data.investmentsByJaldeep).toBe(5_000);
    expect(data.payoutsTotal).toBe(2_000);
    expect(data.variableCostsTotal).toBe(500);
    expect(data.paymentsReceivedTotal).toBeCloseTo(received, 2);
    expect(data.moneyInHand).toBeCloseTo(15_000 + received - (500 + 2_000), 2);
  });

  it("validates reporting query parameters", async () => {
    expectError(await admin.get("/dashboard/summary"), 422);
    expectError(await admin.get("/dashboard/summary?month=2026-08"), 422);
    expectError(await admin.get("/dashboard/summary?month=2026-08-15"), 422); // must be the 1st
    expectError(await admin.get("/orders/due-dates?financialYear=20xx"), 422);
    expectError(await admin.get("/orders?sortBy=DROP+TABLE"), 400);
    expectError(await admin.get("/shops/does-not-exist/analysis"), 404);
  });

  it("manages costs, investments and payouts through their full lifecycle", async () => {
    const cost = await admin
      .post("/costs")
      .send({ cost_date: "2026-08-20", cost_type: "Others", amount: 250 });
    expect(cost.status).toBe(201);
    expect(cost.body.data.month).toBe("2026-08-01");

    const updated = await admin.patch(`/costs/${cost.body.data.id}`).send({ amount: 275 });
    expect(updated.body.data.amount).toBe(275);

    expect((await admin.delete(`/costs/${cost.body.data.id}`)).status).toBe(200);
    expectError(await admin.delete(`/costs/${cost.body.data.id}`), 404);

    expectError(
      await admin
        .post("/cash-position/investments")
        .send({ investment_date: "2026-08-01", amount: -5, done_by: "Bhavin" }),
      422,
    );
    expectError(
      await admin
        .post("/cash-position/investments")
        .send({ investment_date: "2026-08-01", amount: 5, done_by: "Someone Else" }),
      422,
    );
  });
});
