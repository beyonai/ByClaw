import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  registered: false,
  register: vi.fn(),
  unregister: vi.fn(),
  initialize: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  release: vi.fn(),
  workerOptions: undefined as any,
  runnerOptions: undefined as any,
  finish: (() => {}) as () => void,
}));
vi.mock("@byclaw/by-framework", () => ({
  AgentState: { COMPLETED: "COMPLETED", FAILED: "FAILED" },
  ServiceRegistry: class {
    isRegistered() {
      return fake.registered;
    }
    async register(value: unknown) {
      fake.register(value);
      fake.registered = true;
    }
    async unregister() {
      fake.unregister();
      fake.registered = false;
    }
  },
  WorkerRegistry: class {},
  AnonymousWorker: class {
    constructor(options: unknown) {
      fake.workerOptions = options;
    }
  },
  WorkerRunner: class {
    health = "normal";
    initialize = fake.initialize;
    release = fake.release;
    isHealthy() {
      return true;
    }
    start(options: unknown) {
      fake.start(options);
      return new Promise<void>((resolve) => {
        fake.finish = resolve;
      });
    }
    stop() {
      fake.stop();
      fake.finish();
    }
    constructor(_worker: unknown, options: unknown) {
      fake.runnerOptions = options;
    }
  },
  ensureJsonSerializable: (value: unknown) => value,
}));
import { Discovery } from "../src/infrastructure/discovery/by-framework-discovery.js";
import { TenantWorker } from "../src/infrastructure/discovery/tenant-worker.js";
import { config, identity, command } from "./fixtures.js";
beforeEach(() => {
  vi.clearAllMocks();
  fake.registered = false;
});
describe("generation-bound discovery and actual Worker", () => {
  it("registers management capability only after database availability", async () => {
    const discovery = new Discovery({} as any, config);
    await discovery.update(false, false, null);
    expect(fake.register).not.toHaveBeenCalled();
    await discovery.update(true, false, null);
    expect(fake.register.mock.calls[0]?.[0]).toMatchObject({
      serviceName: "TENANT_DATA_10",
      metadata: {
        generation: "7",
        dbSandboxRecordId: "80",
        mode: "ADMIN_ONLY",
        endpoint: "https://node.test:3100",
      },
    });
    await discovery.close();
  });
  it("republishes the READY metadata and withdraws on failure", async () => {
    const discovery = new Discovery({} as any, config);
    await discovery.update(true, false, null);
    await discovery.update(true, true, "S1");
    expect(fake.register).toHaveBeenCalledTimes(2);
    await discovery.update(false, false, null);
    expect(discovery.active).toBe(false);
  });
  it("starts an actual SDK runner with explicit Redis ownership and clean shutdown", async () => {
    const redis = {} as any,
      services = {
        ready: () => false,
        schemaState: () => ({ observedVersion: null }),
        commands: {},
        history: {},
        schema: {},
      };
    const worker = new TenantWorker(redis, config, services as any);
    await worker.update(true);
    expect(fake.workerOptions.agentTypes).toEqual(["TENANT_DATA_10"]);
    expect(fake.runnerOptions.redisClient).toBe(redis);
    expect(fake.start).toHaveBeenCalledWith({ initialize: false, handleSignals: false });
    expect(
      await fake.workerOptions.onTask({
        header: {},
        content: { protocolVersion: 1, ...identity, kind: "GET_SCHEMA" },
      }),
    ).toEqual({ status: "COMPLETED", replyData: { ok: true, result: { observedVersion: null } } });
    const denied = await fake.workerOptions.onTask({
      header: { userCode: "20" },
      content: { protocolVersion: 1, ...identity, kind: "COMMAND", command: command() },
    });
    expect(denied).toMatchObject({
      status: "FAILED",
      replyData: { ok: false, error: { code: "NOT_READY" } },
    });
    await worker.close();
    expect(fake.stop).toHaveBeenCalledOnce();
    expect(worker.active).toBe(false);
  });
});
