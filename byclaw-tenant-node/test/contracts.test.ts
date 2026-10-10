import { describe, expect, it } from "vitest";
import { commandHash, validateTenantCommand } from "../src/interfaces/contracts/command.js";
import { mirrorHash, validateMirror } from "../src/interfaces/contracts/mirror.js";
import { validateSchemaTask } from "../src/interfaces/contracts/schema-task.js";
import { canonical } from "../src/domain/json.js";
import { command, event, identity, task } from "./fixtures.js";
describe("protocol contracts", () => {
  it("hashes independently of JSON key order", () => {
    expect(canonical({ z: [1, { b: 2, a: 1 }], a: "中" })).toBe(
      canonical({ a: "中", z: [1, { a: 1, b: 2 }] }),
    );
  });
  it("keeps business hashes stable across authority changes", () => {
    expect(commandHash(command())).toBe(
      commandHash(
        command({ generation: "8", dbSandboxRecordId: "81", tenantMemberUserIds: ["20"] }),
      ),
    );
    expect(mirrorHash(event())).toBe(
      mirrorHash(event({ generation: "8", dbSandboxRecordId: "81" })),
    );
  });
  it("accepts canonical large IDs as strings", () => {
    expect(
      validateTenantCommand(command({ sessionId: "9007199254740993" }), identity).sessionId,
    ).toBe("9007199254740993");
  });
  it.each([
    { enterpriseId: "11" },
    { generation: "8" },
    { dbSandboxRecordId: "81" },
    { sessionId: "030" },
    { sessionId: 30 },
  ])("rejects mismatched or unsafe IDs %j", (override) => {
    expect(() => validateTenantCommand(command(override as any), identity)).toThrow();
  });
  it("requires the trusted actor and active membership assertion", () => {
    expect(() => validateTenantCommand(command(), identity, "21")).toThrow(
      "COMMAND_CONTEXT_MISMATCH",
    );
    expect(() =>
      validateTenantCommand(command({ tenantMemberUserIds: ["21"] }), identity),
    ).toThrow();
  });
  it("detects mutation after hashing", () => {
    const e = event();
    e.payload.text = "tampered";
    expect(() => validateMirror(e, identity)).toThrow("HASH_MISMATCH");
  });
  it("requires a terminal snapshot and relation ID", () => {
    expect(() => validateMirror(event({ eventType: "TERMINAL" }), identity)).toThrow();
    expect(
      validateMirror(
        event({
          eventType: "TERMINAL",
          payload: { id: "201", relationId: "202", messageContent: "full" },
        }),
        identity,
      ).eventType,
    ).toBe("TERMINAL");
  });
  it("validates the complete version chain and permits dotted versions", () => {
    const t = task({
      targetVersion: "V0.5.0",
      scripts: [
        {
          version: "V0.5.0",
          parentVersion: null,
          path: "baseline/V0.5.0/__ddl.sql",
          sha256: "b".repeat(64),
        },
      ],
    });
    expect(validateSchemaTask(t, identity)).toEqual(t);
    t.scripts[0]!.path = "../__ddl.sql";
    expect(() => validateSchemaTask(t, identity)).toThrow();
  });
  it("parses expired tasks for idempotent lookup, leaving expiry to acceptance", () => {
    expect(
      validateSchemaTask(task({ deadline: new Date(0).toISOString() }), identity),
    ).toBeDefined();
  });
  it("rejects broken parents and alternate upload directories", () => {
    const t = task();
    t.scripts[0]!.parentVersion = "S0";
    expect(() => validateSchemaTask(t, identity)).toThrow("INVALID_VERSION_CHAIN");
    expect(() =>
      validateSchemaTask(
        task({ scripts: [{ ...task().scripts[0]!, path: "versions/S1/__ddl.sql" }] }),
        identity,
      ),
    ).toThrow();
  });
});
