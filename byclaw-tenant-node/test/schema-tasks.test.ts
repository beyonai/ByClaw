import { describe, expect, it, vi } from "vitest";
import { SchemaTaskService } from "../src/application/schema/task-service.js";
import { SchemaTaskRunner } from "../src/application/schema/task-runner.js";
import type { SchemaResult, SchemaPorts, SchemaMarker } from "../src/application/schema/types.js";
import { DomainError } from "../src/domain/errors.js";
import { task, manifest } from "./fixtures.js";
function setup() {
  const records = new Map<string, SchemaResult>();
  let marker: SchemaMarker | null = null;
  const execution = {
    marker: vi.fn(async () => marker),
    empty: vi.fn(async () => true),
    verify: vi.fn(async () => {}),
    execute: vi.fn(async (_sql, next: SchemaMarker) => {
      marker = next;
    }),
  };
  const ports: SchemaPorts = {
    validate: vi.fn(async (t) =>
      t.scripts.map((script) => ({
        script,
        manifest: { ...manifest(), version: script.version, parentVersion: script.parentVersion },
        statements: ["CREATE TABLE byai.t(id bigint)"],
      })),
    ),
    saveBundle: vi.fn(async () => {}),
    loadBundle: vi.fn(async () => Buffer.from("zip")),
    read: vi.fn(async (id) => records.get(id)),
    save: vi.fn(async (r) => {
      records.set(r.task.auditId, structuredClone(r));
    }),
    list: vi.fn(async () => [...records.values()]),
    cleanup: vi.fn(async () => {}),
    locked: vi.fn(async (work) => work(execution)),
    authorize: vi.fn(async () => {}),
    currentVersion: vi.fn(async () => null),
    report: vi.fn(async () => {}),
    busy: vi.fn(),
  };
  return {
    ports,
    records,
    execution,
    service: new SchemaTaskService(ports),
    runner: new SchemaTaskRunner(ports),
    marker: (next: SchemaMarker) => {
      marker = next;
    },
  };
}
const result = (): SchemaResult => ({
  task: task(),
  status: "PENDING",
  observedVersion: null,
  acceptedAt: new Date().toISOString(),
  cleanupStatus: "RETAINED_UNTIL_ACK",
  steps: [],
});
describe("durable schema tasks", () => {
  it("persists the bundle and receipt before returning PENDING", async () => {
    const s = setup();
    const accepted = await s.service.accept(task(), Buffer.from("zip"));
    expect(accepted.status).toBe("PENDING");
    expect(s.ports.saveBundle).toHaveBeenCalledOnce();
    await s.service.drain();
    expect(s.records.get("audit-s1")?.status).toBe("VERIFIED");
    expect(s.execution.execute).toHaveBeenCalledOnce();
    expect(s.execution.verify).toHaveBeenCalledOnce();
  });
  it("does not execute duplicate accepted tasks and ignores JSON key order", async () => {
    const s = setup(),
      t = task();
    await s.service.accept(t, Buffer.from("zip"));
    await s.service.drain();
    const reordered = Object.fromEntries(Object.entries(t).reverse());
    await s.service.accept(reordered as any, Buffer.from("zip"));
    expect(s.execution.execute).toHaveBeenCalledOnce();
    await expect(
      s.service.accept({ ...t, targetVersion: "S2" }, Buffer.from("zip")),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("rejects a second concurrent task", async () => {
    const s = setup();
    s.records.set("existing", { ...result(), task: task({ auditId: "existing" }) });
    await expect(s.service.accept(task(), Buffer.from("zip"))).rejects.toThrow(
      "SCHEMA_TASK_IN_PROGRESS",
    );
  });
  it("rejects INIT over existing business objects", async () => {
    const s = setup(),
      r = result();
    s.execution.empty.mockResolvedValue(false);
    await s.runner.run(r);
    expect(r.status).toBe("NEEDS_ATTENTION");
    expect(s.execution.execute).not.toHaveBeenCalled();
  });
  it("checks authoritative audit version inside the lock", async () => {
    const s = setup(),
      r = result();
    vi.mocked(s.ports.currentVersion).mockResolvedValue("S9");
    await s.runner.run(r);
    expect(r.errorCode).toBe("SCHEMA_AUDIT_MISMATCH");
    expect(s.execution.execute).not.toHaveBeenCalled();
  });
  it("retains uncertain commits for reconciliation and sanitizes errors", async () => {
    const s = setup(),
      r = result();
    s.execution.execute.mockRejectedValue(new DomainError("COMMIT_UNCERTAIN"));
    await s.runner.run(r);
    expect(r.status).toBe("RECONCILING");
    expect(s.ports.cleanup).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("password");
  });
  it("rejects a new INIT over an already initialized database", async () => {
    const s = setup(),
      r = result();
    s.marker({
      protocolVersion: 1,
      enterpriseId: "10",
      version: "S1",
      scriptDigest: r.task.scripts[0]!.sha256,
      catalogDigest: manifest().catalogDigest,
    });
    await s.runner.run(r);
    expect(r.status).toBe("NEEDS_ATTENTION");
    expect(s.execution.execute).not.toHaveBeenCalled();
  });
  it("resumes after a committed marker without replaying SQL", async () => {
    const s = setup(),
      r = result();
    r.status = "RECONCILING";
    s.marker({
      protocolVersion: 1,
      enterpriseId: "10",
      version: "S1",
      scriptDigest: r.task.scripts[0]!.sha256,
      catalogDigest: manifest().catalogDigest,
    });
    await s.runner.run(r);
    expect(r.status).toBe("VERIFIED");
    expect(s.execution.verify).toHaveBeenCalledOnce();
    expect(s.execution.execute).not.toHaveBeenCalled();
  });
  it("keeps a failed bundle until BE stores its report", async () => {
    const s = setup(),
      r = result();
    s.execution.execute.mockRejectedValue(
      Object.assign(new Error("secret SQL/password"), { code: "23505" }),
    );
    vi.mocked(s.ports.report).mockRejectedValue(new Error("offline"));
    await s.runner.run(r);
    expect(r.status).toBe("FAILED");
    expect(r.sqlState).toBe("23505");
    expect(r.failureReason).toBe("TENANT_DDL_EXECUTION_FAILED");
    expect(s.ports.cleanup).not.toHaveBeenCalled();
    vi.mocked(s.ports.report).mockResolvedValue();
    await s.runner.deliver(r);
    expect(s.ports.cleanup).toHaveBeenCalledOnce();
  });
  it("cleans VERIFIED artifacts even when the callback is offline", async () => {
    const s = setup(),
      r = result();
    vi.mocked(s.ports.report).mockRejectedValue(new Error("offline"));
    await s.runner.run(r);
    expect(r.status).toBe("VERIFIED");
    expect(r.reported).toBe(false);
    expect(s.ports.cleanup).toHaveBeenCalledOnce();
  });
  it("does not unblock an active upgrade when retrying an old report", async () => {
    const s = setup(),
      r = result();
    r.status = "VERIFIED";
    await s.runner.deliver(r);
    expect(s.ports.busy).not.toHaveBeenCalledWith(false);
  });
  it("recovers unfinished tasks and validates report acknowledgements", async () => {
    const s = setup(),
      r = result();
    s.records.set(r.task.auditId, r);
    await s.service.recover();
    await s.service.drain();
    await expect(s.service.acknowledge(r.task.auditId, 2, "VERIFIED")).rejects.toThrow(
      "INVALID_REPORT_ACK",
    );
    await s.service.acknowledge(r.task.auditId, 1, "VERIFIED");
  });
});
