import { describe, expect, it, vi } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import { command } from "./fixtures.js";
import { requireExecutionPolicy } from "../src/application/execution-policy.js";
import type { SharedQuota } from "../src/application/shared-quota.js";

/** Existing entitlement publication supplies access state without a new policy consumer protocol. */
function enabled(): SharedQuota {
  return {
    schemaVersion: 1, enterpriseId: "12", revision: "2", mode: "LIMITED",
    limits: { memberLimit: 2, groupLimit: 3, groupMemberLimit: 4, agentLimit: 5 },
    updatedAt: new Date().toISOString(), accessMode: "ENABLED",
    effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2999-01-01T00:00:00Z",
  };
}
const marker = { hget: async () => "true" };

describe("commercial execution policy", () => {
  it("allows an enabled commercial command through normal business authorization", async () => {
    const authorize = vi.fn(async () => {});
    const apply = vi.fn(async () => ({ committed: true }));
    const service = new CommandService(
      { run: async (work) => work({ lock: async () => {}, previous: async () => null,
        authorize, apply, record: async () => {} }) },
      () => requireExecutionPolicy(marker, "12", true, { read: async () => enabled() }),
    );
    await expect(service.execute(command())).resolves.toEqual({ committed: true });
    expect(authorize).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });
  it.each(["PREPARED", "SUSPENDED", "READ_ONLY"])("rejects %s before any business mutation", async (accessMode) => {
    const apply = vi.fn(async () => ({}));
    const service = new CommandService(
      { run: async (work) => work({ lock: async () => {}, previous: async () => null,
        authorize: async () => {}, apply, record: async () => {} }) },
      () => requireExecutionPolicy(marker, "12", true, {
        read: async () => ({ ...enabled(), accessMode }),
      }),
    );
    await expect(service.execute(command())).rejects.toMatchObject({ code: "POLICY_EXECUTION_DISABLED" });
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([
    { effectiveTo: "2020-01-01T00:00:00Z" },
    { effectiveFrom: "2999-01-01T00:00:00Z" },
    { effectiveFrom: "invalid" },
    { effectiveTo: undefined },
  ])("rejects ineffective or invalid time bounds", async (interval) => {
    await expect(requireExecutionPolicy(marker, "12", true, {
      read: async () => ({ ...enabled(), ...interval }),
    })).rejects.toMatchObject({ code: "POLICY_NOT_EFFECTIVE" });
  });
  it("keeps unmanaged deployments compatible without a policy read", async () => {
    const read = vi.fn(async () => null);
    await expect(requireExecutionPolicy({ hget: async () => null }, "12", false, { read })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it("requires state even when the managed instance marker disappears", async () => {
    await expect(requireExecutionPolicy({ hget: async () => null }, "12", true, {
      read: async () => null,
    })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });
  it("rejects another tenant's projection", async () => {
    await expect(requireExecutionPolicy(marker, "12", true, {
      read: async () => ({ ...enabled(), enterpriseId: "99" }),
    })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });
  it("rechecks access state on each command", async () => {
    const read = vi.fn().mockResolvedValueOnce(enabled())
      .mockResolvedValueOnce({ ...enabled(), accessMode: "SUSPENDED" });
    await expect(requireExecutionPolicy(marker, "12", true, { read })).resolves.toBeUndefined();
    await expect(requireExecutionPolicy(marker, "12", true, { read }))
      .rejects.toMatchObject({ code: "POLICY_EXECUTION_DISABLED" });
  });
  it("fails closed on projection read failure", async () => {
    await expect(requireExecutionPolicy({ hget: async () => { throw new Error("offline"); } }, "12", true,
      { read: async () => enabled() })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    await expect(requireExecutionPolicy(marker, "12", true,
      { read: async () => { throw new Error("offline"); } })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });
});
