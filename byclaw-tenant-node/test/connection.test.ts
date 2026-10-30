import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../src/application/connection-manager.js";
import { database, identity, snapshot } from "./fixtures.js";
function setup() {
  let value = snapshot();
  const db = database();
  const ports = {
    snapshot: vi.fn(async () => value),
    decrypt: vi.fn(async () => "test"),
    open: vi.fn(async () => db),
    readAuthority: vi.fn(async () => undefined),
    saveAuthority: vi.fn(async () => {}),
  };
  return {
    db,
    ports,
    manager: new ConnectionManager(identity, ports),
    change: (next: ReturnType<typeof snapshot>) => {
      value = next;
    },
  };
}
describe("connection authority", () => {
  it("refreshes private transport credentials and rebuilds a failed pool even when authority is unchanged", async () => {
    const s = setup();
    await s.manager.refresh();
    vi.mocked(s.db.verifyIdentity).mockRejectedValueOnce(new Error("transport expired"));
    await expect(s.manager.refresh()).rejects.toThrow("transport expired");
    expect(s.manager.connected).toBe(false);
    const replacement = database();
    s.ports.open.mockResolvedValueOnce(replacement);
    await s.manager.refresh();
    expect(s.ports.decrypt).toHaveBeenCalledTimes(2);
    expect(s.ports.open).toHaveBeenCalledTimes(2);
    expect(s.db.close).toHaveBeenCalledOnce();
    expect(s.manager.connected).toBe(true);
    expect(s.manager.database()).toBe(replacement);
    await s.manager.close();
  });

  it("starts ADMIN_ONLY and checks authority before commit", async () => {
    const s = setup();
    await s.manager.refresh();
    expect(s.manager.connected).toBe(true);
    expect(s.manager.ready).toBe(false);
    s.manager.setSchemaReady(true);
    await s.manager.write(async () => "ok");
    expect(s.ports.snapshot).toHaveBeenCalledTimes(4);
  });
  it.each([
    { generation: "8" },
    { dbSandboxRecordId: "81" },
    { credentialVersion: "0" },
    { leaseUntil: new Date(0).toISOString() },
  ])("stops on invalid authority %j", async (override) => {
    const s = setup();
    await s.manager.refresh();
    s.change(snapshot(override));
    await expect(s.manager.refresh()).rejects.toThrow();
    expect(s.manager.connected).toBe(false);
  });
  it("rejects work that loses authority after writing", async () => {
    const s = setup();
    await s.manager.refresh();
    s.manager.setSchemaReady(true);
    await expect(
      s.manager.write(async () => {
        s.change(snapshot({ fencingToken: "10" }));
      }),
    ).rejects.toThrow("AUTHORITY_CHANGED");
  });
  it("preserves the old pool if candidate verification fails", async () => {
    const s = setup();
    await s.manager.refresh();
    const candidate = database();
    vi.mocked(candidate.verifyIdentity).mockRejectedValue(new Error("unavailable"));
    s.ports.open.mockResolvedValue(candidate);
    s.change(snapshot({ credentialVersion: "2" }));
    await expect(s.manager.refresh()).rejects.toThrow();
    expect(candidate.close).toHaveBeenCalledOnce();
    expect(s.db.close).not.toHaveBeenCalled();
    expect(s.manager.ready).toBe(false);
  });
  it("rejects a captured old pool after rotation", async () => {
    const s = setup();
    await s.manager.refresh();
    const old = s.manager.database();
    s.ports.open.mockResolvedValue(database());
    s.change(snapshot({ credentialVersion: "2" }));
    await s.manager.refresh();
    await expect(s.manager.guard(old)).rejects.toThrow("AUTHORITY_CHANGED");
  });
  it("blocks writes while schema is upgrading", async () => {
    const s = setup();
    await s.manager.refresh();
    s.manager.setSchemaReady(true);
    s.manager.setSchemaBusy(true);
    await expect(s.manager.write(async () => {})).rejects.toThrow("TENANT_SCHEMA_UPGRADING");
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
  it("requires fresh schema verification after a task completes", async () => {
    const s = setup();
    await s.manager.refresh();
    s.manager.setSchemaReady(true);
    const revision = s.manager.schemaRevision;
    s.manager.setSchemaBusy(true);
    s.manager.setSchemaBusy(false);
    expect(s.manager.schemaRevision).toBeGreaterThan(revision);
    expect(s.manager.ready).toBe(false);
    await expect(s.manager.write(async () => {})).rejects.toThrow("NOT_READY");
    s.manager.setSchemaReady(true);
    expect(s.manager.ready).toBe(true);
  });
  it("invalidates schema verification only when the connection pool changes", async () => {
    const s = setup();
    await s.manager.refresh();
    s.manager.setSchemaReady(true);
    const revision = s.manager.schemaRevision;
    await s.manager.refresh();
    expect(s.manager.schemaRevision).toBe(revision);
    expect(s.manager.ready).toBe(true);
    s.ports.open.mockResolvedValue(database());
    s.change(snapshot({ credentialVersion: "2" }));
    await s.manager.refresh();
    expect(s.manager.schemaRevision).toBeGreaterThan(revision);
    expect(s.manager.ready).toBe(false);
  });
});
