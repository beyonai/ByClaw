import { AgentState, MessageHeader, ResumeCommand } from "@byclaw/by-framework";
import { describe, expect, it } from "vitest";
import {
  childRequestMessageId,
  parseChildAgentResume,
} from "../worker/by-framework-resume.js";

describe("by-framework child Resume contract", () => {
  it("reads the real BYCLAW_CODE final answer from string replyData", () => {
    const command = resumeCommand({
      content: "",
      replyData:
        "\n\n你好！我是工作规范，负责研发需求分析与澄清的数字员工。",
    });

    expect(parseChildAgentResume(command)).toEqual({
      delegationId: "delegation-1",
      requestMessageId: "delegation-1:request",
      status: AgentState.COMPLETED,
      finalAnswer:
        "\n\n你好！我是工作规范，负责研发需求分析与澄清的数字员工。",
    });
  });

  it("uses distinct IDs for the Delegation card, child request and callback", () => {
    const command = resumeCommand({ callbackMessageId: "11190824" });

    expect(childRequestMessageId("delegation-1")).toBe("delegation-1:request");
    expect(command.header.messageId).toBe("11190824");
    expect(command.header.parentMessageId).toBe("delegation-1:request");
    expect(parseChildAgentResume(command)?.delegationId).toBe("delegation-1");
  });

  it("rejects a terminal callback without delegation metadata", () => {
    const command = resumeCommand({ metadata: {} });

    expect(() => parseChildAgentResume(command)).toThrow(
      "ResumeCommand metadata.delegation_id is required",
    );
  });

  it("rejects a callback whose parentMessageId points to another request", () => {
    const command = resumeCommand({ parentMessageId: "delegation-2:request" });

    expect(() => parseChildAgentResume(command)).toThrow(
      "ResumeCommand parentMessageId must be delegation-1:request",
    );
  });

  it("rejects a COMPLETED callback whose replyData is not a string", () => {
    const command = resumeCommand({ replyData: { finalAnswer: "旧兼容格式" } });

    expect(() => parseChildAgentResume(command)).toThrow(
      "ResumeCommand replyData must be a string",
    );
  });

  it("accepts the framework FAILED shape as a terminal error", () => {
    const command = resumeCommand({
      status: AgentState.FAILED,
      replyData: { error: "child failed" },
    });

    expect(parseChildAgentResume(command)?.finalAnswer).toBe("child failed");
  });
});

function resumeCommand(options: {
  callbackMessageId?: string;
  parentMessageId?: string;
  metadata?: Record<string, unknown>;
  content?: unknown;
  status?: string;
  replyData?: unknown;
} = {}): ResumeCommand {
  return new ResumeCommand(
    new MessageHeader(options.callbackMessageId ?? "callback-message", "11190807", "trace-1", {
      sourceAgentType: "BYCLAW_CODE_0027032635",
      targetAgentType: "BY_SUPER",
      parentMessageId: options.parentMessageId ?? "delegation-1:request",
      metadata: options.metadata ?? { delegation_id: "delegation-1" },
    }),
    options.content ?? "",
    options.status ?? AgentState.COMPLETED,
    options.replyData ?? "final answer",
  );
}
