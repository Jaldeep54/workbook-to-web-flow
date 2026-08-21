import type { Request, Response } from "express";

import { LabelProduct, Product } from "../models/catalogue.model.js";
import { LabelOrder, Order } from "../models/order.model.js";
import { ShopProduct } from "../models/shop.model.js";
import { syncProductLabelCosts } from "../services/catalogue.service.js";
import { ApiError } from "../utils/api-error.js";
import { created, ok } from "../utils/api-response.js";

const strip = <T extends { _id: string }>(row: T) => {
  const { _id, ...rest } = row;
  return { id: _id, ...rest };
};

/* ---------------------------------------------------------------- products */

export async function listProducts(_req: Request, res: Response) {
  const products = await Product.find().sort({ sort_order: 1 }).lean();
  return ok(res, products.map(strip));
}

export async function createProduct(req: Request, res: Response) {
  const body = req.body as { key: string };
  if (await Product.exists({ key: body.key })) {
    throw ApiError.conflict(`A product with key "${body.key}" already exists`);
  }
  const product = await Product.create(body);
  return created(res, strip(product.toObject()));
}

/**
 * `label_cost_per_unit` is intentionally not updatable here — it is derived
 * from the label rates (see services/catalogue.service.ts).
 */
export async function updateProduct(req: Request, res: Response) {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  product.set(req.body as Record<string, unknown>);
  await product.save();
  return ok(res, strip(product.toObject()));
}

export async function deleteProduct(req: Request, res: Response) {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  const [inOrders, inLabels] = await Promise.all([
    Order.countDocuments({ "order_lines.product_id": product._id }),
    LabelProduct.countDocuments({ product_id: product._id }),
  ]);
  if (inOrders > 0) {
    throw ApiError.conflict("This product appears on existing orders — deactivate it instead");
  }
  if (inLabels > 0) {
    throw ApiError.conflict("Remove this product's labels before deleting it");
  }

  await ShopProduct.deleteMany({ product_id: product._id });
  await product.deleteOne();
  return ok(res, { message: "Product deleted" });
}

/* ----------------------------------------------------------- label products */

export async function listLabelProducts(_req: Request, res: Response) {
  const labels = await LabelProduct.find().sort({ sort_order: 1 }).lean();
  return ok(res, labels.map(strip));
}

export async function createLabelProduct(req: Request, res: Response) {
  const body = req.body as { key: string; product_id: string };
  if (await LabelProduct.exists({ key: body.key })) {
    throw ApiError.conflict(`A label with key "${body.key}" already exists`);
  }
  if (!(await Product.exists({ _id: body.product_id }))) {
    throw ApiError.badRequest("The selected product does not exist");
  }

  const label = await LabelProduct.create(body);
  await syncProductLabelCosts([label.product_id]);
  return created(res, strip(label.toObject()));
}

/** Any change to a label's rates re-derives the owning product's label cost. */
export async function updateLabelProduct(req: Request, res: Response) {
  const label = await LabelProduct.findById(req.params.id);
  if (!label) throw ApiError.notFound("Label not found");

  const previousProduct = label.product_id;
  const body = req.body as { product_id?: string };
  if (body.product_id && !(await Product.exists({ _id: body.product_id }))) {
    throw ApiError.badRequest("The selected product does not exist");
  }

  label.set(req.body as Record<string, unknown>);
  await label.save();
  await syncProductLabelCosts([label.product_id, previousProduct]);

  return ok(res, strip(label.toObject()));
}

export async function deleteLabelProduct(req: Request, res: Response) {
  const label = await LabelProduct.findById(req.params.id);
  if (!label) throw ApiError.notFound("Label not found");

  const used = await LabelOrder.countDocuments({
    "label_order_lines.label_product_id": label._id,
  });
  if (used > 0) {
    throw ApiError.conflict("This label appears on existing label orders and cannot be deleted");
  }

  const productId = label.product_id;
  await label.deleteOne();
  await syncProductLabelCosts([productId]);
  return ok(res, { message: "Label deleted" });
}
