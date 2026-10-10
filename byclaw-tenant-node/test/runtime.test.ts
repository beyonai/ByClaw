import { describe, expect, it, vi } from "vitest";
import { TenantRuntime } from "../src/application/runtime.js";
import type { ConnectionManager } from "../src/application/connection-manager.js";
import type { SchemaTaskService } from "../src/application/schema/task-service.js";
function setup() {
  const connection = {
    connected: true,
    ready: false,
    provisioned: false,
    upgrading: false,
    refresh: vi.fn(async () => {}),
    setSchemaReady: vi.fn(),
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
  const ports = {
    checkSchema: vi.fn(async () => {}),
    schemaState: () => ({ observedVersion: null, auditedVersion: null, verified: false }),
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
    runtime: new TenantRuntime(
      connection as unknown as ConnectionManager,
      tasks as unknown as SchemaTaskService,
      ports,
    ),
  };
}
describe("runtime lifecycle", () => {
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
});
