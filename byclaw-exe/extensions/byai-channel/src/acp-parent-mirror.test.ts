import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAcpOpenClawAssistantEvent,
  buildAcpOpenClawThinkingEvent,
  buildAcpOpenClawToolEvent,
  filterAcpDirectAnnounceTranscriptLines,
  mirrorAcpChildEventToParentSession,
} from "./acp-parent-mirror.js";
import {
  extractAcpStructuredAgentMarkers,
  sanitizeAcpVisibleText,
  stripAcpStructuredAgentMarkers,
} from "../../byclaw-acp-adapter/src/acp-common/envelope.js";
import type { AgentEvent } from "./types.js";

const runtimeMocks = vi.hoisted(() => ({
  appendedMessages: [] as unknown[],
  appendAssistantMirrorMessageByIdentity: vi.fn(),
  publishUpdate: vi.fn(async () => undefined),
  withSessionTranscriptWriteLock: vi.fn(async (_params: unknown, run: (context: unknown) => Promise<unknown>) =>
    run({
      appendMessage: async (options: { message: unknown }) => {
        runtimeMocks.appendedMessages.push(options.message);
        return {
          appended: true,
          messageId: `message-${runtimeMocks.appendedMessages.length}`,
          message: options.message,
        };
      },
      publishUpdate: runtimeMocks.publishUpdate,
    }),
  ),
}));

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  appendAssistantMirrorMessageByIdentity: runtimeMocks.appendAssistantMirrorMessageByIdentity,
  publishSessionTranscriptUpdateByIdentity: undefined,
  resolveSessionTranscriptLegacyFileTarget: undefined,
  withSessionTranscriptWriteLock: runtimeMocks.withSessionTranscriptWriteLock,
}), { virtual: true });

function acpEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    seq: 1,
    runId: "child-run-1",
    stream: "acp",
    sessionKey: "agent:claude:acp:child-1",
    data: {},
    ...overrides,
  } as AgentEvent;
}

const api = {
  config: {},
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
} as any;

const activeRequest = {
  sessionId: "session-1",
  sessionKey: "agent:main:direct:session-1",
} as any;

