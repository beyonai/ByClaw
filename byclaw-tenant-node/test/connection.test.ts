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
});
