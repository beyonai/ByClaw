import { canonicalHash } from "../src/interfaces/contracts/group-forward.js";
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  freezeSource,
  normalizeInput,
  projectText,
} from "../src/application/group-forward-snapshot.js";
import type {
  SourceMessage,
  ForwardOperation,
  OperationResponse,
  ForwardState,
} from "../src/application/group-forward-types.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../byclaw-qa/fixtures/group-chat-forward/v1.json", import.meta.url),
    "utf8",
  ),
);
const actor = fixture.actor;
const messages = (): SourceMessage[] => structuredClone(fixture.messages);
describe("forward contracts", () => {
  it("reorderedIdsHaveSameHash", () => {
    expect(canonicalHash(actor, "30", fixture.input)).toBe(fixture.canonicalHash);
    expect(
      canonicalHash(actor, "30", {
        ...fixture.input,
        messageIds: ["1001", "1002"],
        targetSessionIds: ["2001", "2002"],
      }),
    ).toBe(fixture.canonicalHash);
  });
  it("preservesOpaqueReferenceKeysPerItem", () => {
    const source = messages();
    const frozen = freezeSource(actor, "30", source.reverse());
    expect(frozen.selectedMessageIds).toEqual(["9007199254740993", "9007199254740994"]);
    expect(frozen.items[0]!.resourceList[0]!.id).toBe("KG_DOC_FILE_xxx");
    expect(frozen.items[0]!.resourceList[1]!.id).toBe("HUMAN_20");
    expect(frozen.items[1]!.resourceList[0]!.resourceName).toBe("另一条名称");
    expect(JSON.stringify(frozen.items)).not.toMatch(/resourceCode|extData/);
    expect(projectText(frozen.items[0]!)).toBe("预算$\\终稿 旧名字 {{text}}");
    source[1]!.resourceList[0]!.resourceName = "changed";
    expect(frozen.items[0]!.resourceList[0]!.resourceName).toBe("预算$\\终稿");
    expect(Object.isFrozen(frozen.candidates[0]!.locatorCandidate)).toBe(true);
  });
  it("copiesOrFlattensExistingCard", () => {
    const ordinary = messages()[0]!;
    const card = {
      ...messages()[1]!,
      mergedItems: [
        { ...ordinary, sourceKey: "archived:0" },
        { ...ordinary, id: "1003", sourceKey: "archived:1" },
      ],
    };
    const frozen = freezeSource(actor, "30", [ordinary, card]);
    expect(frozen.items.map((item) => [item.selectedMessageId, item.selectedMergedCard])).toEqual([
      [ordinary.id, false],
      [card.id, true],
      [card.id, true],
    ]);
    const one = freezeSource(actor, "30", [{ ...card, mergedItems: [ordinary] }]);
    expect(one.items[0]!.selectedMergedCard).toBe(true);
    expect(frozen.candidates.map((c) => c.selectedMessageId)).toEqual([
      ordinary.id,
      card.id,
      card.id,
    ]);
  });
  it("rejects unsafe IDs and unknown client fields", () => {
    for (const id of ["0", "-1", "01", "9223372036854775808", 9007199254740992]) {
      expect(() => normalizeInput({ ...fixture.input, messageIds: [id] })).toThrow(
        "FORWARD_INVALID_REQUEST",
      );
    }
    for (const field of ["content", "speaker", "fileUrl", "metadata", "enterpriseId"]) {
      expect(() => normalizeInput({ ...fixture.input, [field]: {} })).toThrow(
        "FORWARD_INVALID_REQUEST",
      );
    }
    expect(() => normalizeInput({ ...fixture.input, clientRequestId: "bad request" })).toThrow();
    expect(() =>
      normalizeInput({
        ...fixture.input,
        messageIds: Array.from({ length: 101 }, (_, i) => String(i + 1)),
      }),
    ).toThrow();
    expect(() =>
      normalizeInput({
        ...fixture.input,
        targetSessionIds: Array.from({ length: 11 }, (_, i) => String(i + 1)),
      }),
    ).toThrow();
  });
  it("deduplicates identical references but rejects conflicting origins", () => {
    const source = messages()[0]!;
    source.resourceList.push(structuredClone(source.resourceList[0]!));
    expect(freezeSource(actor, "30", [source]).items[0]!.resourceList).toHaveLength(2);
    source.resourceList[2]!.resourceCode = "another-dataset";
    expect(() => freezeSource(actor, "30", [source])).toThrow("FORWARD_REFERENCE_CONFLICT");
  });
  it("rejects missing recognized references and counts UTF-8 bytes", () => {
    const source = messages()[0]!;
    source.resourceList = [];
    expect(() => freezeSource(actor, "30", [source])).toThrow("FORWARD_RESOURCE_UNRESOLVABLE");
    source.content = "中".repeat(350000);
    expect(() => freezeSource(actor, "30", [source])).toThrow("FORWARD_SNAPSHOT_TOO_LARGE");
    source.content = "{{text}}";
    expect(freezeSource(actor, "30", [source]).items[0]!.content).toBe("{{text}}");
  });
  it("keeps non-file resources passive and freezes uploaded candidates separately", () => {
    const source = messages()[0]!;
    source.content = "{{COMMON_FOLDER_path}}";
    source.resourceList = [
      {
        id: "COMMON_FOLDER_path",
        resourceId: "path",
        resourceType: "COMMON_FOLDER",
        resourceName: "目录",
      },
    ];
    source.relatedResources = { files: [{ fileId: "501", fileName: "report.pdf" }] };
    source.metadata = { files: [{ fileId: "502", fileName: "result.pdf" }] };
    const result = freezeSource(actor, "30", [source]);
    expect(result.candidates.map((c) => c.kind)).toEqual(["UPLOADED_FILE", "UPLOADED_FILE"]);
    expect(result.items[0]!.resourceList[0]!).not.toHaveProperty("targetAttachmentId");
  });
  it("accepts exact limits and rejects expanded-card overflow", () => {
    const input = normalizeInput({
      ...fixture.input,
      messageIds: Array.from({ length: 100 }, (_, i) => String(i + 1)),
      targetSessionIds: Array.from({ length: 10 }, (_, i) => String(i + 1)),
    });
    expect(input.messageIds).toHaveLength(100);
    expect(input.targetSessionIds).toHaveLength(10);
    const normal = messages()[0]!;
    const hundred = Array.from({ length: 100 }, (_, i) => ({
      ...normal,
      id: String(i + 1),
      timelineOrdinal: i,
    }));
    expect(freezeSource(actor, "30", hundred).items).toHaveLength(100);
    expect(() =>
      freezeSource(actor, "30", [
        { ...normal, mergedItems: [...hundred, { ...normal, id: "101" }] },
      ]),
    ).toThrow("FORWARD_TOO_MANY_ITEMS");
  });
  it("preserves server context for later authoritative resolution of ordinary uploaded copies", () => {
    const source = messages()[0]!;
    source.metadata = {
      workspaceOwnerId: "99",
      files: [{ fileId: "501", fileName: "copied.pdf" }],
    };
    const frozen = freezeSource(actor, "30", [source]);
    expect(frozen.candidates[0]!.locatorCandidate).toEqual({});
    expect(frozen.candidates[1]!.kind).toBe("UPLOADED_FILE");
    expect(JSON.stringify(frozen.items)).not.toContain("workspaceOwnerId");
  });

  it("maps existing runtime resource types only when the body uses their legacy key", () => {
    const source = messages()[0]!;
    source.content = "{{DATA_SOURCE_ds}} {{MCP_TOOL_mt}}";
    source.resourceList = [
      { resourceType: "DATA_SOURCE", resourceId: "ds", resourceName: "数据源" },
      { resourceType: "MCP_TOOL", resourceId: "mt", resourceName: "工具" },
    ];
    const frozen = freezeSource(actor, "30", [source]);
    expect(frozen.items[0]!.resourceList.map((r) => r.id)).toEqual([
      "DATA_SOURCE_ds",
      "MCP_TOOL_mt",
    ]);
    expect(frozen.candidates).toHaveLength(0);
  });
  it("rejects non-text modes instead of coercing JSON arrays", () => {
    expect(() => normalizeInput({ ...fixture.input, mode: ["SINGLE"] })).toThrow(
      "FORWARD_INVALID_REQUEST",
    );
  });
  it("projects only public speaker fields from enriched runtime messages", () => {
    const source = messages()[0]!;
    const enriched = {
      ...source.speaker,
      execution: { resourceCode: "private-dataset", extData: { ownerId: "99" } },
    };
    source.speaker = enriched;
    const frozen = freezeSource(actor, "30", [source]);
    expect(frozen.items[0]!.speaker).toEqual({ type: "USER", id: "20", name: "张三" });
    expect(JSON.stringify(frozen.items)).not.toMatch(
      /execution|resourceCode|extData|private-dataset/,
    );
  });
  it("does not freeze caller-owned nested speaker metadata", () => {
    const source = messages()[0]!;
    const execution = { resourceCode: "private-dataset", extData: { ownerId: "99" } };
    const enriched = { ...source.speaker, execution };
    source.speaker = enriched;
    const frozen = freezeSource(actor, "30", [source]);
    expect(Object.isFrozen(execution)).toBe(false);
    expect(Object.isFrozen(execution.extData)).toBe(false);
    execution.extData.ownerId = "100";
    expect(execution.extData.ownerId).toBe("100");
    expect(Object.isFrozen(frozen.items[0]!.speaker)).toBe(true);
  });
  it("represents aggregate running and partial failure independently of branch state", () => {
    expectTypeOf<ForwardOperation["state"]>().toEqualTypeOf<
      "RUNNING" | "SUCCEEDED" | "PARTIAL_FAILED" | "FAILED"
    >();
    expectTypeOf<ForwardState>().toEqualTypeOf<
      "PENDING" | "COPYING" | "READY" | "SUCCEEDED" | "FAILED"
    >();
    const running: ForwardOperation = { requestId: "501", state: "RUNNING", targets: [] };
    const partial: OperationResponse = { requestId: "501", state: "PARTIAL_FAILED", targets: [] };
    expect(JSON.parse(JSON.stringify(running))).toEqual({
      requestId: "501",
      state: "RUNNING",
      targets: [],
    });
    expect(JSON.parse(JSON.stringify(partial))).toEqual({
      requestId: "501",
      state: "PARTIAL_FAILED",
      targets: [],
    });
  });
});

it("untyped file hints reach resolution and candidate JSON excludes raw secrets", () => {
  const result = freezeSource({ userId: "20", enterpriseId: "10" }, "30", [
    {
      id: "31",
      timelineOrdinal: 0,
      content: "{{KG_DOC_FILE_opaque}}",
      speaker: { type: "USER", id: "21", name: "sender" },
      createdAt: "2026-10-16T00:00:00Z",
      resourceList: [
        {
          id: "KG_DOC_FILE_opaque",
          resourceId: "opaque",
          resourceName: "label",
          resourceCode: "secret",
        },
      ],
      metadata: { token: "secret" },
      relatedResources: {},
      mergedItems: [],
    },
  ]);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.kind).toBe("UNRESOLVED_REFERENCE");
  expect(JSON.stringify(result.candidates)).not.toContain("secret");
});
