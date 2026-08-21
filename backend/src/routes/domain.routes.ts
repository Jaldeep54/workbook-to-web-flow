import { Router } from "express";
import multer from "multer";

import { env } from "../config/env.js";
import { RESOURCES } from "../config/permissions.js";
import * as catalogue from "../controllers/catalogue.controller.js";
import * as dashboard from "../controllers/dashboard.controller.js";
import * as deliveries from "../controllers/delivery.controller.js";
import * as finance from "../controllers/finance.controller.js";
import * as labels from "../controllers/label.controller.js";
import * as misc from "../controllers/misc.controller.js";
import * as orders from "../controllers/order.controller.js";
import * as payments from "../controllers/payment.controller.js";
import * as shops from "../controllers/shop.controller.js";
import { authorize } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { idParam, listQuery } from "../validators/common.validator.js";
import {
  billsSchema,
  costCreateSchema,
  costUpdateSchema,
  dashboardQuery,
  deliveryCreateSchema,
  deliverySheetQuery,
  deliveryUpdateSchema,
  dueDatesQuery,
  investmentSchema,
  labelOrderBulkSchema,
  labelOrderCreateSchema,
  labelProductCreateSchema,
  labelProductUpdateSchema,
  labelSuggestionQuery,
  monthListQuery,
  orderCreateSchema,
  orderListQuery,
  orderStatusSchema,
  orderUpdateSchema,
  paymentUpdateSchema,
  payoutSchema,
  productCreateSchema,
  productUpdateSchema,
  shopAnalysisQuery,
  shopAreaSchema,
  shopBodySchema,
  shopListQuery,
  shopUpdateSchema,
} from "../validators/domain.validator.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES },
});

/* ------------------------------------------------------------------- shops */

export const shopRouter = Router();

shopRouter.get(
  "/",
  authorize(RESOURCES.shops, "view"),
  validate({ query: shopListQuery }),
  asyncHandler(shops.listShops),
);
shopRouter.get("/next-code", authorize(RESOURCES.shops, "create"), asyncHandler(shops.getNextShopCode));
shopRouter.get("/products", authorize(RESOURCES.shops, "view"), asyncHandler(shops.listShopProducts));
shopRouter.post(
  "/",
  authorize(RESOURCES.shops, "create"),
  validate({ body: shopBodySchema }),
  asyncHandler(shops.createShop),
);
shopRouter.get(
  "/:id",
  authorize(RESOURCES.shops, "view"),
  validate({ params: idParam }),
  asyncHandler(shops.getShop),
);
shopRouter.get(
  "/:id/analysis",
  authorize(RESOURCES.shops, "view"),
  validate({ params: idParam, query: shopAnalysisQuery }),
  asyncHandler(shops.getShopAnalysis),
);
shopRouter.get(
  "/:id/history",
  authorize(RESOURCES.shops, "view"),
  validate({ params: idParam }),
  asyncHandler(shops.getShopHistory),
);
shopRouter.patch(
  "/:id",
  authorize(RESOURCES.shops, "update"),
  validate({ params: idParam, body: shopUpdateSchema }),
  asyncHandler(shops.updateShop),
);
shopRouter.post(
  "/:id/image",
  authorize(RESOURCES.shops, "update"),
  upload.single("image"),
  validate({ params: idParam }),
  asyncHandler(shops.uploadShopImage),
);
shopRouter.delete(
  "/:id/image",
  authorize(RESOURCES.shops, "update"),
  validate({ params: idParam }),
  asyncHandler(shops.removeShopImage),
);
/** The UI's "Delete shop" — deactivates, keeping the shop's history. */
shopRouter.post(
  "/:id/deactivate",
  authorize(RESOURCES.shops, "delete"),
  validate({ params: idParam }),
  asyncHandler(shops.deactivateShop),
);
shopRouter.delete(
  "/:id",
  authorize(RESOURCES.shops, "manage"),
  validate({ params: idParam }),
  asyncHandler(shops.deleteShop),
);

/* -------------------------------------------------------------- shop areas */

export const shopAreaRouter = Router();

shopAreaRouter.get("/", authorize(RESOURCES.shopAreas, "view"), asyncHandler(shops.listShopAreas));
shopAreaRouter.post(
  "/",
  authorize(RESOURCES.shopAreas, "create"),
  validate({ body: shopAreaSchema }),
  asyncHandler(shops.upsertShopArea),
);
shopAreaRouter.patch(
  "/:id",
  authorize(RESOURCES.shopAreas, "update"),
  validate({ params: idParam, body: shopAreaSchema }),
  asyncHandler(shops.updateShopArea),
);
shopAreaRouter.delete(
  "/:id",
  authorize(RESOURCES.shopAreas, "delete"),
  validate({ params: idParam }),
  asyncHandler(shops.deleteShopArea),
);

/* ---------------------------------------------------------------- products */

export const productRouter = Router();

