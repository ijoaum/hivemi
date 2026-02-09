// =============================================================================
// Tests for auth middleware (security)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";

// We test the middleware by creating a fresh Hono app per test
// and importing the middleware factory logic

describe("authMiddleware", () => {
  const originalEnv = process.env.HIVEMI_SECRET;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.HIVEMI_SECRET;
    } else {
      process.env.HIVEMI_SECRET = originalEnv;
    }
    vi.resetModules();
  });

  async function createApp(secret?: string) {
    // Set env before importing the module (module reads env at import time)
    if (secret !== undefined) {
      process.env.HIVEMI_SECRET = secret;
    } else {
      delete process.env.HIVEMI_SECRET;
    }

    // Dynamic import to get fresh module with new env
    const { authMiddleware } = await import("../middleware/auth.js");

    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.use("/api/*", authMiddleware);
    app.get("/api/test", (c) => c.json({ data: "secret" }));
    return app;
  }

  it("should allow health endpoint without auth", async () => {
    const app = await createApp("test-secret-123");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("should allow all requests when HIVEMI_SECRET is not set (dev mode)", async () => {
    const app = await createApp(undefined);
    const res = await app.request("/api/test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBe("secret");
  });

  it("should reject requests without Authorization header", async () => {
    const app = await createApp("my-secret");
    const res = await app.request("/api/test");
    expect(res.status).toBe(401);
  });

  it("should reject requests with wrong secret", async () => {
    const app = await createApp("correct-secret");
    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(403);
  });

  it("should accept requests with correct secret", async () => {
    const app = await createApp("correct-secret");
    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer correct-secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBe("secret");
  });

  it("should reject non-Bearer scheme", async () => {
    const app = await createApp("my-secret");
    const res = await app.request("/api/test", {
      headers: { Authorization: "Basic my-secret" },
    });
    expect(res.status).toBe(403);
  });

  it("should reject empty token", async () => {
    const app = await createApp("my-secret");
    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(403);
  });
});
