import { AttachmentInputError } from "@byclaw/by-conductor";
import { AskAgentCommand, MessageHeader } from "@byclaw/by-framework";
import { describe, expect, it } from "vitest";
import {
  commandOrchestratorRef,
  commandSessionContext,
  commandSourceAgentId,
  extractUserInput,
  orchestratorBindingSessionId,
} from "../worker/by-framework-protocol.js";

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

describe("commandSessionContext", () => {
  it("reads the existing language metadata and timezone aliases", () => {
    expect(
      commandSessionContext({
        header: {
          metadata: {
            Language: "zh_CN",
            "Time-Zone": "Asia/Shanghai",
          },
        },
      }),
    ).toEqual({
      locale: "zh_CN",
      timezone: "Asia/Shanghai",
    });
  });

  it("prefers locale and returns undefined when no environment metadata exists", () => {
    expect(
      commandSessionContext({
        header: { metadata: { language: "zh-CN", locale: "en-US" } },
      }),
    ).toEqual({ locale: "en-US" });
    expect(
      commandSessionContext({ header: { metadata: {} }, extraPayload: {} }),
    ).toBeUndefined();
  });
});

describe("commandOrchestratorRef", () => {
  it("keeps legacy requests compatible when orchestrator is absent", () => {
    expect(commandOrchestratorRef(command({}))).toBeUndefined();
  });

  it("parses an expert-team reference and namespaces its session binding", () => {
    const orchestrator = commandOrchestratorRef(
      command({
        orchestrator: {
          schemaVersion: "byclaw.orchestrator-ref/v1",
          kind: "EXPERT_TEAM",
          id: 90001,
        },
      }),
    );
    expect(orchestrator).toEqual({
      schemaVersion: "byclaw.orchestrator-ref/v1",
      kind: "EXPERT_TEAM",
      id: "90001",
    });
    expect(orchestratorBindingSessionId("session-1", orchestrator)).toBe(
      '["orchestrator","EXPERT_TEAM","90001","session-1"]',
    );
  });

  it("rejects malformed orchestrator declarations", () => {
    expect(() =>
      commandOrchestratorRef(
        command({
          orchestrator: {
            schemaVersion: "v0",
            kind: "EXPERT_TEAM",
            id: "90001",
          },
        }),
      ),
    ).toThrow("orchestrator.schemaVersion");
  });

  it("preserves the legacy binding key for Super Assistant", () => {
    expect(orchestratorBindingSessionId("session-1", undefined)).toBe(
      "session-1",
    );
  });
});

function command(extraPayload: Record<string, unknown>): AskAgentCommand {
  return new AskAgentCommand(
    new MessageHeader("message-1", "session-1", "trace-1", {
      sourceAgentType: "BY_PARENT",
      targetAgentType: "BY_SUPER",
      metadata: {},
    }),
    "hello",
    true,
    extraPayload,
  );
}