function writeAcpxRuntimeFixture(params: {
  childSessionKey: string;
  runId?: string;
  toolUses: Array<{
    id: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  bundle?: Record<string, unknown>;
}): { bundlePath?: string; stateDir: string } {
  const stateDir = mkdtempSync(join(tmpdir(), "byai-channel-acpx-"));
  const acpxDir = join(stateDir, "acpx", "sessions");
  mkdirSync(acpxDir, { recursive: true });
  let bundlePath: string | undefined;
  if (params.bundle) {
    const bundleDir = join(stateDir, "bundle");
    mkdirSync(bundleDir, { recursive: true });
    bundlePath = join(bundleDir, "plan-bundle.json");
    writeFileSync(bundlePath, JSON.stringify(params.bundle), "utf8");
  }
  const sessionFile = join(acpxDir, `${encodeURIComponent(params.childSessionKey)}%3Aoneshot%3Atest.json`);
  writeFileSync(sessionFile, JSON.stringify({
    last_request_id: params.runId ?? "child-run-1",
    messages: [
      {
        User: {
          content: [
            {
              Text: bundlePath
                ? `read shared plan bundle: ${bundlePath}`
                : "no bundle",
            },
          ],
        },
      },
      {
        Agent: {
          content: params.toolUses.map((toolUse) => ({
            ToolUse: {
              id: toolUse.id,
              name: toolUse.name ?? "Task",
              raw_input: JSON.stringify(toolUse.input ?? {}),
              input: toolUse.input ?? {},
            },
          })),
        },
      },
    ],
  }), "utf8");
  return { bundlePath, stateDir };
}

describe("ACP parent mirror event conversion", () => {
  const originalOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;

  beforeEach(() => {
    runtimeMocks.appendedMessages.length = 0;
    runtimeMocks.appendAssistantMirrorMessageByIdentity.mockClear();
    runtimeMocks.publishUpdate.mockClear();
    runtimeMocks.withSessionTranscriptWriteLock.mockClear();
    api.logger.warn.mockClear();
    if (originalOpenClawStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalOpenClawStateDir;
    }
  });

  it("keeps ACP tool result attached to the original concrete tool name and input", () => {
    const start = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-1",
      event: acpEvent({
        seq: 10,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call",
          status: "pending",
          title: "grep -n openclaw.ai README.md",
          toolCallId: "call-1",
          text: "grep -n openclaw.ai README.md (pending)",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });
    const result = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-1",
      event: acpEvent({
        seq: 11,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          status: "completed",
          title: "tool call",
          toolCallId: "call-1",
          text: "tool call (completed): README.md:8: docs.openclaw.ai",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(start?.stream).toBe("tool");
    expect(start?.data.phase).toBe("start");
    expect(start?.data.name).toBe("bash");
    expect(start?.data.args).toEqual(expect.objectContaining({
      command: "grep -n openclaw.ai README.md",
      input: "grep -n openclaw.ai README.md",
      title: "grep -n openclaw.ai README.md",
    }));
    expect(result?.data.phase).toBe("result");
    expect(result?.data.name).toBe("bash");
    expect(result?.data.args).toEqual(expect.objectContaining({
      command: "grep -n openclaw.ai README.md",
      input: "grep -n openclaw.ai README.md",
      title: "grep -n openclaw.ai README.md",
    }));
    expect(result?.data.result).toEqual(expect.objectContaining({
      content: [{ type: "text", text: "README.md:8: docs.openclaw.ai" }],
    }));
  });

  it("does not wrap root-session tool events as ACP child tool events", () => {
    const rootTool = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:baiying-agent-10002959:direct:root-session",
      event: acpEvent({
        seq: 12,
        sessionKey: "agent:baiying-agent-10002959:direct:root-session",
        stream: "tool",
        data: {
          phase: "start",
          name: "byclawAcpRun",
          toolCallId: "root-tool-call",
          args: { input: "root tool input" },
        },
      }),
      parentSessionKey: "agent:baiying-agent-10002959:direct:root-session",
      parentSessionId: "root-session",
    });

    expect(rootTool).toBeUndefined();
  });

  it("maps early ACP client-session tools to the plan bundle default agent instead of claude", () => {
    const childSessionKey = "agent:claude:acp:child-early-plan";
    const { stateDir } = writeAcpxRuntimeFixture({
      childSessionKey,
      runId: "child-run-early-plan",
      toolUses: [],
      bundle: {
        agentModels: {
          agents: [
            {
              byclawAgentId: "10002959",
              nativeSubagentId: "byclaw-orchestrator-team-lead",
              nativeSubagentName: "ByClaw orchestrator / team-lead",
              displayName: "ByClaw orchestrator / team-lead",
              role: "orchestrator-team-lead",
              model: "MiniMax-M3-anthropic",
            },
            {
              byclawAgentId: "10002962",
              nativeSubagentId: "byclaw-issue-triage",
              nativeSubagentName: "ByClaw issue-triage",
              displayName: "ByClaw issue-triage",
              role: "issue-triage",
            },
          ],
        },
      },
    });
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const earlyRead = buildAcpOpenClawToolEvent({
      childSessionKey,
      event: acpEvent({
        runId: "child-run-early-plan",
        sessionKey: childSessionKey,
        seq: 30,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call",
          status: "pending",
          title: "Read .byclaw/acp-runs/run-1/plan-bundle.json",
          toolCallId: "call-read-plan",
          text: "Read .byclaw/acp-runs/run-1/plan-bundle.json",
        },
      }),
      parentSessionKey: "agent:baiying-agent-10002959:direct:session-early-plan",
      parentSessionId: "session-early-plan",
    });

    expect(earlyRead?.data.args).toEqual(expect.objectContaining({
      agentId: "byclaw-orchestrator-team-lead",
      agentName: "ByClaw orchestrator / team-lead",
      agentSource: "plan_bundle_default",
      nativeSubagentId: "byclaw-orchestrator-team-lead",
      byclawAgentId: "10002959",
      role: "orchestrator-team-lead",
    }));
  });

  it("cleans pending wrappers and marker-only terminal output from ACP tool data", () => {
    const start = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-1",
      event: acpEvent({
        seq: 20,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "grep -n openclaw.ai /repo",
          toolCallId: "call-2",
          text: "grep -n openclaw.ai /repo (pending): /repo",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });
    const markerResult = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-1",
      event: acpEvent({
        seq: 21,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          status: "completed",
          title: "tool call",
          toolCallId: "call-2",
          text: 'tool call (completed): ```console BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"start","workflowStepId":"triage"}',
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(start?.data.args).toEqual(expect.objectContaining({
      input: "grep -n openclaw.ai /repo",
    }));
    expect(markerResult?.data.result).toEqual(expect.objectContaining({
      content: [],
    }));
  });

  it("infers native subagent identity from ACP Task prompt text and keeps it active for child tools", () => {
    const taskPrompt = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-inferred-agent",
      event: acpEvent({
        seq: 25,
        sessionKey: "agent:claude:acp:child-inferred-agent",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "Tester 权威只读核验",
          toolCallId: "call-task-tester",
          text: 'Tester 权威只读核验: 你是 ByClaw tester（byclawAgentId 10002977，role tester，workflowStepId "test"）。严格要求：开始时输出 BYCLAW_AGENT_EVENT {"agentId":"byclaw-tester"',
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });
    const grep = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-inferred-agent",
      event: acpEvent({
        seq: 26,
        sessionKey: "agent:claude:acp:child-inferred-agent",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: 'grep -c "ByClaw" README.md',
          toolCallId: "call-grep-tester",
          text: 'grep -c "ByClaw" README.md (pending)',
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(taskPrompt?.data.args).toEqual(expect.objectContaining({
      agentId: "byclaw-tester",
      nativeSubagentId: "byclaw-tester",
      byclawAgentId: "10002977",
      role: "tester",
      workflowStepId: "test",
      agentSource: "inferred_text",
    }));
    expect(grep?.data.args).toEqual(expect.objectContaining({
      agentId: "byclaw-tester",
      agentSource: "active_context",
      input: 'grep -c "ByClaw" README.md',
    }));
  });

  it("infers multi-word ByClaw native subagent roles from ACP Task prompts", () => {
    const taskPrompt = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-inferred-agent-multi-word",
      event: acpEvent({
        seq: 26,
        sessionKey: "agent:claude:acp:child-inferred-agent-multi-word",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "Specialist teammate smoke check",
          toolCallId: "call-task-specialist-teammate",
          text: "Specialist teammate smoke check: 你是 ByClaw specialist teammate（byclawAgentId 10002983，role specialist-teammate，workflowStepId smoke）。请检查 README.md。",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });
    const shell = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-inferred-agent-multi-word",
      event: acpEvent({
        seq: 27,
        sessionKey: "agent:claude:acp:child-inferred-agent-multi-word",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "ls -la README.md",
          toolCallId: "call-ls-specialist-teammate",
          text: "ls -la README.md (pending)",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(taskPrompt?.data.args).toEqual(expect.objectContaining({
      agentId: "byclaw-specialist-teammate",
      nativeSubagentId: "byclaw-specialist-teammate",
      agentName: "ByClaw specialist teammate",
      byclawAgentId: "10002983",
      role: "specialist-teammate",
      workflowStepId: "smoke",
    }));
    expect(shell?.data.args).toEqual(expect.objectContaining({
      agentId: "byclaw-specialist-teammate",
      agentName: "ByClaw specialist teammate",
      agentSource: "active_context",
      command: "ls -la README.md",
    }));
  });

  it("maps native subagent identity from live ACP subagent_type tool events", () => {
    const taskPrompt = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-inferred-subagent-type",
      event: acpEvent({
        seq: 27,
        sessionKey: "agent:claude:acp:child-inferred-subagent-type",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "Triage README existence and emit tool calls",
          toolCallId: "call-task-subagent-type",
          text: 'Agent invoked synchronously against subagent_type="byclaw-issue-triage" (bundle roster entry byclawAgentId=10002962, role issue-triage). You are running as the **ByClaw issue-triage** native subagent.',
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(taskPrompt?.data.args).toEqual(expect.objectContaining({
      agentId: "byclaw-issue-triage",
      nativeSubagentId: "byclaw-issue-triage",
      agentName: "ByClaw issue triage",
      byclawAgentId: "10002962",
      role: "issue-triage",
      agentSource: "runtime_metadata",
    }));
  });

  it("maps ACP tool calls from Claude Code runtime ToolUse subagent_type and bundle metadata", () => {
    const childSessionKey = "agent:claude:acp:runtime-agent-metadata";
    const fixture = writeAcpxRuntimeFixture({
      childSessionKey,
      toolUses: [
        {
          id: "call-task-runtime-tester",
          name: "Tester runtime check",
          input: {
            description: "Tester runtime check",
            prompt: "This prompt text is not the source of truth.",
            subagent_type: "byclaw-tester",
          },
        },
      ],
      bundle: {
        agentModels: {
          agents: [
            {
              byclawAgentId: "10002977",
              nativeSubagentId: "byclaw-tester",
              nativeSubagentName: "ByClaw tester",
              displayName: "ByClaw tester",
              role: "tester",
              model: "MiniMax-M3-anthropic",
              baiyingModelId: "10002933",
            },
          ],
        },
      },
    });
    process.env.OPENCLAW_STATE_DIR = fixture.stateDir;
    try {
      const task = buildAcpOpenClawToolEvent({
        childSessionKey,
        event: acpEvent({
          seq: 501,
          sessionKey: childSessionKey,
          data: {
            phase: "runtime_event",
            eventType: "tool_call",
            tag: "tool_call_update",
            title: "Task",
            toolCallId: "call-task-runtime-tester",
            text: "Task prompt mentions general prose but runtime ToolUse has the real subagent.",
          },
        }),
        parentSessionKey: "agent:main:direct:session-1",
        parentSessionId: "session-1",
      });
      const nestedTool = buildAcpOpenClawToolEvent({
        childSessionKey,
        event: acpEvent({
          seq: 502,
          sessionKey: childSessionKey,
          data: {
            phase: "runtime_event",
            eventType: "tool_call",
            tag: "tool_call_update",
            title: "ls -la README.md",
            toolCallId: "call-nested-runtime-tool",
            text: "ls -la README.md (pending)",
          },
        }),
        parentSessionKey: "agent:main:direct:session-1",
        parentSessionId: "session-1",
      });

      expect(task?.data.args).toEqual(expect.objectContaining({
        agentId: "byclaw-tester",
        agentName: "ByClaw tester",
        agentSource: "runtime_metadata",
        nativeSubagentId: "byclaw-tester",
        nativeSubagentName: "ByClaw tester",
        byclawAgentId: "10002977",
        role: "tester",
      }));
      expect((task?.data.args as any).agent.metadata).toEqual(expect.objectContaining({
        runtime: "acpx",
        toolUseId: "call-task-runtime-tester",
        subagentType: "byclaw-tester",
        model: "MiniMax-M3-anthropic",
        baiyingModelId: "10002933",
      }));
      expect(nestedTool?.data.args).toEqual(expect.objectContaining({
        agentId: "byclaw-tester",
        agentName: "ByClaw tester",
        agentSource: "active_context",
        command: "ls -la README.md",
      }));
    } finally {
      rmSync(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows the real Claude Code default subagent when runtime ToolUse uses general-purpose", () => {
    const childSessionKey = "agent:claude:acp:runtime-general-purpose";
    const fixture = writeAcpxRuntimeFixture({
      childSessionKey,
      toolUses: [
        {
          id: "call-task-runtime-general",
          name: "Default Task",
          input: {
            description: "Default Task",
            prompt: "Even if this prompt mentions ByClaw tester, the runtime subagent_type wins.",
            subagent_type: "general-purpose",
          },
        },
      ],
      bundle: {
        agentModels: {
          agents: [
            {
              byclawAgentId: "10002977",
              nativeSubagentId: "byclaw-tester",
              nativeSubagentName: "ByClaw tester",
              displayName: "ByClaw tester",
              role: "tester",
            },
          ],
        },
      },
    });
    process.env.OPENCLAW_STATE_DIR = fixture.stateDir;
    try {
      const task = buildAcpOpenClawToolEvent({
        childSessionKey,
        event: acpEvent({
          seq: 503,
          sessionKey: childSessionKey,
          data: {
            phase: "runtime_event",
            eventType: "tool_call",
            tag: "tool_call_update",
            title: "Task",
            toolCallId: "call-task-runtime-general",
            text: "你是 ByClaw tester，但这不是权威运行态。",
          },
        }),
        parentSessionKey: "agent:main:direct:session-1",
        parentSessionId: "session-1",
      });

      expect(task?.data.args).toEqual(expect.objectContaining({
        agentId: "general-purpose",
        agentName: "general-purpose",
        agentSource: "runtime_metadata",
        nativeSubagentId: "general-purpose",
        nativeSubagentName: "general-purpose",
      }));
      expect(task?.data.args).not.toEqual(expect.objectContaining({
        byclawAgentId: "10002977",
        role: "tester",
      }));
    } finally {
      rmSync(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("mirrors ACP Task completed narrative as the native subagent assistant message", async () => {
    const sessionKey = "agent:claude:acp:child-task-result-as-assistant";
    const runId = "child-run-task-result-as-assistant";
    const toolCallId = "call-task-issue-triage";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 30,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: "Task",
        toolCallId,
        text: "Task (pending)",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 31,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        title: "issue-triage 只读回归",
        toolCallId,
        text: "issue-triage 只读回归: 你是 ByClaw issue-triage（byclawAgentId=10002962，nativeSubagentId=byclaw-issue-triage），请只读检查 README.md。",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 32,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        status: "completed",
        title: "tool call",
        toolCallId,
        text: "tool call (completed): 我已收集到足够信息，按 issue-triage 职责产出扫描报告。",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(3);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "ByClaw issue triage",
      content: [
        expect.objectContaining({
          type: "toolCall",
          name: "task",
        }),
      ],
    }));
    expect(runtimeMocks.appendedMessages[1]).toEqual(expect.objectContaining({
      role: "toolResult",
      senderLabel: "ByClaw issue triage",
      toolCallId,
      toolName: "task",
      content: [
        {
          type: "text",
          text: "我已收集到足够信息，按 issue-triage 职责产出扫描报告。",
        },
      ],
    }));
    expect(runtimeMocks.appendedMessages[2]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "ByClaw issue triage",
      content: [
        {
          type: "text",
          text: "我已收集到足够信息，按 issue-triage 职责产出扫描报告。",
        },
      ],
    }));
  });

  it("mirrors ACP completed tool output as a native OpenClaw toolResult", async () => {
    const sessionKey = "agent:claude:acp:child-tool-result";
    const runId = "child-run-tool-result";
    const toolCallId = "call-read-readme";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 40,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: "Read",
        toolCallId,
        text: "Read (pending): README.md",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 41,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        status: "completed",
        title: "tool call",
        toolCallId,
        text: "tool call (completed): # README\nproject summary",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(2);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      content: [
        expect.objectContaining({
          type: "toolCall",
          id: toolCallId,
          name: "bash",
        }),
      ],
    }));
    expect(runtimeMocks.appendedMessages[1]).toEqual(expect.objectContaining({
      role: "toolResult",
      toolCallId,
      toolName: "bash",
      content: [
        {
          type: "text",
          text: "# README project summary",
        },
      ],
    }));
  });

  it("does not mirror marker-only ACP tool calls as visible OpenClaw tool blocks", async () => {
    const sessionKey = "agent:claude:acp:child-marker-only-tool";
    const runId = "child-run-marker-only-tool";
    const toolCallId = "call-marker-only";
    const command = `echo 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-req-analyst","nativeSubagentId":"byclaw-req-analyst","phase":"start"}'`;
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 60,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: command,
        toolCallId,
        text: `${command} (pending): ${command}`,
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 61,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        status: "completed",
        title: "tool call",
        toolCallId,
        text: 'tool call (completed): ```console BYCLAW_AGENT_EVENT {"agentId":"byclaw-req-analyst","nativeSubagentId":"byclaw-req-analyst","phase":"start"} ```',
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(0);
  });

  it("closes an already mirrored Task call when its completed output is marker-only", async () => {
    const sessionKey = "agent:claude:acp:child-marker-only-task-result";
    const runId = "child-run-marker-only-task-result";
    const toolCallId = "call-task-marker-only-result";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 62,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: "Task",
        toolCallId,
        text: "Read README.md as byclaw-req-analyst: Agent invoked synchronously against subagent_type=\"byclaw-req-analyst\".",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 63,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        status: "completed",
        title: "tool call",
        toolCallId,
        text: 'tool call (completed): BYCLAW_AGENT_EVENT {"agentId":"byclaw-req-analyst","nativeSubagentId":"byclaw-req-analyst","displayName":"ByClaw req-analyst","byclawAgentId":"10002965","role":"req-analyst","phase":"complete","workflowStepId":"prd"}',
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(2);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      content: [expect.objectContaining({ type: "toolCall", id: toolCallId })],
    }));
    const mirroredToolName = ((runtimeMocks.appendedMessages[0] as any).content[0] as any).name;
    expect(runtimeMocks.appendedMessages[1]).toEqual(expect.objectContaining({
      role: "toolResult",
      toolCallId,
      toolName: mirroredToolName,
      content: [],
      details: {
        acp: {
          markerOnly: true,
        },
      },
    }));
  });

  it("formats structured ACP Task JSON before mirroring it as assistant text", async () => {
    const sessionKey = "agent:claude:acp:child-task-structured-json";
    const runId = "child-run-task-structured-json";
    const toolCallId = "call-task-json";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 50,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: "Task",
        toolCallId,
        text: "Task (pending)",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 51,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        title: "Coder: README implementation check",
        toolCallId,
        text: "Agent invoked synchronously against subagent_type=\"byclaw-coder\" (bundle roster entry byclawAgentId=10002971, role coder).",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 52,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        status: "completed",
        title: "tool call",
        toolCallId,
        text: 'tool call (completed): { "byclawAgentId": "10002971", "nativeSubagentId": "byclaw-coder", "displayName": "ByClaw coder", "workflowStepId": "implement", "verdict": "pass", "proof": "README.md exists", "next_action": "close smoke" }',
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(3);
    expect(runtimeMocks.appendedMessages[1]).toEqual(expect.objectContaining({
      role: "toolResult",
      toolCallId,
      toolName: "task",
      content: [
        {
          type: "text",
          text: '{ "byclawAgentId": "10002971", "nativeSubagentId": "byclaw-coder", "displayName": "ByClaw coder", "workflowStepId": "implement", "verdict": "pass", "proof": "README.md exists", "next_action": "close smoke" }',
        },
      ],
    }));
    expect(runtimeMocks.appendedMessages[2]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "ByClaw coder",
      content: [
        {
          type: "text",
          text: "workflowStepId: implement\nverdict: pass\nproof: README.md exists\nnext_action: close smoke",
        },
      ],
    }));
  });

  it("strips ACP structured agent markers from completed Task assistant text", async () => {
    const sessionKey = "agent:claude:acp:child-task-result-marker-strip";
    const runId = "child-run-task-result-marker-strip";
    const toolCallId = "call-task-marker-strip";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 32,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: "Task",
        toolCallId,
        text: "Task (pending)",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 33,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        title: "issue-triage readme check",
        toolCallId,
        text: 'Agent invoked synchronously against subagent_type="byclaw-issue-triage" (bundle roster entry byclawAgentId=10002962, role issue-triage).',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 34,
      sessionKey,
      runId,
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        status: "completed",
        title: "tool call",
        toolCallId,
        text: 'tool call (completed): BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","displayName":"ByClaw issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"complete","workflowStepId":"triage"}\n- triage_note: README.md exists',
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(3);
    expect(runtimeMocks.appendedMessages[1]).toEqual(expect.objectContaining({
      role: "toolResult",
      content: [
        {
          type: "text",
          text: "- triage_note: README.md exists",
        },
      ],
    }));
    expect(runtimeMocks.appendedMessages[2]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "ByClaw issue-triage",
      content: [
        {
          type: "text",
          text: "- triage_note: README.md exists",
        },
      ],
    }));
  });

  it("prefers subagent_type over opaque native agent hashes in assistant prose", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 417,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-subagent-type-over-hash",
      runId: "transcript-run-subagent-type-over-hash",
      data: {
        text: "Native subagent 调度: subagent_type=byclaw-specialist-teammate, native agentId a56cc998250f1f6de, duration 29s. 最终结论。",
        delta: "最终结论。",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      senderLabel: "byclaw-specialist-teammate",
    }));
    expect((runtimeMocks.appendedMessages[0] as any).openclawDeliveryMirror.agent).toEqual(
      expect.objectContaining({
        id: "byclaw-specialist-teammate",
        nativeSubagentId: "byclaw-specialist-teammate",
      }),
    );
  });

  it("does not treat ByClaw business employee id as native subagent id in prose", () => {
    const planning = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-prose-agent-id",
      event: acpEvent({
        seq: 27,
        sessionKey: "agent:claude:acp:child-prose-agent-id",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "plan",
          toolCallId: "call-plan",
          text: "计划包含 byclaw-issue-triage（byclawAgentId 10002962）、byclaw-tester（byclawAgentId 10002977）。",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(planning?.data.args).not.toEqual(expect.objectContaining({
      agentId: "10002962",
    }));
    expect(planning?.data.args).toEqual(expect.objectContaining({
      agentId: "claude",
    }));
  });

  it("does not infer native agent identity from ordinary roster transition prose", async () => {
    const sessionKey = "agent:claude:acp:ordinary-roster-transition";
    const runId = "ordinary-roster-transition-run";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 371,
      stream: "assistant",
      sessionKey,
      runId,
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","displayName":"ByClaw issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"complete","workflowStepId":"triage"}\n',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 372,
      stream: "assistant",
      sessionKey,
      runId,
      data: {
        delta: "issue-triage emitted. Next roster member: `byclaw-req-analyst` (workflowStepId=prd, agentId=10002965).",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      senderLabel: "ByClaw issue-triage",
      content: [
        {
          type: "text",
          text: "issue-triage emitted. Next roster member: `byclaw-req-analyst` (workflowStepId=prd, agentId=10002965).",
        },
      ],
    }));
  });

  it("does not infer an ACP agent from repository filenames containing Agent and .html", () => {
    const listing = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-filename-agent",
      event: acpEvent({
        seq: 27,
        sessionKey: "agent:claude:acp:child-filename-agent",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          status: "completed",
          title: "tool call",
          toolCallId: "call-listing",
          text: "tool call (completed): ```console AGENTS.md ByClaw 研发流程 Agent 体系完整解决方案.html README.md ```",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(listing?.data.args).not.toEqual(expect.objectContaining({
      agentId: ".html",
    }));
    expect(listing?.data.args).toEqual(expect.objectContaining({
      agentId: "claude",
    }));
  });

  it("does not infer generic ACP agent labels from prose around teams and definitions", () => {
    const planning = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-generic-agent-words",
      event: acpEvent({
        seq: 28,
        sessionKey: "agent:claude:acp:child-generic-agent-words",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "tool call",
          toolCallId: "call-generic-agent-words",
          text: "Read the agent team definitions and bundle roster before assigning native subagents.",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(planning?.data.args).not.toEqual(expect.objectContaining({
      agentId: "team",
    }));
    expect(planning?.data.args).not.toEqual(expect.objectContaining({
      agentId: "definitions",
    }));
    expect(planning?.data.args).toEqual(expect.objectContaining({
      agentId: "claude",
    }));
  });

  it("does not infer a fake ByClaw agent from ordinary orchestrator prose", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
        seq: 29,
        sessionKey: "agent:claude:acp:child-orchestrator-prose",
        stream: "assistant",
        data: {
          phase: "runtime_event",
          eventType: "message_delta",
          tag: "assistant_delta",
          text: "I'll act as the ByClaw orchestrator and coordinate the read-only regression check.",
          delta: "I'll act as the ByClaw orchestrator and coordinate the read-only regression check.",
        },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(0);
  });

  it("does not infer a native subagent from partial ACP marker fragments", () => {
    const partialMarker = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-partial-marker",
      event: acpEvent({
        seq: 28,
        sessionKey: "agent:claude:acp:child-partial-marker",
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: "tool call",
          toolCallId: "call-partial-marker",
          text: 'tool call (completed): BYCLAW_AGENT_EVENT {"agentId":"byclaw-special',
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(partialMarker?.data.args).not.toEqual(expect.objectContaining({
      agentId: "byclaw",
    }));
    expect(partialMarker?.data.args).not.toEqual(expect.objectContaining({
      agentId: "byclaw-special",
    }));
    expect(partialMarker?.data.args).toEqual(expect.objectContaining({
      agentId: "claude",
    }));
  });

  it("waits for full ACP tool input instead of mirroring a bare pending tool label", () => {
    const pending = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-1",
      event: acpEvent({
        seq: 30,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call",
          status: "pending",
          title: "grep",
          toolCallId: "call-3",
          text: "grep (pending)",
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });
    const update = buildAcpOpenClawToolEvent({
      childSessionKey: "agent:claude:acp:child-1",
      event: acpEvent({
        seq: 31,
        data: {
          phase: "runtime_event",
          eventType: "tool_call",
          tag: "tool_call_update",
          title: 'grep -n --include="README*" "openclaw\\.ai" /repo',
          toolCallId: "call-3",
          text: 'grep -n --include="README*" "openclaw\\.ai" /repo: /repo',
        },
      }),
      parentSessionKey: "agent:main:direct:session-1",
      parentSessionId: "session-1",
    });

    expect(pending?.data.args).not.toEqual(expect.objectContaining({
      input: expect.any(String),
    }));
    expect(update?.data.phase).toBe("update");
    expect(update?.data.args).toEqual(expect.objectContaining({
      input: 'grep -n --include="README*" "openclaw\\.ai" /repo: /repo',
      title: 'grep -n --include="README*" "openclaw\\.ai" /repo',
    }));
  });

  it("converts ACP reasoning runtime events into OpenClaw thinking stream events", () => {
    const thinking = buildAcpOpenClawThinkingEvent(acpEvent({
      stream: "acp",
      data: {
        eventType: "thinking_delta",
        delta: "checking repo references",
      },
    }));

    expect(thinking).toEqual(expect.objectContaining({
      stream: "thinking",
      type: "thinking.delta",
      data: expect.objectContaining({
        delta: "checking repo references",
        text: "checking repo references",
        phase: "reasoning",
      }),
    }));
  });

  it("extracts and strips adjacent BYCLAW_AGENT_EVENT markers before visible text", () => {
    const text = 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"start","workflowStepId":"triage"}BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"complete","workflowStepId":"triage"}\n结论正文';

    expect(extractAcpStructuredAgentMarkers(text).map((marker) => marker.identity.phase)).toEqual([
      "start",
      "complete",
    ]);
    expect(stripAcpStructuredAgentMarkers(text)).toBe("结论正文");
  });

  it("removes structured marker names from visible ACP prose", () => {
    expect(sanitizeAcpVisibleText("最终不要展示 BYCLAW_AGENT_EVENT，只展示业务结论")).toBe(
      "最终不要展示 内部状态标记，只展示业务结论",
    );
  });

  it("removes markdown backtick wrappers around structured ACP markers", () => {
    const text = '前文 `BYCLAW_AGENT_EVENT {"agentId":"byclaw-orchestrator","nativeSubagentId":"byclaw-orchestrator","byclawAgentId":"10002959","role":"orchestrator","phase":"complete","workflowStepId":"triage"}` 后文';

    expect(sanitizeAcpVisibleText(text)).toBe("前文  后文");
  });

  it("writes ACP assistant deltas as native OpenClaw assistant messages", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 39,
      stream: "assistant",
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-tester","nativeSubagentId":"byclaw-tester","displayName":"ByClaw tester","byclawAgentId":"10002977","role":"tester","phase":"start","workflowStepId":"test"}\n',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 40,
      stream: "assistant",
      data: {
        text: "visible answer",
        delta: "visible answer",
      },
    }));

    expect(runtimeMocks.appendAssistantMirrorMessageByIdentity).not.toHaveBeenCalled();
    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "ByClaw tester",
      content: [{ type: "text", text: "visible answer" }],
      stopReason: "stop",
    }));
    expect((runtimeMocks.appendedMessages[0] as any).openclawDeliveryMirror).toEqual(expect.objectContaining({
      kind: "byai-channel-acp-parent-mirror",
      stream: "assistant",
      agent: expect.objectContaining({
        id: "byclaw-tester",
        name: "ByClaw tester",
        byclawAgentId: "10002977",
      }),
    }));
  });

  it("sanitizes split ACP agent markers for realtime assistant display events", () => {
    const first = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 401,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-split-marker",
      runId: "display-run-1",
      data: {
        delta: "BY",
      },
    }));
    const second = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 402,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-split-marker",
      runId: "display-run-1",
      data: {
        delta: 'CLAW_AGENT_EVENT {"agentId":"byclaw-specialist-teammate","nativeSubagentId":"byclaw-specialist-teammate","displayName":"ByClaw specialist teammate","byclawAgentId":"10002983","role":"specialist-teammate","phase":"complete","workflowStepId":"smoke"}',
      },
    }));
    const third = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 403,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-split-marker",
      runId: "display-run-1",
      data: {
        delta: "\n真实可见正文",
      },
    }));

    expect(first?.data.delta).toBe("");
    expect(second?.data.delta).toBe("");
    expect(third?.data.delta).toBe("真实可见正文");
  });

  it("buffers markdown backticks when ACP agent markers are split across assistant deltas", () => {
    const first = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 404,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-split-backtick-marker",
      runId: "display-run-2",
      data: {
        delta: "前文 `BY",
      },
    }));
    const second = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 405,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-split-backtick-marker",
      runId: "display-run-2",
      data: {
        delta: 'CLAW_AGENT_EVENT {"agentId":"byclaw-specialist-teammate","nativeSubagentId":"byclaw-specialist-teammate","displayName":"ByClaw specialist teammate","byclawAgentId":"10002983","role":"specialist-teammate","phase":"complete","workflowStepId":"smoke"}`',
      },
    }));
    const third = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 406,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-split-backtick-marker",
      runId: "display-run-2",
      data: {
        delta: " 后文",
      },
    }));

    expect(first?.data.delta).toBe("前文");
    expect(second?.data.delta).toBe("");
    expect(third?.data.delta).toBe("后文");
  });

  it("does not swallow later assistant prose after an abandoned partial ACP marker", () => {
    const first = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 4061,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-abandoned-partial-marker",
      runId: "display-run-abandoned-marker",
      data: {
        delta: "## 最终汇总：Proof / Risks / Verdict / Next Action\n\n`BYCLAW_AGENT_EVENT {\"agentId\"",
      },
    }));
    const second = buildAcpOpenClawAssistantEvent(acpEvent({
      seq: 4062,
      stream: "assistant",
      sessionKey: "agent:claude:acp:display-abandoned-partial-marker",
      runId: "display-run-abandoned-marker",
      data: {
        delta: "Proof: README.md exists. Verdict: PASS.",
      },
    }));

    expect(first?.data.delta).toBe("## 最终汇总：Proof / Risks / Verdict / Next Action");
    expect(second?.data.delta).toBe("Proof: README.md exists. Verdict: PASS.");
  });

  it("does not write standalone backticks for split ACP agent markers", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 406,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-split-backtick-marker",
      runId: "transcript-run-2",
      data: {
        delta: "前文 `BY",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 407,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-split-backtick-marker",
      runId: "transcript-run-2",
      data: {
        delta: 'CLAW_AGENT_EVENT {"agentId":"byclaw-specialist-teammate","nativeSubagentId":"byclaw-specialist-teammate","displayName":"ByClaw specialist teammate","byclawAgentId":"10002983","role":"specialist-teammate","phase":"complete","workflowStepId":"smoke"}`',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 408,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-split-backtick-marker",
      runId: "transcript-run-2",
      data: {
        delta: " 后文",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      senderLabel: "ByClaw specialist teammate",
      content: [{ type: "text", text: "前文后文" }],
    }));
  });

  it("merges assistant prose after an abandoned partial ACP marker into the same native message", async () => {
    const sessionKey = "agent:claude:acp:transcript-abandoned-partial-marker";
    const runId = "transcript-run-abandoned-marker";
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 4081,
      stream: "assistant",
      sessionKey,
      runId,
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-orchestrator-team-lead","nativeSubagentId":"byclaw-orchestrator-team-lead","displayName":"ByClaw orchestrator / team-lead","byclawAgentId":"10002959","role":"orchestrator-team-lead","phase":"start","workflowStepId":"summary"}\n',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 4082,
      stream: "assistant",
      sessionKey,
      runId,
      data: {
        delta: "## 最终汇总：Proof / Risks / Verdict / Next Action\n\n`BYCLAW_AGENT_EVENT {\"agentId\"",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 4083,
      stream: "assistant",
      sessionKey,
      runId,
      data: {
        delta: "Proof: README.md exists. Verdict: PASS.",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      senderLabel: "ByClaw orchestrator / team-lead",
      content: [
        {
          type: "text",
          text: "## 最终汇总：Proof / Risks / Verdict / Next ActionProof: README.md exists. Verdict: PASS.",
        },
      ],
    }));
  });

  it("merges ACP assistant deltas from the same native subagent into one OpenClaw message", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 409,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-merge-deltas",
      runId: "transcript-run-merge",
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","displayName":"ByClaw issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"start","workflowStepId":"triage"}\n',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 410,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-merge-deltas",
      runId: "transcript-run-merge",
      data: {
        delta: "第一段",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 411,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-merge-deltas",
      runId: "transcript-run-merge",
      data: {
        delta: "第二段",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "ByClaw issue-triage",
      content: [{ type: "text", text: "第一段第二段" }],
      stopReason: "stop",
    }));
    expect((runtimeMocks.appendedMessages[0] as any).idempotencyKey).toContain(
      "byclaw-issue-triage",
    );
  });

  it("replaces an existing ACP assistant aggregate when a later cumulative text snapshot corrects spacing", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 414,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-cumulative-replace",
      runId: "transcript-run-cumulative",
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-issue-triage","nativeSubagentId":"byclaw-issue-triage","displayName":"ByClaw issue-triage","byclawAgentId":"10002962","role":"issue-triage","phase":"start","workflowStepId":"triage"}\n',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 415,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-cumulative-replace",
      runId: "transcript-run-cumulative",
      data: {
        delta: "Thebundle loaded.",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 416,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-cumulative-replace",
      runId: "transcript-run-cumulative",
      data: {
        text: "The bundle loaded. More detail.",
        delta: " More detail.",
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      senderLabel: "ByClaw issue-triage",
      content: [{ type: "text", text: "The bundle loaded. More detail." }],
    }));
  });

  it("buffers assistant text until a concrete ACP native subagent is known", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 412,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-buffer-before-agent",
      runId: "transcript-run-buffer",
      data: {
        delta: "先说明",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 413,
      stream: "assistant",
      sessionKey: "agent:claude:acp:transcript-buffer-before-agent",
      runId: "transcript-run-buffer",
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-tester","nativeSubagentId":"byclaw-tester","displayName":"ByClaw tester","byclawAgentId":"10002977","role":"tester","phase":"start","workflowStepId":"test"}\n后说明',
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      senderLabel: "ByClaw tester",
      content: [{ type: "text", text: "先说明后说明" }],
    }));
    expect(runtimeMocks.appendedMessages[0]).not.toEqual(expect.objectContaining({
      senderLabel: "claude",
    }));
  });

  it("writes ACP thinking deltas as native OpenClaw thinking blocks", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 41,
      stream: "acp",
      sessionKey: "agent:claude:acp:thinking-child",
      data: {
        eventType: "thinking_delta",
        delta: "checking tool output",
      },
    }));

    expect(runtimeMocks.appendAssistantMirrorMessageByIdentity).not.toHaveBeenCalled();
    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      senderLabel: "claude",
      content: [{ type: "thinking", thinking: "checking tool output" }],
      stopReason: "stop",
    }));
  });

  it("does not write ACP lifecycle/runtime status events as visible assistant text", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 42,
      stream: "lifecycle",
      data: {
        phase: "start",
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 43,
      stream: "acp",
      data: {
        phase: "runtime_event",
        eventType: "done",
      },
    }));

    expect(runtimeMocks.appendAssistantMirrorMessageByIdentity).not.toHaveBeenCalled();
    expect(runtimeMocks.appendedMessages).toHaveLength(0);
  });

  it("writes structured ACP tool calls even when the raw event has no visible text", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 44,
      stream: "acp",
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call",
        status: "pending",
        title: "grep -n openclaw README.md",
        toolCallId: "call-structured",
      },
    }));

    expect(runtimeMocks.appendAssistantMirrorMessageByIdentity).not.toHaveBeenCalled();
    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      content: [
        expect.objectContaining({
          type: "toolCall",
          id: "call-structured",
          name: "bash",
          arguments: expect.objectContaining({
            command: "grep -n openclaw README.md",
            input: "grep -n openclaw README.md",
          }),
        }),
      ],
      stopReason: "toolUse",
    }));
  });

  it("buffers split structured agent markers instead of mirroring marker fragments", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 45,
      stream: "assistant",
      data: {
        text: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-orchestrator","nativeSubagentId":"byclaw-orchestrator","byclawAgentId":"100',
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-orchestrator","nativeSubagentId":"byclaw-orchestrator","byclawAgentId":"100',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 46,
      stream: "assistant",
      data: {
        text: 'BYCLAW_AGENT_EVENT {"agentId":"byclaw-orchestrator","nativeSubagentId":"byclaw-orchestrator","byclawAgentId":"10002959","role":"orchestrator","phase":"start","workflowStepId":"triage"}\n\n可见正文',
        delta: '02959","role":"orchestrator","phase":"start","workflowStepId":"triage"}\n\n可见正文',
      },
    }));

    expect(runtimeMocks.appendedMessages).toHaveLength(1);
    expect(runtimeMocks.appendedMessages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      content: [{ type: "text", text: "可见正文" }],
      senderLabel: "byclaw-orchestrator",
    }));
    expect((runtimeMocks.appendedMessages[0] as any).openclawDeliveryMirror.agent).toEqual(expect.objectContaining({
      id: "byclaw-orchestrator",
      source: "structured_marker",
      byclawAgentId: "10002959",
    }));
  });

  it("carries split ACP marker identity into later native tool events", async () => {
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 47,
      stream: "assistant",
      data: {
        delta: 'BYCLAW_AGENT_EVENT {"agentId":"orchestrator","nativeSubagentId":"',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 48,
      stream: "assistant",
      data: {
        delta: 'byclaw-orchestrator-team-lead","displayName":"ByClaw orchestrator / team-lead","byclawAgentId":"10002959","role":"orchestrator-team-lead","phase":"start","workflowStepId":"triage"}\n',
      },
    }));
    await mirrorAcpChildEventToParentSession(api, activeRequest, acpEvent({
      seq: 49,
      stream: "acp",
      data: {
        phase: "runtime_event",
        eventType: "tool_call",
        tag: "tool_call_update",
        title: "ls /Users/chenxiaofeng/code/ByClaw/README.md",
        toolCallId: "call-after-split-marker",
        text: "ls /Users/chenxiaofeng/code/ByClaw/README.md: Check README.md existence",
      },
    }));

    const toolMessage = runtimeMocks.appendedMessages.find((message: any) =>
      message?.content?.some?.((block: any) => block?.type === "toolCall" && block?.id === "call-after-split-marker"));
    expect(toolMessage).toBeTruthy();
    const toolCall = (toolMessage as any).content[0];
    expect(toolCall.arguments).toEqual(expect.objectContaining({
      agentId: "byclaw-orchestrator-team-lead",
      agentName: "ByClaw orchestrator / team-lead",
      agentSource: "active_context",
      nativeSubagentId: "byclaw-orchestrator-team-lead",
      byclawAgentId: "10002959",
      role: "orchestrator-team-lead",
      workflowStepId: "triage",
      command: "ls /Users/chenxiaofeng/code/ByClaw/README.md: Check README.md existence",
      input: "ls /Users/chenxiaofeng/code/ByClaw/README.md: Check README.md existence",
    }));
    expect((toolMessage as any).senderLabel).toBe("ByClaw orchestrator / team-lead");
    expect((toolMessage as any).openclawDeliveryMirror.agent).toEqual(expect.objectContaining({
      id: "byclaw-orchestrator-team-lead",
      name: "ByClaw orchestrator / team-lead",
      byclawAgentId: "10002959",
    }));
  });

  it("filters ACP direct announce delivery-mirror raw text and trailing leaf controls", () => {
    const lines = [
      JSON.stringify({ type: "message", id: "parent", message: { role: "assistant", content: [{ type: "text", text: "keep" }] } }),
      JSON.stringify({
        type: "message",
        id: "raw-acp",
        parentId: "parent",
        message: {
          role: "assistant",
          provider: "openclaw",
          model: "delivery-mirror",
          idempotencyKey: "announce:v1:agent:claude:acp:child-1:run-1:text-direct",
          content: [{ type: "text", text: 'BYCLAW_AGENT_EVENT {"agentId":"a"}\nraw child final text' }],
        },
      }),
      JSON.stringify({ type: "leaf", id: "leaf-raw", targetId: "raw-acp", appendParentId: "raw-acp", appendMode: "side" }),
      JSON.stringify({
        type: "message",
        id: "normal-mirror",
        parentId: "parent",
        message: {
          role: "assistant",
          provider: "openclaw",
          model: "delivery-mirror",
          idempotencyKey: "byai-channel:acp-parent-native-assistant:child-1:run-1:assistant:1",
          content: [{ type: "text", text: "structured mirror text" }],
        },
      }),
    ];

    const result = filterAcpDirectAnnounceTranscriptLines(lines);

    expect(result.changed).toBe(true);
    expect(result.removedIds).toEqual(["raw-acp"]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines.join("\n")).not.toContain("BYCLAW_AGENT_EVENT");
    expect(result.lines.join("\n")).toContain("normal-mirror");
  });
});
