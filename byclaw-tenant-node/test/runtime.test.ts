import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantRuntime } from "../src/application/runtime.js";
import type { ConnectionManager } from "../src/application/connection-manager.js";
import type { SchemaTaskService } from "../src/application/schema/task-service.js";
import { DomainError } from "../src/domain/errors.js";
function setup() {
  const connection = {
    connected: true,
    ready: false,
    provisioned: false,
    upgrading: false,
    schemaRevision: 0,
    refresh: vi.fn(async () => {}),
    setSchemaReady: vi.fn((value: boolean) => {
      connection.ready = value;
      connection.provisioned = value;
    }),
  };
  const tasks = {
    recover: vi.fn(async () => {}),
    retryReports: vi.fn(async () => {}),
    reconcile: vi.fn(async () => {}),
    drain: vi.fn(async () => {}),
  };
  const lifecycle = () => ({
    active: true,
    update: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  });
  const state = { observedVersion: null, auditedVersion: null, verified: false };
  const ports = {
    checkSchema: vi.fn(async () => {
      connection.setSchemaReady(state.verified);
    }),
    schemaState: () => state,
    worker: lifecycle(),
    discovery: lifecycle(),
    streams: {
      active: false,
      initialized: true,
      metrics: [],
      start: vi.fn(async () => {}),
      sample: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    },
    warn: vi.fn(),
  };
  return {
    connection,
    tasks,
    ports,
    state,
    runtime: new TenantRuntime(
      connection as unknown as ConnectionManager,
      tasks as unknown as SchemaTaskService,
      ports,
    ),
  };
}
describe("runtime lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  it("registers ADMIN_ONLY even if schema audit is temporarily offline", async () => {
    const s = setup();
    s.ports.checkSchema.mockRejectedValue(new Error("BE offline"));
    await s.runtime.reconcile();
    expect(s.ports.worker.update).toHaveBeenCalledWith(true);
    expect(s.ports.discovery.update).toHaveBeenCalledWith(true, false, null);
    expect(s.runtime.ready).toBe(false);
  });
  it("withdraws discovery and worker when database authority fails", async () => {
    const s = setup();
    s.connection.refresh.mockImplementation(async () => {
      s.connection.connected = false;
      throw new Error("offline");
    });
    await s.runtime.reconcile();
    expect(s.ports.worker.close).toHaveBeenCalledOnce();
    expect(s.ports.discovery.close).toHaveBeenCalledOnce();
  });
  it("recovers tasks once and serializes overlapping reconciliation", async () => {
    const s = setup();
    await Promise.all([s.runtime.reconcile(), s.runtime.reconcile()]);
    expect(s.connection.refresh).toHaveBeenCalledOnce();
    await s.runtime.reconcile();
    expect(s.tasks.recover).toHaveBeenCalledOnce();
  });
  it("reports provisioning readiness before BE publishes READY", () => {
    const s = setup();
    s.connection.provisioned = true;
    expect(s.runtime.provisioned).toBe(true);
    expect(s.runtime.ready).toBe(false);
  });
  it("stops consumers and drains schema tasks", async () => {
    const s = setup();
    await s.runtime.stop();
    expect(s.ports.streams.close).toHaveBeenCalledOnce();
    expect(s.tasks.drain).toHaveBeenCalledOnce();
    expect(s.runtime.provisioned).toBe(false);
  });
  it("keeps five-second runtime ticks but checks a verified schema once per minute", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.state.verified = true;
    await s.runtime.start();
    await vi.advanceTimersByTimeAsync(55000);
    expect(s.ports.checkSchema).toHaveBeenCalledOnce();
    expect(s.connection.refresh).toHaveBeenCalledTimes(12);
    expect(s.tasks.retryReports).toHaveBeenCalledTimes(12);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(2);
    await s.runtime.stop();
  });
  it("backs off failed verification to five minutes and keeps business unavailable", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.ports.checkSchema.mockRejectedValue(new Error("BE offline"));
    await s.runtime.start();
    let attempts = 1;
    for (const delay of [10000, 20000, 40000, 80000, 160000, 300000, 300000]) {
      await vi.advanceTimersByTimeAsync(delay - 5000);
      expect(s.ports.checkSchema).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(5000);
      expect(s.ports.checkSchema).toHaveBeenCalledTimes(++attempts);
    }
    expect(s.ports.warn).toHaveBeenCalledTimes(attempts);
    expect(s.connection.setSchemaReady).toHaveBeenLastCalledWith(false);
    expect(s.runtime.ready).toBe(false);
    await s.runtime.stop();
  });
  it("retries authentication failures every five minutes with a specific diagnostic", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.ports.checkSchema.mockRejectedValue(new DomainError("UPSTREAM_AUTHENTICATION_FAILED"));
    await s.runtime.start();
    await vi.advanceTimersByTimeAsync(295000);
    expect(s.ports.checkSchema).toHaveBeenCalledOnce();
    expect(s.ports.warn).toHaveBeenCalledExactlyOnceWith("SCHEMA_AUTHENTICATION_FAILED");
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(2);
    await s.runtime.stop();
  });
  it("rechecks a new connection revision without waiting for authentication backoff", async () => {
    const s = setup();
    s.ports.checkSchema.mockRejectedValueOnce(new DomainError("UPSTREAM_AUTHENTICATION_FAILED"));
    await s.runtime.reconcile();
    s.connection.schemaRevision++;
    await s.runtime.reconcile();
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(2);
  });
  it("rechecks after a schema task even if the task starts and finishes between ticks", async () => {
    const s = setup();
    s.state.verified = true;
    await s.runtime.reconcile();
    s.connection.upgrading = true;
    s.connection.schemaRevision++;
    await s.runtime.reconcile();
    expect(s.ports.checkSchema).toHaveBeenCalledOnce();
    s.connection.upgrading = false;
    s.connection.schemaRevision++;
    await s.runtime.reconcile();
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(2);
  });
  it("resets failure backoff after successful verification", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.ports.checkSchema.mockRejectedValueOnce(new Error("BE offline"));
    await s.runtime.start();
    s.state.verified = true;
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(2);
    expect(s.connection.ready).toBe(true);
    s.ports.checkSchema.mockRejectedValueOnce(new Error("BE offline again"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(3);
    expect(s.connection.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.connection.ready).toBe(false);
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.ports.checkSchema).toHaveBeenCalledTimes(4);
    expect(s.connection.ready).toBe(true);
    await s.runtime.stop();
  });
});
