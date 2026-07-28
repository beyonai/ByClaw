import { describe, expect, it } from "vitest";
import { AttachmentInputError } from "@byclaw/by-conductor";
import { commandSourceAgentId, extractUserInput } from "../worker/by-framework-protocol.js";

describe("extractUserInput", () => {
  it("reads message from a plain string content with no attachments", () => {
    expect(extractUserInput("  hi  ")).toEqual({ message: "hi", attachments: [] });
  });

  it("reads text and files from the last user message together", () => {
    const result = extractUserInput([
      { role: "assistant", content: { text: "previous answer" } },
      {
        role: "user",
        content: {
          text: "请分析附件",
          files: [
            { fileId: "123", fileName: "report.xlsx", fileSize: 1024, fileIp: "10.0.0.1" },
          ],
        },
      },
    ]);
    expect(result.message).toBe("请分析附件");
    expect(result.attachments).toEqual([
      {
        id: "123",
        name: "report.xlsx",
        size: 1024,
        provenance: "by-framework",
      },
    ]);
  });

  it("keeps attachments even when text is empty (attachments-only)", () => {
    const result = extractUserInput([
      { role: "user", content: { files: [{ fileId: "9", fileName: "a.txt" }] } },
    ]);
    expect(result.message).toBe("");
    expect(result.attachments).toHaveLength(1);
  });

  it("throws when files is present but malformed", () => {
    expect(() =>
      extractUserInput([{ role: "user", content: { text: "x", files: "not-an-array" } }]),
    ).toThrow(AttachmentInputError);
  });

  it("picks the last user message when multiple exist", () => {
    const result = extractUserInput([
      { role: "user", content: { text: "first", files: [{ fileId: "1", fileName: "a" }] } },
      { role: "user", content: { text: "second" } },
    ]);
    expect(result.message).toBe("second");
    expect(result.attachments).toEqual([]);
  });

  it("falls back to legacy text extraction for role-less nested content", () => {
    expect(extractUserInput([{ content: { text: "legacy" } }])).toEqual({
      message: "legacy",
      attachments: [],
    });
  });
});

describe("commandSourceAgentId", () => {
  it("coerces a numeric agent_id to a string", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: 123 } }),
    ).toBe("123");
  });

  it("trims a string agent_id", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: "  self_main  " } }),
    ).toBe("self_main");
  });

  it("falls back to camelCase agentId", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agentId: "self_main" } }),
    ).toBe("self_main");
  });

  it("matches case-insensitively", () => {
    expect(
      commandSourceAgentId({ extraPayload: { Agent_ID: "self_main" } }),
    ).toBe("self_main");
  });

  it("prefers agent_id over agentId", () => {
    expect(
      commandSourceAgentId({
        extraPayload: { agent_id: "first", agentId: "second" },
      }),
    ).toBe("first");
  });

  it("returns empty string when missing", () => {
    expect(commandSourceAgentId({ extraPayload: {} })).toBe("");
    expect(commandSourceAgentId({})).toBe("");
  });

  it("returns empty string for blank or non-scalar values", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: "   " } }),
    ).toBe("");
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: { x: 1 } } }),
    ).toBe("");
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: null } }),
    ).toBe("");
  });
});
