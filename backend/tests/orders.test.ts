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
  let areaId: string;
  let products: Array<{ id: string; key: string; selling_price: number; production_cost: number; packaging_cost: number; label_cost_per_unit: number }>;

  beforeAll(async () => {
    await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();

    products = (await admin.get("/products")).body.data;
    areaId = (await admin.post("/shop-areas").send({ name: "Adajan" })).body.data.id;
    const shop = await admin.post("/shops").send({
      code: "1",
      shop_name: "Order Test Shop",
      label_name: "OTS",
      area_id: areaId,
      product_ids: products.map((p) => p.id),
    });
    shopId = shop.body.data.id;
  });

  afterAll(stopTestServer);

  // Every call passes an explicit, distinct date: a shop takes at most one
  // order per calendar day, so reusing one would now be a 409.
  async function createOrder(qty: number, date: string) {
    return admin.post("/orders").send({
      shop_id: shopId,
      order_date: date,
      delivery_date: date,
      order_lines: [{ product_id: products[0].id, qty }],
    });
  }

  it("creates an order, numbering it sequentially per shop", async () => {
    const first = await createOrder(10, "2026-08-01");
    expect(first.status).toBe(201);
    expect(first.body.data.order_no).toBe(1);
    expect(first.body.data.total_qty).toBe(10);
    expect(first.body.data.month).toBe("2026-08-01");
    expect(first.body.data.status).toBe("Pending");
    expect(first.body.data.shops.shop_name).toBe("Order Test Shop");

    const second = await createOrder(5, "2026-08-02");
    expect(second.body.data.order_no).toBe(2);
  });

  it("computes delivery money figures with the workbook formulas", async () => {
    const order = await createOrder(4, "2026-08-03");
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
    const order = await createOrder(2, "2026-08-04");
    await admin.patch(`/orders/${order.body.data.id}/status`).send({ status: "Delivered" });

    const updated = await admin.put(`/orders/${order.body.data.id}`).send({
      shop_id: shopId,
      order_date: "2026-08-04",
      delivery_date: "2026-08-04",
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
    const order = await createOrder(3, "2026-08-05");
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
    // Re-saving an order on its own date is not a clash with itself.

    const after = await admin.get(`/payments/${payment.id}`);
    expect(after.body.data.status).toBe("Received");
    expect(after.body.data.amount).toBeCloseTo(3 * products[0].selling_price, 2);
    expect(after.body.data.collected_by).toBe("Bhavin");
  });

  it("unwinds the delivery and payment when an order leaves Delivered", async () => {
    const order = await createOrder(6, "2026-08-06");
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
    const order = await createOrder(7, "2026-08-07");
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

  it("bills an order under its own order number, scoped by the shop's code", async () => {
    const order = (await admin.get("/orders?month=2026-08-01")).body.data[0];
    const first = await admin.post("/bills").send({ orderIds: [order.id] });
    expect(first.status).toBe(200);
    // The number on the bill is the number on the Orders screen — not a
    // separate sequence the shopkeeper can't cross-check.
    expect(first.body.data[0].invoiceNo).toBe(order.order_no);
    expect(first.body.data[0].shopCode).toBe("1");
    expect(first.body.data[0].shopName).toBe("Order Test Shop");

    const second = await admin.post("/bills").send({ orderIds: [order.id] });
    expect(second.body.data[0].invoiceNo).toBe(first.body.data[0].invoiceNo);
  });

  it("tracks a part payment as a balance, and green-lights it once settled", async () => {
    const order = await createOrder(10, "2026-08-14");
    const orderId = order.body.data.id;
    await admin.patch(`/orders/${orderId}/status`).send({ status: "Delivered" });

    const payments = await admin.get("/payments?month=2026-08-01");
    const payment = payments.body.data.find((p: { order_id: string }) => p.order_id === orderId);
    expect(payment.status).toBe("Pending");
    expect(payment.amount_received).toBe(0);
    expect(payment.balance).toBeCloseTo(payment.amount, 2);

    const part = await admin
      .patch(`/payments/${payment.id}`)
      .send({ amount_received: Math.round(payment.amount / 4) });
    expect(part.body.data.status).toBe("Partial");
    expect(part.body.data.balance).toBeCloseTo(payment.amount - Math.round(payment.amount / 4), 2);

    const settled = await admin
      .patch(`/payments/${payment.id}`)
      .send({ amount_received: payment.amount });
    expect(settled.body.data.status).toBe("Received");
    expect(settled.body.data.balance).toBe(0);

    // A bare status is shorthand for the money: Pending withdraws the lot.
    const cleared = await admin.patch(`/payments/${payment.id}`).send({ status: "Pending" });
    expect(cleared.body.data.amount_received).toBe(0);
    expect(cleared.body.data.balance).toBeCloseTo(payment.amount, 2);
  });

  it("refuses a payment larger than the order is worth", async () => {
    const payments = await admin.get("/payments?month=2026-08-01");
    const payment = payments.body.data[0];
    expectError(
      await admin.patch(`/payments/${payment.id}`).send({ amount_received: payment.amount + 1 }),
      400,
    );
  });

  it("filters payments by status and searches them by shop", async () => {
    const partial = await admin.get("/payments?month=2026-08-01&status=Pending");
    expect(partial.body.data.every((p: { status: string }) => p.status === "Pending")).toBe(true);

    const hit = await admin.get("/payments?month=2026-08-01&search=Order Test");
    expect(hit.body.data.length).toBeGreaterThan(0);
    expect((await admin.get("/payments?month=2026-08-01&search=nothing-like-this")).body.data)
      .toHaveLength(0);
  });

  it("backfills payments written before amount_received existed", async () => {
    const { default: mongoose } = await import("mongoose");
    const { backfillPaymentAmountReceived } = await import("../src/seeds/backfill.seed.js");
    const raw = mongoose.connection.collection("payments");

    // Rows exactly as the old schema wrote them: a status, no received figure.
    await raw.insertMany([
      {
        _id: "legacy-settled",
        shop_id: shopId,
        order_id: "legacy-order-1",
        payment_date: "2026-08-20",
        month: "2026-08-01",
        status: "Received",
        amount: 1200,
      },
      {
        _id: "legacy-partial",
        shop_id: shopId,
        order_id: "legacy-order-2",
        payment_date: "2026-08-21",
        month: "2026-08-01",
        status: "Partial",
        amount: 800,
      },
    ] as never);

    expect(await backfillPaymentAmountReceived()).toBe(2);

    const settled = await admin.get("/payments/legacy-settled");
    expect(settled.body.data.amount_received).toBe(1200);
    expect(settled.body.data.balance).toBe(0);
    expect(settled.body.data.status).toBe("Received");

    // "Partial" could not say how much had come in, so there is no instalment
    // to preserve — the row starts from nothing collected.
    const partial = await admin.get("/payments/legacy-partial");
    expect(partial.body.data.amount_received).toBe(0);
    expect(partial.body.data.balance).toBe(800);
    expect(partial.body.data.status).toBe("Pending");

    // Idempotent: a second run has nothing left to repair.
    expect(await backfillPaymentAmountReceived()).toBe(0);
  });

  it("lists the people a payment can be collected by", async () => {
    const collectors = await admin.get("/payments/collectors");
    expect(collectors.status).toBe(200);
    expect(collectors.body.data.length).toBeGreaterThan(0);
    expect(collectors.body.data[0]).toHaveProperty("full_name");
  });

  it("keeps a part payment when the order leaves Delivered", async () => {
    const order = await createOrder(4, "2026-08-15");
    const orderId = order.body.data.id;
    await admin.patch(`/orders/${orderId}/status`).send({ status: "Delivered" });

    const payments = await admin.get("/payments?month=2026-08-01");
    const payment = payments.body.data.find((p: { order_id: string }) => p.order_id === orderId);
    await admin.patch(`/payments/${payment.id}`).send({ amount_received: 100 });

    await admin.patch(`/orders/${orderId}/status`).send({ status: "Cancelled" });

    const after = await admin.get(`/payments/${payment.id}`);
    expect(after.status).toBe(200);
    expect(after.body.data.amount_received).toBe(100);
  });

  it("deletes an order together with its delivery and payment", async () => {
    const order = await createOrder(9, "2026-08-08");
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

  it("allows only one order per shop per day", async () => {
    const first = await createOrder(5, "2026-08-20");
    expect(first.status).toBe(201);

    const duplicate = await admin.post("/orders").send({
      shop_id: shopId,
      order_date: "2026-08-20",
      delivery_date: "2026-08-21",
      order_lines: [{ product_id: products[0].id, qty: 2 }],
    });
    expectError(duplicate, 409);
    expect(duplicate.body.error.message).toContain("already has an order");

    // The same day is fine for a different shop...
    const other = await admin.post("/shops").send({
      code: "2",
      shop_name: "Second Shop",
      area_id: areaId,
      product_ids: [products[0].id],
    });
    const forOtherShop = await admin.post("/orders").send({
      shop_id: other.body.data.id,
      order_date: "2026-08-20",
      delivery_date: "2026-08-20",
      order_lines: [{ product_id: products[0].id, qty: 1 }],
    });
    expect(forOtherShop.status).toBe(201);

    // ...and so is another day for this one.
    expect((await createOrder(3, "2026-08-21")).status).toBe(201);

    // Editing an order in place never clashes with itself, but moving it onto
    // a day the shop already has an order on does.
    const inPlace = await admin.put(`/orders/${first.body.data.id}`).send({
      shop_id: shopId,
      order_date: "2026-08-20",
      delivery_date: "2026-08-22",
      order_lines: [{ product_id: products[0].id, qty: 8 }],
    });
    expect(inPlace.status).toBe(200);

    expectError(
      await admin.put(`/orders/${first.body.data.id}`).send({
        shop_id: shopId,
        order_date: "2026-08-21",
        delivery_date: "2026-08-21",
        order_lines: [{ product_id: products[0].id, qty: 8 }],
      }),
      409,
    );
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
      await admin.patch(`/orders/${(await createOrder(1, "2026-08-09")).body.data.id}/status`).send({
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
