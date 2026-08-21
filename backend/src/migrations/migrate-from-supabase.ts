import { randomBytes } from "node:crypto";

import { connectDatabase, disconnectDatabase, ensureIndexes } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { LabelProduct, Product } from "../models/catalogue.model.js";
import { Investment, Invoice, Payout, VariableCost, Counter } from "../models/finance.model.js";
import { Delivery, LabelOrder, Order, Payment } from "../models/order.model.js";
import { ADMIN_ROLE_SLUG, Role } from "../models/role.model.js";
import { Shop, ShopArea, ShopProduct } from "../models/shop.model.js";
import { User, hashPassword } from "../models/user.model.js";
import { syncProductLabelCosts } from "../services/catalogue.service.js";
import { monthKey, toIsoDate } from "../utils/date.js";
import { runSeed } from "../seeds/index.js";

/**
 * Supabase (Postgres) -> MongoDB migration.
 *
 * Design notes:
 *  - **IDs are preserved.** Every collection is keyed by the same UUID the
 *    Postgres row had, so foreign keys (orders -> shops, deliveries -> orders,
 *    ...) survive without any remapping table.
 *  - **Re-runnable.** Every write is an upsert keyed by that id, so running the
 *    migration twice produces the same database — no duplicates — and a failed
 *    run can simply be repeated.
 *  - **Child tables are folded into their parent.** order_lines,
 *    delivery_lines and label_order_lines become embedded arrays, matching the
 *    document model (see models/order.model.ts).
 *  - **Errors are collected, not thrown.** One bad row reports itself and the
 *    rest of the migration continues; the summary at the end lists everything
 *    that failed.
 *  - **Passwords cannot come across.** Supabase Auth never exposes password
 *    hashes, so migrated users are created with a random password and must have
 *    one set by an administrator (the summary lists them).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate [-- --dry-run]
 */
type Row = Record<string, any>;

type Report = {
  collections: Record<string, { read: number; written: number }>;
  errors: string[];
  warnings: string[];
  usersNeedingPassword: string[];
};

const PAGE_SIZE = 1000;

function supabaseHeaders(): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

