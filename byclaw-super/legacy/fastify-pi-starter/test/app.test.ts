import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { PiClient } from "../src/pi/pi.types.js";

const config: AppConfig = { host: "127.0.0.1", port: 3000, corsOrigin: true };

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function mockPi(): PiClient {
  return {
    isReady: () => true,
    chat: vi.fn(async () => ({ sessionId: "session-1", model: "test/model", text: "hello" })),
    stream: vi.fn(async (_input, emit) => {
      emit({ type: "start", sessionId: "session-1", model: "test/model" });
      emit({ type: "delta", text: "hello" });
      emit({ type: "done" });
    }),
  };
}

describe("Fastify Pi API", () => {
  it("reports health", async () => {
    const app = await buildApp(config, mockPi());
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", piReady: true });
  });

  it("returns a complete chat response", async () => {
    const pi = mockPi();
    const app = await buildApp(config, pi);
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hi" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessionId: "session-1", model: "test/model", text: "hello" });
    expect(pi.chat).toHaveBeenCalledWith({ message: "Hi" });
  });

  it("rejects an empty message", async () => {
    const app = await buildApp(config, mockPi());
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/chat", payload: { message: "" } });
    expect(response.statusCode).toBe(400);
  });

  it("streams server-sent events", async () => {
    const app = await buildApp(config, mockPi());
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: { message: "Hi" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: delta");
    expect(response.body).toContain('"text":"hello"');
    expect(response.body).toContain("event: done");
  });
});