productRouter.get("/", authorize(RESOURCES.products, "view"), asyncHandler(catalogue.listProducts));
productRouter.post(
  "/",
  authorize(RESOURCES.products, "create"),
  validate({ body: productCreateSchema }),
  asyncHandler(catalogue.createProduct),
);
productRouter.patch(
  "/:id",
  authorize(RESOURCES.products, "update"),
  validate({ params: idParam, body: productUpdateSchema }),
  asyncHandler(catalogue.updateProduct),
);
productRouter.delete(
  "/:id",
  authorize(RESOURCES.products, "delete"),
  validate({ params: idParam }),
  asyncHandler(catalogue.deleteProduct),
);

export const labelProductRouter = Router();

labelProductRouter.get(
  "/",
  authorize(RESOURCES.labelProducts, "view"),
  asyncHandler(catalogue.listLabelProducts),
);
labelProductRouter.post(
  "/",
  authorize(RESOURCES.labelProducts, "create"),
  validate({ body: labelProductCreateSchema }),
  asyncHandler(catalogue.createLabelProduct),
);
labelProductRouter.patch(
  "/:id",
  authorize(RESOURCES.labelProducts, "update"),
  validate({ params: idParam, body: labelProductUpdateSchema }),
  asyncHandler(catalogue.updateLabelProduct),
);
labelProductRouter.delete(
  "/:id",
  authorize(RESOURCES.labelProducts, "delete"),
  validate({ params: idParam }),
  asyncHandler(catalogue.deleteLabelProduct),
);

/* ------------------------------------------------------------------ orders */

export const orderRouter = Router();

orderRouter.get(
  "/",
  authorize(RESOURCES.orders, "view"),
  validate({ query: orderListQuery }),
  asyncHandler(orders.listOrders),
);
orderRouter.get(
  "/delivery-sheet",
  authorize(RESOURCES.orders, "view"),
  validate({ query: deliverySheetQuery }),
  asyncHandler(orders.deliverySheet),
);
orderRouter.get(
  "/due-dates",
  authorize(RESOURCES.orders, "view"),
  validate({ query: dueDatesQuery }),
  asyncHandler(orders.deliveryDueDates),
);
orderRouter.get("/next-no", authorize(RESOURCES.orders, "create"), asyncHandler(orders.getNextOrderNo));
orderRouter.post(
  "/",
  authorize(RESOURCES.orders, "create"),
  validate({ body: orderCreateSchema }),
  asyncHandler(orders.createOrder),
);
orderRouter.get(
  "/:id",
  authorize(RESOURCES.orders, "view"),
  validate({ params: idParam }),
  asyncHandler(orders.getOrder),
);
orderRouter.put(
  "/:id",
  authorize(RESOURCES.orders, "update"),
  validate({ params: idParam, body: orderUpdateSchema }),
  asyncHandler(orders.updateOrder),
);
/** Status changes cascade into deliveries and payments — hence `manage`. */
orderRouter.patch(
  "/:id/status",
  authorize(RESOURCES.orders, "manage"),
  validate({ params: idParam, body: orderStatusSchema }),
  asyncHandler(orders.changeOrderStatus),
);
orderRouter.delete(
  "/:id",
  authorize(RESOURCES.orders, "delete"),
  validate({ params: idParam }),
  asyncHandler(orders.deleteOrder),
);

/* -------------------------------------------------------------- deliveries */

export const deliveryRouter = Router();

deliveryRouter.get(
  "/",
  authorize(RESOURCES.deliveries, "view"),
  validate({ query: monthListQuery }),
  asyncHandler(deliveries.listDeliveries),
);
deliveryRouter.post(
  "/",
  authorize(RESOURCES.deliveries, "create"),
  validate({ body: deliveryCreateSchema }),
  asyncHandler(deliveries.createDelivery),
);
deliveryRouter.get(
  "/:id",
  authorize(RESOURCES.deliveries, "view"),
  validate({ params: idParam }),
  asyncHandler(deliveries.getDelivery),
);
deliveryRouter.patch(
  "/:id",
  authorize(RESOURCES.deliveries, "update"),
  validate({ params: idParam, body: deliveryUpdateSchema }),
  asyncHandler(deliveries.updateDelivery),
);
deliveryRouter.delete(
  "/:id",
  authorize(RESOURCES.deliveries, "delete"),
  validate({ params: idParam }),
  asyncHandler(deliveries.deleteDelivery),
);

/* ---------------------------------------------------------------- payments */

export const paymentRouter = Router();

paymentRouter.get(
  "/",
  authorize(RESOURCES.payments, "view"),
  validate({ query: monthListQuery }),
  asyncHandler(payments.listPayments),
);
paymentRouter.get(
  "/:id",
  authorize(RESOURCES.payments, "view"),
  validate({ params: idParam }),
  asyncHandler(payments.getPayment),
);
paymentRouter.patch(
  "/:id",
  authorize(RESOURCES.payments, "update"),
  validate({ params: idParam, body: paymentUpdateSchema }),
  asyncHandler(payments.updatePayment),
);

