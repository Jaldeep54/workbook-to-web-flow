process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-value-0123456789";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-value-0123456789";
process.env.BCRYPT_ROUNDS ??= "4"; // keep the suite fast; production uses 12
process.env.ADMIN_EMAIL ??= "noobgaming2907@gmail.com";
process.env.ADMIN_PASSWORD ??= "Dipak@123";
process.env.UPLOAD_DIR ??= "tests/.uploads";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request, { type Response } from "supertest";
import type { Express } from "express";

/**
 * Test harness: an in-memory MongoDB plus the real Express app, so every test
 * exercises the same stack a deployed instance runs (routes, middleware,
 * validation, RBAC, Mongoose) without needing a database installed.
 */
let memoryServer: MongoMemoryServer | undefined;
let app: Express | undefined;

export const API = "/api/v1";

export async function startTestServer(): Promise<Express> {
  if (app) return app;

  memoryServer = await MongoMemoryServer.create();
  const { connectDatabase, ensureIndexes } = await import("../src/config/database.js");
  await connectDatabase(memoryServer.getUri("klinzo_test"));
  await ensureIndexes();

  const { createApp } = await import("../src/app.js");
  app = createApp();
  return app;
}

export async function stopTestServer(): Promise<void> {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.connection.close();
  await memoryServer?.stop();
  memoryServer = undefined;
  app = undefined;
}

/** Wipes business data between suites while keeping the RBAC/seed data. */
export async function clearDomainCollections(): Promise<void> {
  const names = [
    "shops",
    "shop_products",
    "shop_areas",
    "orders",
    "deliveries",
    "payments",
    "label_orders",
    "variable_costs",
    "investments",
    "payouts",
    "invoices",
    "counters",
  ];
  await Promise.all(
    names.map((name) => mongoose.connection.collection(name).deleteMany({}).catch(() => undefined)),
  );
}

export async function seedDatabase(): Promise<void> {
  const { runSeed } = await import("../src/seeds/index.js");
  await runSeed();
}

export type Agent = {
  token: string;
  userId: string;
  get: (path: string) => request.Test;
  post: (path: string) => request.Test;
  patch: (path: string) => request.Test;
  put: (path: string) => request.Test;
  delete: (path: string) => request.Test;
};

/** Signs in and returns a helper that attaches the bearer token to every call. */
export async function signIn(email: string, password: string): Promise<Agent> {
  const server = await startTestServer();
  const response = await request(server).post(`${API}/auth/login`).send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const token = response.body.data.accessToken as string;
  const userId = response.body.data.user.id as string;
  const withAuth = (test: request.Test) => test.set("Authorization", `Bearer ${token}`);

  return {
    token,
    userId,
    get: (path) => withAuth(request(server).get(`${API}${path}`)),
    post: (path) => withAuth(request(server).post(`${API}${path}`)),
    patch: (path) => withAuth(request(server).patch(`${API}${path}`)),
    put: (path) => withAuth(request(server).put(`${API}${path}`)),
    delete: (path) => withAuth(request(server).delete(`${API}${path}`)),
  };
}

export async function signInAsAdmin(): Promise<Agent> {
  return signIn(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
}

/**
 * Creates a role holding exactly the given permissions and a user in it —
 * the setup behind every "can this role reach this endpoint?" assertion.
 */
export async function createRoleWithUser(
  admin: Agent,
  options: { roleName: string; permissions: string[]; email: string; password?: string },
): Promise<{ agent: Agent; roleId: string; userId: string; password: string }> {
  const { Permission } = await import("../src/models/permission.model.js");
  const docs = await Permission.find({ name: { $in: options.permissions } }, { _id: 1, name: 1 }).lean();
  const missing = options.permissions.filter((name) => !docs.some((d) => d.name === name));
  if (missing.length) throw new Error(`Unknown permissions in test setup: ${missing.join(", ")}`);

  const roleResponse = await admin
    .post("/roles")
    .send({ name: options.roleName, permissions: docs.map((d) => d._id) });
  if (roleResponse.status !== 201) {
    throw new Error(`Role creation failed: ${JSON.stringify(roleResponse.body)}`);
  }
  const roleId = roleResponse.body.data.id as string;

  const password = options.password ?? "Restricted@123";
  const userResponse = await admin.post("/users").send({
    email: options.email,
    password,
    fullName: options.roleName,
    role: roleId,
  });
  if (userResponse.status !== 201) {
    throw new Error(`User creation failed: ${JSON.stringify(userResponse.body)}`);
  }

  return {
    agent: await signIn(options.email, password),
    roleId,
    userId: userResponse.body.data.id as string,
    password,
  };
}

export const body = (response: Response) => response.body;

/** Convenience assertions used across suites. */
export function expectError(response: Response, status: number, code?: string): void {
  if (response.status !== status) {
    throw new Error(
      `Expected ${status} but received ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  if (response.body?.success !== false) {
    throw new Error(`Expected an error envelope, received ${JSON.stringify(response.body)}`);
  }
  if (code && response.body.error?.code !== code) {
    throw new Error(`Expected error code ${code}, received ${response.body.error?.code}`);
  }
}
