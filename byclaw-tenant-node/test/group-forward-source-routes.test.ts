import { afterEach, expect, it, vi } from "vitest";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { config } from "./fixtures.js";
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup(ready = true) {
  const reader = {
    readMessage: vi.fn(async () => ({ id: "9007199254740993" })),
    requireUploadSession: vi.fn(async () => ({ sessionId: "30" })),
  };
  const services = {
    commands: {},
    history: {},
    sessions: {},
    schema: {},
    connected: () => true,
    ready: () => ready,
    provisioned: () => true,
    schemaState: () => ({}),
    health: () => ({}),
    forwardSources: reader,
  } as unknown as HttpServices;
  const app = createApp(
    { ...config, transport: "http", internalToken: "fixture-only" },
    services,
    undefined,
    { logger: false },
  );
  apps.push(app);
  return { app, reader };
}
const headers = {
  "x-enterprise-id": "10",
  "x-tenant-generation": "7",
  "x-actor-user-id": "20",
  "x-byclaw-internal-token": "fixture-only",
};
it("both internal read routes enforce existing service auth, tenant and READY before dispatch", async () => {
  const { app, reader } = setup();
  for (const url of [
    "/internal/v1/group-chats/30/forward-sources/9007199254740993",
    "/internal/v1/forward-upload-sessions/30",
  ]) {
    expect(
      (await app.inject({ url, headers: { ...headers, "x-byclaw-internal-token": "bad" } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url, headers: { ...headers, "x-enterprise-id": "11" } })).statusCode,
    ).toBe(403);
    expect((await setup(false).app.inject({ url, headers })).statusCode).toBe(503);
    expect((await app.inject({ url, headers })).statusCode).toBe(200);
  }
  expect(reader.readMessage).toHaveBeenCalledExactlyOnceWith("20", "30", "9007199254740993");
  expect(reader.requireUploadSession).toHaveBeenCalledExactlyOnceWith("20", "30");
});