/* ------------------------------------------------------------ label orders */

export const labelOrderRouter = Router();

labelOrderRouter.get(
  "/",
  authorize(RESOURCES.labelOrders, "view"),
  validate({ query: monthListQuery }),
  asyncHandler(labels.listLabelOrders),
);
labelOrderRouter.post(
  "/",
  authorize(RESOURCES.labelOrders, "create"),
  validate({ body: labelOrderCreateSchema }),
  asyncHandler(labels.createLabelOrder),
);
labelOrderRouter.post(
  "/bulk",
  authorize(RESOURCES.labelOrders, "create"),
  validate({ body: labelOrderBulkSchema }),
  asyncHandler(labels.createLabelOrdersBulk),
);
labelOrderRouter.delete(
  "/:id",
  authorize(RESOURCES.labelOrders, "delete"),
  validate({ params: idParam }),
  asyncHandler(labels.deleteLabelOrder),
);

export const labelStockRouter = Router();

labelStockRouter.get("/stock", authorize(RESOURCES.labelStock, "view"), asyncHandler(labels.getLabelStock));
labelStockRouter.get(
  "/stock-summary",
  authorize(RESOURCES.labelStock, "view"),
  asyncHandler(labels.getLabelStockSummary),
);
labelStockRouter.get(
  "/suggestions",
  authorize(RESOURCES.labelStock, "view"),
  validate({ query: labelSuggestionQuery }),
  asyncHandler(labels.getLabelSuggestions),
);

/* ------------------------------------------------------- costs & cash flow */

export const costRouter = Router();

costRouter.get(
  "/",
  authorize(RESOURCES.costs, "view"),
  validate({ query: monthListQuery }),
  asyncHandler(finance.listCosts),
);
costRouter.post(
  "/",
  authorize(RESOURCES.costs, "create"),
  validate({ body: costCreateSchema }),
  asyncHandler(finance.createCost),
);
costRouter.patch(
  "/:id",
  authorize(RESOURCES.costs, "update"),
  validate({ params: idParam, body: costUpdateSchema }),
  asyncHandler(finance.updateCost),
);
costRouter.delete(
  "/:id",
  authorize(RESOURCES.costs, "delete"),
  validate({ params: idParam }),
  asyncHandler(finance.deleteCost),
);

export const cashPositionRouter = Router();

cashPositionRouter.get(
  "/summary",
  authorize(RESOURCES.cashPosition, "view"),
  asyncHandler(finance.getCashPosition),
);
cashPositionRouter.get(
  "/investments",
  authorize(RESOURCES.cashPosition, "view"),
  validate({ query: listQuery }),
  asyncHandler(finance.listInvestments),
);
cashPositionRouter.post(
  "/investments",
  authorize(RESOURCES.cashPosition, "create"),
  validate({ body: investmentSchema }),
  asyncHandler(finance.createInvestment),
);
cashPositionRouter.delete(
  "/investments/:id",
  authorize(RESOURCES.cashPosition, "delete"),
  validate({ params: idParam }),
  asyncHandler(finance.deleteInvestment),
);
cashPositionRouter.get(
  "/payouts",
  authorize(RESOURCES.cashPosition, "view"),
  validate({ query: listQuery }),
  asyncHandler(finance.listPayouts),
);
cashPositionRouter.post(
  "/payouts",
  authorize(RESOURCES.cashPosition, "create"),
  validate({ body: payoutSchema }),
  asyncHandler(finance.createPayout),
);
cashPositionRouter.delete(
  "/payouts/:id",
  authorize(RESOURCES.cashPosition, "delete"),
  validate({ params: idParam }),
  asyncHandler(finance.deletePayout),
);

/* --------------------------------------------------------------- dashboard */

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  authorize(RESOURCES.dashboard, "view"),
  validate({ query: dashboardQuery }),
  asyncHandler(dashboard.getSummary),
);
dashboardRouter.get(
  "/available-months",
  authorize(RESOURCES.dashboard, "view"),
  asyncHandler(dashboard.getAvailableMonths),
);
dashboardRouter.get(
  "/order-qty-by-product",
  authorize(RESOURCES.reports, "view"),
  asyncHandler(dashboard.getOrderQtyByProduct),
);
dashboardRouter.get(
  "/sku-opportunity",
  authorize(RESOURCES.skuOpportunity, "view"),
  asyncHandler(dashboard.getSkuOpportunity),
);

/* ------------------------------------------------------- bills and imports */

export const billRouter = Router();

billRouter.post(
  "/",
  authorize(RESOURCES.bills, "create"),
  validate({ body: billsSchema }),
  asyncHandler(misc.generateBills),
);

export const importRouter = Router();

importRouter.post(
  "/workbook",
  authorize(RESOURCES.imports, "create"),
  upload.single("workbook"),
  asyncHandler(misc.uploadWorkbook),
);
