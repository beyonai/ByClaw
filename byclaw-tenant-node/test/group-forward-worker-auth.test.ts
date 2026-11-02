import { afterEach, expect, it, vi } from "vitest";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { config } from "./fixtures.js";
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const headers = {
  "x-enterprise-id": "10",
  "x-tenant-generation": "7",
  "x-actor-user-id": "20",
  "x-byclaw-internal-token": "fixture-only",
};
const lease = {
  requestId: "9007199254740993",
  targetId: "9007199254740994",
  actor: { enterpriseId: "10", userId: "20" },
  sourceSessionId: "30",
  targetSessionId: "31",
  owner: "claim",
  fencingVersion: "9007199254740995",
  leaseUntil: "2099-01-01T00:00:00Z",
  state: "COPYING",
};
const path = `/internal/v1/group-chats/30/forward-requests/${lease.requestId}/targets/${lease.targetId}/ready`;
function setup(ready = true) {
  const service = {
    recovery: { scan: vi.fn(async () => ({ candidates: [], nextCursor: null })) },
    inspect: vi.fn(async () => ({
      locator: { enterpriseId: "10", requestId: lease.requestId, backend: "TENANT" },
      actor: lease.actor,
      sourceSessionId: "30",
    })),
    markReady: vi.fn(async (l) => ({ ...l, state: "READY" })),
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
    forwards: service,
  } as unknown as HttpServices;
  const app = createApp(
    { ...config, transport: "http", internalToken: "fixture-only" },
    services,
    undefined,
    { logger: false },
  );
  apps.push(app);
  return { app, service };
}
it("workerCannotReplaceActorTenantOrBindingAndCannotSetWholeCheckpoint", async () => {
  const { app, service } = setup();
  for (const body of [
    { lease: { ...lease, actor: { ...lease.actor, userId: "21" } } },
    { lease: { ...lease, actor: { ...lease.actor, enterpriseId: "11" } } },
    { lease: { ...lease, targetId: "999" } },
    { lease: { ...lease, sourceSessionId: "99" } },
    { lease, checkpoint: { state: "READY", progress: 100 } },
  ])
    expect(
      (await app.inject({ method: "POST", url: path, headers, payload: body })).statusCode,
    ).toBe(400);
  expect(service.markReady).not.toHaveBeenCalled();
  const result = await app.inject({ method: "POST", url: path, headers, payload: { lease } });
  expect(result.statusCode).toBe(200);
  expect(result.json().fencingVersion).toBe("9007199254740995");
});
it("serviceAuthFixedTenantReadyAndPersistedSourceAreRequiredBeforeWorkerDispatch", async () => {
  const { app, service } = setup();
  expect(
    (
      await app.inject({
        method: "POST",
        url: path,
        headers: { ...headers, "x-byclaw-internal-token": "wrong" },
        payload: { lease },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: path,
        headers: { ...headers, "x-enterprise-id": "11" },
        payload: { lease },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await setup(false).app.inject({ method: "POST", url: path, headers, payload: { lease } }))
      .statusCode,
  ).toBe(503);
  expect(
    (
      await app.inject({
        method: "POST",
        url: path.replace("group-chats/30/", "group-chats/99/"),
        headers,
        payload: { lease: { ...lease, sourceSessionId: "99" } },
      })
    ).statusCode,
  ).toBe(404);
  expect(service.markReady).not.toHaveBeenCalled();
});

it("maintenanceDiscoveryUsesServiceAuthWithoutInventedActorAndRejectsUnboundedPayload", async () => {
  const { app, service } = setup();
  const { "x-actor-user-id": _actor, ...serviceHeaders } = headers;
  const url = "/internal/v1/forward-maintenance/scan";
  const payload = { category: "DELIVERY", after: null, limit: 20 };
  expect(
    (await app.inject({ method: "POST", url, headers: serviceHeaders, payload })).statusCode,
  ).toBe(200);
  expect(service.recovery.scan).toHaveBeenCalledWith("DELIVERY", null, 20);
  expect(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { ...serviceHeaders, "x-byclaw-internal-token": "wrong" },
        payload,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url,
        headers: serviceHeaders,
        payload: { ...payload, actor: { userId: "0" } },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await setup(false).app.inject({ method: "POST", url, headers: serviceHeaders, payload }))
      .statusCode,
  ).toBe(503);
});
