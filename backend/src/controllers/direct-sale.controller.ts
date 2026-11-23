import type { Request, Response } from "express";
import { DirectSale } from "../models/direct-sale.model.js";
import { ApiError } from "../utils/api-error.js";
import { created, ok } from "../utils/api-response.js";

const strip = <T extends { _id: string }>(row: T) => {
  const { _id, ...rest } = row;
  return { id: _id, ...rest };
};

export async function listDirectSales(req: Request, res: Response) {
  const filter: Record<string, unknown> = {};

  // Month and date-range filters are mutually exclusive in the query validator.
  if (req.query.month) filter.month = req.query.month;
  if (req.query.fromDate) filter.sold_date = { $gte: req.query.fromDate };
  if (req.query.toDate) {
    filter.sold_date = {
      ...(filter.sold_date as Record<string, unknown> | undefined),
      $lte: req.query.toDate,
    };
  }
  if (req.query.soldBy) {
    const seller = String(req.query.soldBy).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    filter.sold_by = { $regex: seller, $options: "i" };
  }

  const rows = await DirectSale.find(filter).sort({ sold_date: -1 }).lean();

  // summary
  const totalSales = +rows.reduce((s, r) => s + r.selling_price, 0).toFixed(2);
  const totalProfit = +rows.reduce((s, r) => s + r.profit, 0).toFixed(2);

  // product-wise breakdown
  const byProduct: Record<
    string,
    {
      product_id: string;
      product_name: string;
      quantity: number;
      total_sales: number;
      total_profit: number;
    }
  > = {};
  for (const r of rows) {
    if (!byProduct[r.product_id]) {
      byProduct[r.product_id] = {
        product_id: r.product_id,
        product_name: r.product_name,
        quantity: 0,
        total_sales: 0,
        total_profit: 0,
      };
    }
    byProduct[r.product_id].quantity += r.quantity;
    byProduct[r.product_id].total_sales += r.selling_price;
    byProduct[r.product_id].total_profit += r.profit;
  }

  return ok(res, {
    rows: rows.map(strip),
    summary: { totalSales, totalProfit },
    byProduct: Object.values(byProduct).map((p) => ({
      ...p,
      total_sales: +p.total_sales.toFixed(2),
      total_profit: +p.total_profit.toFixed(2),
    })),
  });
}

export async function createDirectSale(req: Request, res: Response) {
  const sale = await DirectSale.create(req.body as Record<string, unknown>);
  return created(res, strip(sale.toObject()));
}

export async function updateDirectSale(req: Request, res: Response) {
  const sale = await DirectSale.findById(req.params.id);
  if (!sale) throw ApiError.notFound("Direct sale not found");
  sale.set(req.body as Record<string, unknown>);
  await sale.save();
  return ok(res, strip(sale.toObject()));
}

export async function deleteDirectSale(req: Request, res: Response) {
  const sale = await DirectSale.findByIdAndDelete(req.params.id);
  if (!sale) throw ApiError.notFound("Direct sale not found");
  return ok(res, { message: "Sale removed" });
}
