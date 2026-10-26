import { describe, expect, it } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import { command } from "./fixtures.js";
import { requireExecutionPolicy } from "../src/application/execution-policy.js";

describe("commercial execution policy", () => {
  it("denies a worker command before any business mutation", async () => {
    let mutated = false;
    const service = new CommandService(
      {
        run: async (work) =>
          work({
            lock: async () => {},
            previous: async () => null,
            authorize: async () => {},
            apply: async () => {
              mutated = true;
              return {};
            },
            record: async () => {},
          }),
      },
      () => requireExecutionPolicy({ hget: async () => "true" }, "12", true),
    );
    await expect(service.execute(command())).rejects.toMatchObject({
      code: "POLICY_CAPABILITY_UNSUPPORTED",
    });
    expect(mutated).toBe(false);
  });
  it("blocks commercially managed writes until quota consumers are implemented", async () => {
    await expect(requireExecutionPolicy({ hget: async () => "true" }, "12")).rejects.toMatchObject({
      code: "POLICY_CAPABILITY_UNSUPPORTED",
    });
  });
  it("does not admit a managed instance after its Redis marker disappears", async () => {
    await expect(
      requireExecutionPolicy({ hget: async () => null }, "12", true),
    ).rejects.toMatchObject({ code: "POLICY_CAPABILITY_UNSUPPORTED" });
  });
  it("keeps existing unmanaged deployments compatible", async () => {
    await expect(requireExecutionPolicy({ hget: async () => null }, "12")).resolves.toBeUndefined();
  });
  it("fails closed on projection loss instead of falling back to legacy", async () => {
    await expect(
      requireExecutionPolicy(
        {
          hget: async () => {
            throw new Error("offline");
          },
        },
        "12",
      ),
    ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });
});
