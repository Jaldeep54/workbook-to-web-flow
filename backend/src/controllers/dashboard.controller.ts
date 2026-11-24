import type { Request, Response } from "express";

import {
  availableMonths,
  dashboardSummary,
  orderQtyByProduct,
  skuOpportunity,
} from "../services/dashboard.service.js";
import { ok } from "../utils/api-response.js";

export async function getSummary(req: Request, res: Response) {
  const period = {
    month: req.query.month as string | undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
  };
  const areaId = (req.query.areaId as string | undefined) ?? null;
  return ok(res, await dashboardSummary(period, areaId));
}

export async function getAvailableMonths(_req: Request, res: Response) {
  return ok(res, await availableMonths());
}

export async function getOrderQtyByProduct(_req: Request, res: Response) {
  return ok(res, await orderQtyByProduct());
}

export async function getSkuOpportunity(_req: Request, res: Response) {
  return ok(res, await skuOpportunity());
}
