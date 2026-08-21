import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  API,
  expectError,
  seedDatabase,
  signIn,
  signInAsAdmin,
  startTestServer,
  stopTestServer,
  type Agent,
} from "./helpers.js";

describe("Authentication", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let admin: Agent;

  beforeAll(async () => {
    server = await startTestServer();
    await seedDatabase();
    admin = await signInAsAdmin();
  });

  afterAll(stopTestServer);

  it("signs the seeded administrator in and returns their permissions", async () => {
    const response = await request(server)
      .post(`${API}/auth/login`)
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.user.role.slug).toBe("admin");
    expect(response.body.data.user.permissions).toContain("*:manage");
    // A refresh token must only ever travel in an httpOnly cookie.
    const cookies = String(response.headers["set-cookie"]);
    expect(cookies).toContain("klinzo_refresh_token");
    expect(cookies).toContain("HttpOnly");
  });

  it("never returns the password hash", async () => {
    const response = await admin.get("/auth/me");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    expect(response.body.data.password).toBeUndefined();
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    const wrongPassword = await request(server)
      .post(`${API}/auth/login`)
      .send({ email: process.env.ADMIN_EMAIL, password: "NotThePassword1!" });
    const unknownEmail = await request(server)
      .post(`${API}/auth/login`)
      .send({ email: "nobody@example.com", password: "NotThePassword1!" });

    expectError(wrongPassword, 401, "UNAUTHENTICATED");
    expectError(unknownEmail, 401, "UNAUTHENTICATED");
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it("validates the login payload", async () => {
    const response = await request(server)
      .post(`${API}/auth/login`)
      .send({ email: "not-an-email", password: "" });
    expectError(response, 422, "VALIDATION_ERROR");
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });

  it("refuses protected routes without, and with a broken, token", async () => {
    expectError(await request(server).get(`${API}/shops`), 401);
    expectError(
      await request(server).get(`${API}/shops`).set("Authorization", "Bearer not.a.jwt"),
      401,
    );
    expectError(await request(server).get(`${API}/shops`).set("Authorization", "Basic abc"), 401);
  });

  it("rotates refresh tokens and rejects a reused one", async () => {
    const login = await request(server)
      .post(`${API}/auth/login`)
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    const cookie = login.headers["set-cookie"];

    const first = await request(server).post(`${API}/auth/refresh`).set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();

    // The original cookie has now been rotated away — replaying it must fail.
    const replay = await request(server).post(`${API}/auth/refresh`).set("Cookie", cookie);
    expectError(replay, 401);
  });

  it("signs out and clears the refresh cookie", async () => {
    const login = await request(server)
      .post(`${API}/auth/login`)
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    const cookie = login.headers["set-cookie"];

    const logout = await request(server).post(`${API}/auth/logout`).set("Cookie", cookie);
    expect(logout.status).toBe(200);
    expectError(await request(server).post(`${API}/auth/refresh`).set("Cookie", cookie), 401);
  });

  it("enforces the password policy and invalidates sessions on change", async () => {
    const email = "password.tester@klinzo.test";
    const roles = await admin.get("/roles");
    const marketing = roles.body.data.find((r: { slug: string }) => r.slug === "marketing");

    await admin
      .post("/users")
      .send({ email, password: "Initial@123", fullName: "Password Tester", role: marketing.id });

    const user = await signIn(email, "Initial@123");

    expectError(
      await user.post("/auth/change-password").send({
        currentPassword: "Initial@123",
        newPassword: "weak",
      }),
      422,
    );
    expectError(
      await user.post("/auth/change-password").send({
        currentPassword: "WrongCurrent@1",
        newPassword: "Stronger@123",
      }),
      400,
    );

    const changed = await user
      .post("/auth/change-password")
      .send({ currentPassword: "Initial@123", newPassword: "Stronger@123" });
    expect(changed.status).toBe(200);

    // The access token issued before the change must stop working at once.
    expectError(await user.get("/auth/me"), 401);
    const reauth = await signIn(email, "Stronger@123");
    expect((await reauth.get("/auth/me")).status).toBe(200);
  });

  it("blocks a deactivated account from using an existing token", async () => {
    const email = "deactivated.user@klinzo.test";
    const roles = await admin.get("/roles");
    const marketing = roles.body.data.find((r: { slug: string }) => r.slug === "marketing");

    const created = await admin
      .post("/users")
      .send({ email, password: "Active@123", fullName: "Soon Inactive", role: marketing.id });
    const user = await signIn(email, "Active@123");
    expect((await user.get("/auth/me")).status).toBe(200);

    await admin.patch(`/users/${created.body.data.id}`).send({ isActive: false });

    expectError(await user.get("/auth/me"), 403);
    expectError(
      await request(server)
        .post(`${API}/auth/login`)
        .send({ email, password: "Active@123" }),
      403,
    );
  });
});
