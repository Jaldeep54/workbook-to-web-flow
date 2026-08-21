import type { Request, Response } from "express";

import { Investment, Payout, VariableCost } from "../models/finance.model.js";
import { cashPositionSummary } from "../services/cash-position.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, created, ok, paginated } from "../utils/api-response.js";
import { parseListQuery } from "../utils/query.js";

const strip = <T extends { _id: string }>(row: T) => {
  const { _id, ...rest } = row;
  return { id: _id, ...rest };
};

/* ---------------------------------------------------------- variable costs */

export async function listCosts(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["cost_date", "amount", "cost_type", "created_at"],
    { sortBy: "cost_date", sortOrder: "desc", limit: 200 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.costType) filter.cost_type = req.query.costType;

  const [rows, total] = await Promise.all([
    VariableCost.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    VariableCost.countDocuments(filter),
  ]);

  return paginated(res, rows.map(strip), buildPaginationMeta(page, limit, total));
}

export async function createCost(req: Request, res: Response) {
  const cost = await VariableCost.create(req.body as Record<string, unknown>);
  return created(res, strip(cost.toObject()));
}

export async function updateCost(req: Request, res: Response) {
  const cost = await VariableCost.findById(req.params.id);
  if (!cost) throw ApiError.notFound("Cost not found");
  cost.set(req.body as Record<string, unknown>);
  await cost.save();
  return ok(res, strip(cost.toObject()));
}

export async function deleteCost(req: Request, res: Response) {
  const cost = await VariableCost.findByIdAndDelete(req.params.id);
  if (!cost) throw ApiError.notFound("Cost not found");
  return ok(res, { message: "Cost removed" });
}

/* ------------------------------------------------------------ cash position */

export async function getCashPosition(_req: Request, res: Response) {
  return ok(res, await cashPositionSummary());
}

export async function listInvestments(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["investment_date", "amount", "created_at"],
    { sortBy: "investment_date", sortOrder: "desc", limit: 500 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.doneBy) filter.done_by = req.query.doneBy;

  const [rows, total] = await Promise.all([
    Investment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Investment.countDocuments(filter),
  ]);

  return paginated(res, rows.map(strip), buildPaginationMeta(page, limit, total));
}

export async function createInvestment(req: Request, res: Response) {
  const investment = await Investment.create(req.body as Record<string, unknown>);
  return created(res, strip(investment.toObject()));
}

export async function deleteInvestment(req: Request, res: Response) {
  const investment = await Investment.findByIdAndDelete(req.params.id);
  if (!investment) throw ApiError.notFound("Investment not found");
  return ok(res, { message: "Investment removed" });
}

export async function listPayouts(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["payout_date", "amount", "created_at"],
    { sortBy: "payout_date", sortOrder: "desc", limit: 500 },
  );

  const [rows, total] = await Promise.all([
    Payout.find().sort(sort).skip(skip).limit(limit).lean(),
    Payout.countDocuments(),
  ]);

  return paginated(res, rows.map(strip), buildPaginationMeta(page, limit, total));
}

export async function createPayout(req: Request, res: Response) {
  const payout = await Payout.create(req.body as Record<string, unknown>);
  return created(res, strip(payout.toObject()));
}

export async function deletePayout(req: Request, res: Response) {
  const payout = await Payout.findByIdAndDelete(req.params.id);
  if (!payout) throw ApiError.notFound("Payout not found");
  return ok(res, { message: "Payout removed" });
}
