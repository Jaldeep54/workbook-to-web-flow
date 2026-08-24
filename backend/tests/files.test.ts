// Must be set before anything imports src/config/env.ts, which reads the
// environment once at module load.
process.env.FILE_STORAGE = "gridfs";

import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  API,
  clearDomainCollections,
  expectError,
  seedDatabase,
  signInAsAdmin,
  startTestServer,
  stopTestServer,
  type Agent,
} from "./helpers.js";

/**
 * The GridFS storage backend — what a serverless deployment runs, because its
 * filesystem is read-only. `shops.test.ts` covers the same round trip on disk;
 * this proves the bytes survive a trip through MongoDB and that the signed-URL
 * contract is identical either way.
 */
describe("Shop images in GridFS", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let admin: Agent;
  let shopId: string;

  // A 1x1 PNG is enough to prove the round trip.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeAll(async () => {
    server = await startTestServer();
    await seedDatabase();
    await clearDomainCollections();
    admin = await signInAsAdmin();
    const productIds = (await admin.get("/products")).body.data.map((p: { id: string }) => p.id);
    const areaId = (await admin.post("/shop-areas").send({ name: "Adajan" })).body.data.id;
    const created = await admin.post("/shops").send({
      code: "501",
      shop_name: "GridFS Grocers",
      area_id: areaId,
      product_ids: productIds.slice(0, 1),
    });
    if (created.status !== 201) throw new Error(`Shop setup failed: ${JSON.stringify(created.body)}`);
    shopId = created.body.data.id;
  });

  afterAll(stopTestServer);

  it("stores the bytes in MongoDB, not on disk", async () => {
    const uploaded = await request(server)
      .post(`${API}/shops/${shopId}/image`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("image", png, { filename: "storefront.png", contentType: "image/png" });

    expect(uploaded.status).toBe(200);
    const key = uploaded.body.data.image_path as string;
    expect(key).toContain(shopId);

    const stored = await mongoose.connection.collection("shop_images.files").findOne({ filename: key });
    expect(stored).not.toBeNull();
    expect(stored?.contentType).toBe("image/png");
  });

  it("serves the image back through a signed URL, byte for byte", async () => {
    const uploaded = await request(server)
      .post(`${API}/shops/${shopId}/image`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("image", png, { filename: "second.png", contentType: "image/png" });

    const signedUrl = uploaded.body.data.image_url as string;
    const fetched = await request(server).get(signedUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

    expect(fetched.status).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(fetched.body as Buffer, png)).toBe(0);

    // The signature still has to be genuine.
    expectError(await request(server).get(signedUrl.replace(/signature=\w+/, "signature=dead")), 401);
  });

  it("removes the stored bytes when the image is deleted", async () => {
    const uploaded = await request(server)
      .post(`${API}/shops/${shopId}/image`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("image", png, { filename: "third.png", contentType: "image/png" });
    const key = uploaded.body.data.image_path as string;

    expect((await admin.delete(`/shops/${shopId}/image`)).status).toBe(200);

    const stored = await mongoose.connection.collection("shop_images.files").findOne({ filename: key });
    expect(stored).toBeNull();
    // Replacing an image also drops the one it replaced, so only the newest
    // upload can still be present — and that one was just deleted.
    expect(await mongoose.connection.collection("shop_images.chunks").countDocuments()).toBe(0);
  });

  it("still refuses a file that isn't an image", async () => {
    const response = await request(server)
      .post(`${API}/shops/${shopId}/image`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("image", Buffer.from("not an image"), {
        filename: "payload.exe",
        contentType: "application/octet-stream",
      });
    expectError(response, 400);
  });
});
