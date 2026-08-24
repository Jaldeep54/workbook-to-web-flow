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
 * Label stock is derived, not stored:
 *   stock = labels received − labels used by orders
 * These tests pin that formula, the low-stock flag, and the reorder
 * suggestion's thresholds — including the negative-stock guard.
 */
describe("Labels, stock and reorder suggestions", () => {
  let admin: Agent;
  let shopId: string;
  let dw200: { id: string };
  let dw200Label: { id: string; labels_per_sheet: number; low_stock_threshold: number };

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();

    const products = (await admin.get("/products")).body.data;
    dw200 = products.find((p: { key: string }) => p.key === "dw200");
    const labelProducts = (await admin.get("/label-products")).body.data;
    dw200Label = labelProducts.find((lp: { key: string }) => lp.key === "dw200");

    const areaId = (await admin.post("/shop-areas").send({ name: "Katargam" })).body.data.id;
    const shop = await admin.post("/shops").send({
      code: "L1",
      shop_name: "Label Test Shop",
      area_id: areaId,
      product_ids: [dw200.id],
    });
    shopId = shop.body.data.id;
  });

  afterAll(stopTestServer);

  it("records a label order and freezes the labels it produced", async () => {
    const response = await admin.post("/label-orders").send({
      shop_id: shopId,
      order_date: "2026-08-02",
      lines: [{ label_product_id: dw200Label.id, sheets: 10 }],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.order_no).toBe(1);
    expect(response.body.data.total_labels).toBe(10 * dw200Label.labels_per_sheet);
    expect(response.body.data.label_order_lines[0].products).toBe(
      10 * dw200Label.labels_per_sheet,
    );
  });

  it("derives stock as received minus used", async () => {
    const received = 10 * dw200Label.labels_per_sheet;

    const before = await admin.get("/labels/stock");
    const beforeRow = before.body.data.find(
      (r: { shop_id: string; label_product_id: string }) =>
        r.shop_id === shopId && r.label_product_id === dw200Label.id,
    );
    expect(beforeRow.stock).toBe(received);
    expect(beforeRow.shop_sells_product).toBe(true);

    await admin.post("/orders").send({
      shop_id: shopId,
      order_date: "2026-08-03",
      delivery_date: "2026-08-03",
      order_lines: [{ product_id: dw200.id, qty: 30 }],
    });

    const after = await admin.get("/labels/stock");
    const afterRow = after.body.data.find(
      (r: { shop_id: string; label_product_id: string }) =>
        r.shop_id === shopId && r.label_product_id === dw200Label.id,
    );
    expect(afterRow.stock).toBe(received - 30);
    expect(afterRow.is_low).toBe(received - 30 < dw200Label.low_stock_threshold);
  });

  it("summarises low stock per shop", async () => {
    const summary = await admin.get("/labels/stock-summary");
    const row = summary.body.data.find((r: { shop_id: string }) => r.shop_id === shopId);
    expect(row.has_label_order).toBe(true);
    expect(row.include_in_dashboard).toBe(row.low_stock_count > 0);
  });

  it("suggests a reorder from the threshold-based targets", async () => {
    const suggestions = await admin.get("/labels/suggestions?historyMonths=3");
    const row = suggestions.body.data.find(
      (r: { shop_id: string; label_product_id: string }) =>
        r.shop_id === shopId && r.label_product_id === dw200Label.id,
    );

    expect(row).toBeDefined();
    expect(row.avg_monthly_usage).toBeCloseTo(30 / 3, 2);
    expect(row.one_month_target).toBeCloseTo(row.low_stock_threshold + row.avg_monthly_usage, 2);
    expect(row.two_month_target).toBeCloseTo(row.low_stock_threshold + 2 * row.avg_monthly_usage, 2);

    const effective = Math.max(row.current_stock, 0);
    expect(row.additional_required).toBeCloseTo(Math.max(row.two_month_target - effective, 0), 2);
    expect(row.suggested_sheets).toBe(
      Math.ceil(row.additional_required / row.labels_per_sheet),
    );

    const expectedStatus =
      effective < row.low_stock_threshold
        ? "urgent"
        : effective < row.one_month_target
          ? "recommended"
          : effective < row.two_month_target
            ? "monitor"
            : "no_order_required";
    expect(row.status).toBe(expectedStatus);
  });

  it("treats negative stock as zero and flags it as a data issue", async () => {
    // Order far more than was ever printed — stock goes negative.
    await admin.post("/orders").send({
      shop_id: shopId,
      order_date: "2026-08-04",
      delivery_date: "2026-08-04",
      order_lines: [{ product_id: dw200.id, qty: 500 }],
    });

    const suggestions = await admin.get("/labels/suggestions");
    const row = suggestions.body.data.find(
      (r: { shop_id: string; label_product_id: string }) =>
        r.shop_id === shopId && r.label_product_id === dw200Label.id,
    );

    expect(row.current_stock).toBeLessThan(0);
    expect(row.has_stock_data_issue).toBe(true);
    expect(row.status).toBe("urgent");
    // Driven off max(stock, 0) — never "zero plus the shortfall".
    expect(row.additional_required).toBeCloseTo(row.two_month_target, 2);
  });

  it("places several suggested orders at once, reporting per shop", async () => {
    const secondArea = (await admin.post("/shop-areas").send({ name: "Piplod" })).body.data.id;
    const second = await admin.post("/shops").send({
      code: "L2",
      shop_name: "Second Label Shop",
      area_id: secondArea,
      product_ids: [dw200.id],
    });

    const response = await admin.post("/label-orders/bulk").send({
      order_date: "2026-08-07",
      orders: [
        { shop_id: shopId, lines: [{ label_product_id: dw200Label.id, sheets: 4 }] },
        { shop_id: second.body.data.id, lines: [{ label_product_id: dw200Label.id, sheets: 2 }] },
        { shop_id: "missing-shop", lines: [{ label_product_id: dw200Label.id, sheets: 1 }] },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.successes).toHaveLength(2);
    expect(response.body.data.failures).toHaveLength(1);
    expect(response.body.data.failures[0].shop_id).toBe("missing-shop");
  });

  it("recalculates a product's label cost when label rates change", async () => {
    const before = (await admin.get("/products")).body.data.find(
      (p: { key: string }) => p.key === "ll700",
    );
    const labels = (await admin.get("/label-products")).body.data.filter(
      (lp: { product_id: string }) => lp.product_id === before.id,
    );
    // Two label components (Front + Back) — the cost must be their sum.
    expect(labels).toHaveLength(2);
    expect(before.label_cost_per_unit).toBeCloseTo(
      labels.reduce(
        (sum: number, lp: { sheet_cost: number; labels_per_sheet: number }) =>
          sum + lp.sheet_cost / lp.labels_per_sheet,
        0,
      ),
      4,
    );

    await admin.patch(`/label-products/${labels[0].id}`).send({ sheet_cost: 44 });

    const after = (await admin.get("/products")).body.data.find(
      (p: { key: string }) => p.key === "ll700",
    );
    expect(after.label_cost_per_unit).toBeGreaterThan(before.label_cost_per_unit);
  });

  it("deletes a label order and returns the stock with it", async () => {
    const created = await admin.post("/label-orders").send({
      shop_id: shopId,
      order_date: "2026-08-08",
      lines: [{ label_product_id: dw200Label.id, sheets: 3 }],
    });

    const before = (await admin.get("/labels/stock")).body.data.find(
      (r: { shop_id: string; label_product_id: string }) =>
        r.shop_id === shopId && r.label_product_id === dw200Label.id,
    ).stock;

    expect((await admin.delete(`/label-orders/${created.body.data.id}`)).status).toBe(200);

    const after = (await admin.get("/labels/stock")).body.data.find(
      (r: { shop_id: string; label_product_id: string }) =>
        r.shop_id === shopId && r.label_product_id === dw200Label.id,
    ).stock;
    expect(after).toBe(before - 3 * dw200Label.labels_per_sheet);
  });

  it("validates label order payloads", async () => {
    expectError(
      await admin.post("/label-orders").send({ shop_id: shopId, order_date: "2026-08-02", lines: [] }),
      422,
    );
    expectError(
      await admin.post("/label-orders").send({
        shop_id: shopId,
        order_date: "2026-08-02",
        lines: [{ label_product_id: "nope", sheets: 5 }],
      }),
      400,
    );
    expectError(
      await admin.post("/label-orders").send({
        shop_id: "missing",
        order_date: "2026-08-02",
        lines: [{ label_product_id: dw200Label.id, sheets: 5 }],
      }),
      400,
    );
    expectError(await admin.delete("/label-orders/does-not-exist"), 404);
  });
});
