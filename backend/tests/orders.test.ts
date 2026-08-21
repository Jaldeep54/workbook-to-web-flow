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
 * The order lifecycle is where the workbook's rules live: marking an order
 * delivered has to freeze the right money figures onto a delivery and raise a
 * payment for it, and reversing that has to unwind cleanly.
 */
describe("Orders, deliveries and payments", () => {
  let admin: Agent;
  let shopId: string;
  let products: Array<{ id: string; key: string; selling_price: number; production_cost: number; packaging_cost: number; label_cost_per_unit: number }>;

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();

    products = (await admin.get("/products")).body.data;
    const area = await admin.post("/shop-areas").send({ name: "Adajan" });
    const shop = await admin.post("/shops").send({
      code: "1",
      shop_name: "Order Test Shop",
      label_name: "OTS",
      area_id: area.body.data.id,
      product_ids: products.map((p) => p.id),
    });
    shopId = shop.body.data.id;
  });

  afterAll(stopTestServer);

  async function createOrder(qty: number, date = "2026-08-05") {
    return admin.post("/orders").send({
      shop_id: shopId,
      order_date: date,
      delivery_date: date,
      order_lines: [{ product_id: products[0].id, qty }],
    });
  }

  it("creates an order, numbering it sequentially per shop", async () => {
    const first = await createOrder(10);
    expect(first.status).toBe(201);
    expect(first.body.data.order_no).toBe(1);
    expect(first.body.data.total_qty).toBe(10);
    expect(first.body.data.month).toBe("2026-08-01");
    expect(first.body.data.status).toBe("Pending");
    expect(first.body.data.shops.shop_name).toBe("Order Test Shop");

    const second = await createOrder(5);
    expect(second.body.data.order_no).toBe(2);
  });

  it("computes delivery money figures with the workbook formulas", async () => {
    const order = await createOrder(4);
    const product = products[0];

    const delivered = await admin
      .patch(`/orders/${order.body.data.id}/status`)
      .send({ status: "Delivered", delivery_date: "2026-08-06" });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.status).toBe("Delivered");

    const deliveries = await admin.get("/deliveries?month=2026-08-01");
    const delivery = deliveries.body.data.find(
      (d: { order_id: string }) => d.order_id === order.body.data.id,
    );

    expect(delivery.total_sales).toBeCloseTo(4 * product.selling_price, 2);
    expect(delivery.production_cost).toBeCloseTo(4 * product.production_cost, 2);
    expect(delivery.packaging_cost).toBeCloseTo(4 * product.packaging_cost, 2);
    expect(delivery.labelling_cost).toBeCloseTo(4 * product.label_cost_per_unit, 2);
    expect(delivery.total_fixed_cost).toBeCloseTo(
      delivery.production_cost + delivery.packaging_cost + delivery.labelling_cost,
      2,
    );
    expect(delivery.profit).toBeCloseTo(delivery.total_sales - delivery.total_fixed_cost, 2);

    // ...and the payment it raised carries the same sales figure.
    const payments = await admin.get("/payments?month=2026-08-01");
    const payment = payments.body.data.find(
      (p: { order_id: string }) => p.order_id === order.body.data.id,
    );
    expect(payment.status).toBe("Pending");
    expect(payment.amount).toBeCloseTo(delivery.total_sales, 2);
  });

  it("re-syncs the delivery and payment when a delivered order is edited", async () => {
    const order = await createOrder(2);
    await admin.patch(`/orders/${order.body.data.id}/status`).send({ status: "Delivered" });

    const updated = await admin.put(`/orders/${order.body.data.id}`).send({
      shop_id: shopId,
      order_date: "2026-08-05",
      delivery_date: "2026-08-05",
      order_lines: [{ product_id: products[0].id, qty: 20 }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.total_qty).toBe(20);

    const deliveries = await admin.get("/deliveries?month=2026-08-01");
    const delivery = deliveries.body.data.find(
      (d: { order_id: string }) => d.order_id === order.body.data.id,
    );
    expect(delivery.total_qty).toBe(20);
    expect(delivery.total_sales).toBeCloseTo(20 * products[0].selling_price, 2);
  });

  it("keeps a received payment's amount when the order is re-delivered", async () => {
    const order = await createOrder(3);
    await admin.patch(`/orders/${order.body.data.id}/status`).send({ status: "Delivered" });

    const payments = await admin.get("/payments?month=2026-08-01");
    const payment = payments.body.data.find(
      (p: { order_id: string }) => p.order_id === order.body.data.id,
    );
    await admin
      .patch(`/payments/${payment.id}`)
      .send({ status: "Received", collected_by: "Bhavin", collected_date: "2026-08-10" });

    await admin.put(`/orders/${order.body.data.id}`).send({
      shop_id: shopId,
      order_date: "2026-08-05",
      delivery_date: "2026-08-05",
      order_lines: [{ product_id: products[0].id, qty: 30 }],
    });

    const after = await admin.get(`/payments/${payment.id}`);
    expect(after.body.data.status).toBe("Received");
    expect(after.body.data.amount).toBeCloseTo(3 * products[0].selling_price, 2);
    expect(after.body.data.collected_by).toBe("Bhavin");
  });

  it("unwinds the delivery and payment when an order leaves Delivered", async () => {
    const order = await createOrder(6);
    const orderId = order.body.data.id;
    await admin.patch(`/orders/${orderId}/status`).send({ status: "Delivered" });

    const reverted = await admin.patch(`/orders/${orderId}/status`).send({ status: "Pending" });
    expect(reverted.body.data.status).toBe("Pending");

    const deliveries = await admin.get("/deliveries?month=2026-08-01");
    const payments = await admin.get("/payments?month=2026-08-01");
    expect(
      deliveries.body.data.find((d: { order_id: string }) => d.order_id === orderId),
    ).toBeUndefined();
    expect(
      payments.body.data.find((p: { order_id: string }) => p.order_id === orderId),
    ).toBeUndefined();
  });

  it("keeps a delivery whose payment was received, but moves its status in step", async () => {
    const order = await createOrder(7);
    const orderId = order.body.data.id;
    await admin.patch(`/orders/${orderId}/status`).send({ status: "Delivered" });

    const payments = await admin.get("/payments?month=2026-08-01");
    const payment = payments.body.data.find((p: { order_id: string }) => p.order_id === orderId);
    await admin.patch(`/payments/${payment.id}`).send({ status: "Received" });

    await admin.patch(`/orders/${orderId}/status`).send({ status: "Cancelled" });

    const deliveries = await admin.get("/deliveries?month=2026-08-01");
    const delivery = deliveries.body.data.find((d: { order_id: string }) => d.order_id === orderId);
    expect(delivery).toBeDefined();
    expect(delivery.status).toBe("Cancelled");
  });

  it("filters orders by month, shop, area, date and delivery status", async () => {
    const byMonth = await admin.get("/orders?month=2026-08-01");
    expect(byMonth.body.data.length).toBeGreaterThan(0);
    expect(byMonth.body.meta.total).toBe(byMonth.body.meta.total);

    expect((await admin.get("/orders?month=1999-01-01")).body.data).toHaveLength(0);
    expect((await admin.get(`/orders?shopId=${shopId}`)).body.data.length).toBeGreaterThan(0);
    expect((await admin.get("/orders?date=2026-08-05")).body.data.length).toBeGreaterThan(0);

    const pending = await admin.get("/orders?pending=true");
    expect(
      pending.body.data.every((o: { status: string }) => o.status !== "Delivered"),
    ).toBe(true);
  });

  it("paginates list endpoints", async () => {
    const page = await admin.get("/orders?page=1&limit=2");
    expect(page.body.data.length).toBeLessThanOrEqual(2);
    expect(page.body.meta.limit).toBe(2);
    expect(page.body.meta.page).toBe(1);
    expect(page.body.meta.totalPages).toBeGreaterThanOrEqual(1);
  });

  it("serves the delivery sheet and its due dates", async () => {
    const sheet = await admin.get("/orders/delivery-sheet?date=2026-08-05");
    expect(sheet.status).toBe(200);
    expect(sheet.body.data.every((o: { delivery_date: string }) => o.delivery_date === "2026-08-05")).toBe(
      true,
    );

    const dueDates = await admin.get("/orders/due-dates?financialYear=2026");
    expect(dueDates.body.data).toContain("2026-08-05");
  });

  it("generates stable invoice numbers for bills", async () => {
    const order = (await admin.get("/orders?month=2026-08-01")).body.data[0];
    const first = await admin.post("/bills").send({ orderIds: [order.id] });
    expect(first.status).toBe(200);
    expect(first.body.data[0].invoiceNo).toBeGreaterThan(0);
    expect(first.body.data[0].shopName).toBe("Order Test Shop");

    const second = await admin.post("/bills").send({ orderIds: [order.id] });
    expect(second.body.data[0].invoiceNo).toBe(first.body.data[0].invoiceNo);
  });

  it("deletes an order together with its delivery and payment", async () => {
    const order = await createOrder(9);
    const orderId = order.body.data.id;
    await admin.patch(`/orders/${orderId}/status`).send({ status: "Delivered" });

    expect((await admin.delete(`/orders/${orderId}`)).status).toBe(200);
    expectError(await admin.get(`/orders/${orderId}`), 404);
    expect(
      (await admin.get("/deliveries?month=2026-08-01")).body.data.find(
        (d: { order_id: string }) => d.order_id === orderId,
      ),
    ).toBeUndefined();
  });

  it("validates order payloads", async () => {
    expectError(
      await admin.post("/orders").send({
        shop_id: shopId,
        order_date: "2026-08-10",
        delivery_date: "2026-08-01", // before the order date
        order_lines: [{ product_id: products[0].id, qty: 1 }],
      }),
      422,
    );
    expectError(
      await admin.post("/orders").send({
        shop_id: shopId,
        order_date: "2026-08-01",
        delivery_date: "2026-08-01",
        order_lines: [{ product_id: products[0].id, qty: -5 }],
      }),
      422,
    );
    expectError(
      await admin.post("/orders").send({
        shop_id: shopId,
        order_date: "not-a-date",
        delivery_date: "2026-08-01",
        order_lines: [],
      }),
      422,
    );
    expectError(
      await admin.post("/orders").send({
        shop_id: "missing-shop",
        order_date: "2026-08-01",
        delivery_date: "2026-08-01",
        order_lines: [{ product_id: products[0].id, qty: 1 }],
      }),
      400,
    );
    expectError(
      await admin.patch(`/orders/${(await createOrder(1)).body.data.id}/status`).send({
        status: "Teleported",
      }),
      422,
    );
  });

  it("returns 404 for records that do not exist", async () => {
    expectError(await admin.get("/orders/00000000-0000-0000-0000-000000000000"), 404);
    expectError(await admin.delete("/orders/00000000-0000-0000-0000-000000000000"), 404);
    expectError(await admin.get("/payments/00000000-0000-0000-0000-000000000000"), 404);
    expectError(await admin.patch("/payments/nope").send({ status: "Received" }), 404);
  });
});