/** Reads a whole table through PostgREST, paging until it's exhausted. */
async function fetchTable(table: string, select = "*"): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${env.SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${PAGE_SIZE}&offset=${offset}`;
    const response = await fetch(url, { headers: supabaseHeaders() });
    if (!response.ok) {
      throw new Error(`Supabase read failed for "${table}": ${response.status} ${await response.text()}`);
    }
    const page = (await response.json()) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function upsertAll(
  model: { bulkWrite: (ops: any[]) => Promise<any> },
  name: string,
  rows: Row[],
  map: (row: Row) => Record<string, unknown> | null,
  report: Report,
  dryRun: boolean,
): Promise<void> {
  const operations: any[] = [];
  for (const row of rows) {
    try {
      const document = map(row);
      if (!document) continue;
      const { _id, ...rest } = document as { _id: string } & Record<string, unknown>;
      operations.push({
        updateOne: {
          filter: { _id },
          update: { $set: rest, $setOnInsert: { _id } },
          upsert: true,
        },
      });
    } catch (error) {
      report.errors.push(`${name} ${row.id ?? "(no id)"}: ${(error as Error).message}`);
    }
  }

  report.collections[name] = { read: rows.length, written: dryRun ? 0 : operations.length };
  if (dryRun || operations.length === 0) return;

  // Batched so a very large table doesn't build one enormous command.
  for (let i = 0; i < operations.length; i += 500) {
    try {
      await model.bulkWrite(operations.slice(i, i + 500));
    } catch (error) {
      report.errors.push(`${name} batch ${i / 500 + 1}: ${(error as Error).message}`);
    }
  }
}

export async function migrateFromSupabase(options: { dryRun?: boolean } = {}): Promise<Report> {
  const dryRun = options.dryRun ?? false;
  const report: Report = { collections: {}, errors: [], warnings: [], usersNeedingPassword: [] };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to migrate from Supabase",
    );
  }

  // The RBAC catalogue and the Admin account must exist before user rows can
  // reference a role.
  if (!dryRun) await runSeed();

  /* ------------------------------------------------------------ catalogue */

  const areas = await fetchTable("shop_areas");
  await upsertAll(ShopArea, "shop_areas", areas, (row) => ({
    _id: row.id,
    name: row.name,
    name_key: String(row.name ?? "").trim().toLowerCase(),
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  const products = await fetchTable("products");
  await upsertAll(Product, "products", products, (row) => ({
    _id: row.id,
    key: row.key,
    name: row.name,
    short_name: row.short_name,
    sort_order: Number(row.sort_order ?? 0),
    selling_price: Number(row.selling_price ?? 0),
    production_cost: Number(row.production_cost ?? 0),
    packaging_cost: Number(row.packaging_cost ?? 0),
    label_cost_per_unit: Number(row.label_cost_per_unit ?? 0),
    unit: row.unit ?? "",
    is_active: row.is_active ?? true,
  }), report, dryRun);

  const labelProducts = await fetchTable("label_products");
  await upsertAll(LabelProduct, "label_products", labelProducts, (row) => ({
    _id: row.id,
    key: row.key,
    name: row.name,
    short_name: row.short_name,
    sort_order: Number(row.sort_order ?? 0),
    product_id: row.product_id,
    labels_per_sheet: Number(row.labels_per_sheet ?? 0),
    sheet_cost: Number(row.sheet_cost ?? 0),
    low_stock_threshold: Number(row.low_stock_threshold ?? 15),
  }), report, dryRun);

  /* ---------------------------------------------------------------- shops */

  const shops = await fetchTable("shops");
  await upsertAll(Shop, "shops", shops, (row) => ({
    _id: row.id,
    code: String(row.code),
    folder_name: row.folder_name ?? null,
    shop_name: row.shop_name,
    label_name: row.label_name ?? null,
    bill_name: row.bill_name ?? null,
    design_type: Number(row.design_type ?? 1),
    area_id: row.area_id ?? null,
    image_path: row.image_path ?? null,
    address: row.address ?? null,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    mobile: row.mobile ?? null,
    handled_by: row.handled_by ?? null,
    joined_on: toIsoDate(row.joined_on),
    is_active: row.is_active ?? true,
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  const shopProducts = await fetchTable("shop_products");
  await upsertAll(ShopProduct, "shop_products", shopProducts, (row) => ({
    _id: row.id,
    shop_id: row.shop_id,
    product_id: row.product_id,
  }), report, dryRun);

  /* --------------------------------------------------- orders & their lines */

  const [orders, orderLines] = await Promise.all([
    fetchTable("orders"),
    fetchTable("order_lines"),
  ]);
  const linesByOrder = new Map<string, Array<{ product_id: string; qty: number }>>();
  for (const line of orderLines) {
    const list = linesByOrder.get(line.order_id) ?? [];
    list.push({ product_id: line.product_id, qty: Number(line.qty ?? 0) });
    linesByOrder.set(line.order_id, list);
  }

  await upsertAll(Order, "orders", orders, (row) => ({
    _id: row.id,
    shop_id: row.shop_id,
    order_no: Number(row.order_no),
    order_date: toIsoDate(row.order_date),
    delivery_date: toIsoDate(row.delivery_date),
    month: monthKey(row.order_date),
    status: row.status ?? "Pending",
    total_qty: Number(row.total_qty ?? 0),
    notes: row.notes ?? null,
    order_lines: linesByOrder.get(row.id) ?? [],
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  const [deliveries, deliveryLines] = await Promise.all([
    fetchTable("deliveries"),
    fetchTable("delivery_lines"),
  ]);
  const linesByDelivery = new Map<string, Array<{ product_id: string; qty: number }>>();
  for (const line of deliveryLines) {
    const list = linesByDelivery.get(line.delivery_id) ?? [];
    list.push({ product_id: line.product_id, qty: Number(line.qty ?? 0) });
    linesByDelivery.set(line.delivery_id, list);
  }

  await upsertAll(Delivery, "deliveries", deliveries, (row) => ({
    _id: row.id,
    shop_id: row.shop_id,
    order_id: row.order_id,
    delivery_date: toIsoDate(row.delivery_date),
    month: monthKey(row.delivery_date),
    status: row.status ?? "Delivered",
    total_qty: Number(row.total_qty ?? 0),
    total_sales: Number(row.total_sales ?? 0),
    labelling_cost: Number(row.labelling_cost ?? 0),
    packaging_cost: Number(row.packaging_cost ?? 0),
    production_cost: Number(row.production_cost ?? 0),
    total_fixed_cost: Number(row.total_fixed_cost ?? 0),
    profit: Number(row.profit ?? 0),
    delivery_lines: linesByDelivery.get(row.id) ?? [],
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  const payments = await fetchTable("payments");
  await upsertAll(Payment, "payments", payments, (row) => ({
    _id: row.id,
    shop_id: row.shop_id,
    order_id: row.order_id,
    payment_date: toIsoDate(row.payment_date),
    month: monthKey(row.payment_date),
    status: row.status ?? "Pending",
    collected_by: row.collected_by ?? null,
    collected_date: toIsoDate(row.collected_date),
    amount: Number(row.amount ?? 0),
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  const [labelOrders, labelOrderLines] = await Promise.all([
    fetchTable("label_orders"),
    fetchTable("label_order_lines"),
  ]);
  const linesByLabelOrder = new Map<
    string,
    Array<{ label_product_id: string; sheets: number; products: number }>
  >();
  for (const line of labelOrderLines) {
    const list = linesByLabelOrder.get(line.label_order_id) ?? [];
    list.push({
      label_product_id: line.label_product_id,
      sheets: Number(line.sheets ?? 0),
      products: Number(line.products ?? 0),
    });
    linesByLabelOrder.set(line.label_order_id, list);
  }

  await upsertAll(LabelOrder, "label_orders", labelOrders, (row) => ({
    _id: row.id,
    shop_id: row.shop_id,
    order_no: Number(row.order_no),
    order_date: toIsoDate(row.order_date),
    month: monthKey(row.order_date),
    total_labels: Number(row.total_labels ?? 0),
    label_order_lines: linesByLabelOrder.get(row.id) ?? [],
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  /* -------------------------------------------------------------- finance */

  const costs = await fetchTable("variable_costs");
  await upsertAll(VariableCost, "variable_costs", costs, (row) => ({
    _id: row.id,
    cost_date: toIsoDate(row.cost_date),
    month: monthKey(row.cost_date),
    amount: Number(row.amount ?? 0),
    cost_type: row.cost_type ?? "Others",
    note: row.note ?? null,
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
  }), report, dryRun);

  for (const [table, model, dateField] of [
    ["investments", Investment, "investment_date"],
    ["payouts", Payout, "payout_date"],
  ] as const) {
    try {
      const rows = await fetchTable(table);
      await upsertAll(model as any, table, rows, (row) => ({
        _id: row.id,
        [dateField]: toIsoDate(row[dateField]),
        amount: Number(row.amount ?? 0),
        done_by: row.done_by,
        created_at: row.created_at ? new Date(row.created_at) : new Date(),
      }), report, dryRun);
    } catch (error) {
      report.warnings.push(`Skipped ${table}: ${(error as Error).message}`);
    }
  }

  try {
    const invoices = await fetchTable("invoices");
    await upsertAll(Invoice, "invoices", invoices, (row) => ({
      _id: row.id,
      order_id: row.order_id,
      invoice_no: Number(row.invoice_no),
      created_at: row.created_at ? new Date(row.created_at) : new Date(),
    }), report, dryRun);

    // Continue the invoice sequence where Postgres' serial left off, so the
    // first bill generated after the migration doesn't collide.
    const highest = invoices.reduce((max, row) => Math.max(max, Number(row.invoice_no ?? 0)), 0);
    if (!dryRun && highest > 0) {
      await Counter.updateOne(
        { _id: "invoice_no" },
        { $max: { seq: highest } },
        { upsert: true },
      );
    }
  } catch (error) {
    report.warnings.push(`Skipped invoices: ${(error as Error).message}`);
  }

  /* ---------------------------------------------------------------- users */

  try {
    const [profiles, userRoles] = await Promise.all([
      fetchTable("profiles"),
      fetchTable("user_roles"),
    ]);
    const roleByUser = new Map(userRoles.map((r) => [r.user_id, String(r.role)]));

    const [adminRole, marketingRole] = await Promise.all([
      Role.findOne({ slug: ADMIN_ROLE_SLUG }).lean(),
      Role.findOne({ slug: "marketing" }).lean(),
    ]);

    for (const profile of profiles) {
      const email = String(profile.email ?? "").toLowerCase();
      if (!email) {
        report.warnings.push(`Profile ${profile.id} has no email — skipped`);
        continue;
      }
      if (email === env.ADMIN_EMAIL.toLowerCase()) continue; // seeded already

      const isAdmin = roleByUser.get(profile.id) === "admin";
      const roleId = (isAdmin ? adminRole?._id : marketingRole?._id) ?? adminRole?._id;
      if (!roleId) {
        report.errors.push(`No role available for ${email}`);
        continue;
      }

      if (dryRun) {
        report.usersNeedingPassword.push(email);
        continue;
      }

      const existing = await User.findOne({ email });
      if (existing) continue;

      // Supabase Auth doesn't expose password hashes, so accounts arrive with
      // an unusable random password that an administrator must reset.
      await User.create({
        _id: profile.id,
        email,
        passwordHash: await hashPassword(`${randomBytes(24).toString("base64url")}Aa1!`),
        fullName: profile.full_name || email,
        role: roleId,
        isActive: true,
      });
      report.usersNeedingPassword.push(email);
    }

    report.collections.users = {
      read: profiles.length,
      written: report.usersNeedingPassword.length,
    };
  } catch (error) {
    report.warnings.push(`Skipped users: ${(error as Error).message}`);
  }

  if (!dryRun) await syncProductLabelCosts();

  return report;
}

function printReport(report: Report, dryRun: boolean): void {
  logger.info(dryRun ? "Dry run complete — nothing was written" : "Migration complete");
  for (const [name, counts] of Object.entries(report.collections)) {
    logger.info(`  ${name.padEnd(18)} read ${String(counts.read).padStart(6)}  written ${counts.written}`);
  }
  if (report.usersNeedingPassword.length) {
    logger.warn(
      `${report.usersNeedingPassword.length} migrated user(s) need a password set by an administrator:`,
    );
    report.usersNeedingPassword.forEach((email) => logger.warn(`  - ${email}`));
  }
  report.warnings.forEach((w) => logger.warn(`WARNING: ${w}`));
  report.errors.forEach((e) => logger.error(`ERROR: ${e}`));
  if (report.errors.length) {
    logger.error(`${report.errors.length} row(s) failed — fix and re-run; the migration is idempotent`);
  }
}

const isDirectRun = process.argv[1]?.includes("migrate-from-supabase");
if (isDirectRun) {
  const dryRun = process.argv.includes("--dry-run");
  connectDatabase()
    .then(ensureIndexes)
    .then(() => migrateFromSupabase({ dryRun }))
    .then(async (report) => {
      printReport(report, dryRun);
      await disconnectDatabase();
      process.exit(report.errors.length ? 1 : 0);
    })
    .catch((error) => {
      logger.error("Migration failed:", error);
      process.exit(1);
    });
}
