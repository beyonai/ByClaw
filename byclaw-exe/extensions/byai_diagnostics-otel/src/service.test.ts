import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetryState = vi.hoisted(() => {
  const spans: Array<{
    name: string;
    end: ReturnType<typeof vi.fn>;
    setAttributes: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    spanContext: ReturnType<typeof vi.fn>;
  }> = [];
  const tracer = {
    startSpan: vi.fn((name: string) => {
      const spanNumber = spans.length + 1;
      const spanId = spanNumber.toString(16).padStart(16, "0");
      const span = {
        end: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        spanContext: vi.fn(() => ({
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId,
          traceFlags: 1,
        })),
      };
      spans.push({ name, ...span });
      return span;
    }),
    setSpanContext: vi.fn((_ctx: unknown, spanContext: unknown) => ({ spanContext })),
  };
  const meter = {
    createCounter: vi.fn(() => ({ add: vi.fn() })),
    createHistogram: vi.fn(() => ({ record: vi.fn() })),
  };
  return { spans, tracer, meter };
});

const sdkStart = vi.hoisted(() => vi.fn());
const sdkShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const registerUnhandledRejectionHandler = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock("@opentelemetry/api", () => ({
  context: {
    active: () => ({}),
  },
  metrics: {
    getMeter: () => telemetryState.meter,
  },
  trace: {
    getTracer: () => telemetryState.tracer,
    setSpanContext: telemetryState.tracer.setSpanContext,
  },
  SpanKind: {
    SERVER: 1,
    CLIENT: 2,
  },
  SpanStatusCode: {
    ERROR: 2,
  },
  TraceFlags: {
    NONE: 0,
    SAMPLED: 1,
  },
}));

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start = sdkStart;
    shutdown = sdkShutdown;
  },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: function OTLPTraceExporter() {},
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-proto", () => ({
  OTLPMetricExporter: function OTLPMetricExporter() {},
}));

vi.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: function OTLPLogExporter() {},
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: function BatchLogRecordProcessor() {},
  LoggerProvider: class {
    getLogger = vi.fn(() => ({ emit: vi.fn() }));
    shutdown = vi.fn();
  },
}));

vi.mock("@opentelemetry/sdk-metrics", () => ({
  PeriodicExportingMetricReader: function PeriodicExportingMetricReader() {},
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: function BatchSpanProcessor() {},
  ParentBasedSampler: function ParentBasedSampler() {},
  TraceIdRatioBasedSampler: function TraceIdRatioBasedSampler() {},
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn((attrs: Record<string, unknown>) => attrs),
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
}));

vi.mock("@opentelemetry/semantic-conventions/incubating", () => ({
  ATTR_GEN_AI_INPUT_MESSAGES: "gen_ai.input.messages",
  ATTR_GEN_AI_OUTPUT_MESSAGES: "gen_ai.output.messages",
  ATTR_GEN_AI_SYSTEM_INSTRUCTIONS: "gen_ai.system_instructions",
  ATTR_GEN_AI_TOOL_DEFINITIONS: "gen_ai.tool.definitions",
}));

vi.mock("openclaw/plugin-sdk/diagnostic-runtime", () => ({
  isValidDiagnosticTraceId: (value: unknown) =>
    typeof value === "string" && /^[0-9a-f]{32}$/.test(value) && !/^0+$/.test(value),
  isValidDiagnosticSpanId: (value: unknown) =>
    typeof value === "string" && /^[0-9a-f]{16}$/.test(value) && !/^0+$/.test(value),
  isValidDiagnosticTraceFlags: (value: unknown) =>
    typeof value === "string" && /^[0-9a-f]{2}$/.test(value),
}));

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  registerUnhandledRejectionHandler,
}));

vi.mock("openclaw/plugin-sdk/security-runtime", () => ({
  redactSensitiveText: (value: string) => value,
}));

import type { DiagnosticEventMetadata, DiagnosticEventPayload } from "openclaw/plugin-sdk/diagnostic-runtime";
import { createDiagnosticsOtelService } from "./service.js";

type DiagnosticListener = (
  evt: DiagnosticEventPayload,
  metadata: DiagnosticEventMetadata,
  privateData: Record<string, unknown>,
) => void;

function createContext() {
  let listener: DiagnosticListener | undefined;
  return {
    ctx: {
      config: {
        diagnostics: {
          enabled: true,
          otel: {
            enabled: true,
            endpoint: "http://otel-collector:4318",
            protocol: "http/protobuf",
            traces: true,
            metrics: false,
            logs: false,
          },
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      internalDiagnostics: {
        emit: vi.fn(),
        onEvent: vi.fn((handler: DiagnosticListener) => {
          listener = handler;
          return vi.fn();
        }),
      },
    },
    emitTrusted(
      event: Omit<DiagnosticEventPayload, "seq" | "ts"> & { ts?: number },
      privateData: Record<string, unknown> = {},
    ) {
      if (!listener) {
        throw new Error("diagnostic listener not registered");
      }
      listener(
        {
          seq: 1,
          ts: event.ts ?? Date.now(),
          ...event,
        } as DiagnosticEventPayload,
        { trusted: true },
        privateData,
      );
    },
    emitInternal(
      event: Omit<DiagnosticEventPayload, "seq" | "ts"> & { ts?: number },
      privateData: Record<string, unknown> = {},
    ) {
      if (!listener) {
        throw new Error("diagnostic listener not registered");
      }
      listener(
        {
          seq: 1,
          ts: event.ts ?? Date.now(),
          ...event,
        } as DiagnosticEventPayload,
        { trusted: false, internal: true } as DiagnosticEventMetadata,
        privateData,
      );
    },
  };
}

function span(name: string) {
  const found = telemetryState.spans.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`Expected span ${name}`);
  }
  return found;
}

describe("BYAI diagnostics OTel correlation", () => {
  beforeEach(() => {
    telemetryState.spans.length = 0;
    telemetryState.tracer.startSpan.mockClear();
    telemetryState.tracer.setSpanContext.mockClear();
    telemetryState.meter.createCounter.mockClear();
    telemetryState.meter.createHistogram.mockClear();
    sdkStart.mockClear();
    sdkShutdown.mockClear();
    registerUnhandledRejectionHandler.mockClear();
    delete (globalThis as any).__byaiDiagnosticsOtelLangfuseObservationBridge;
    vi.unstubAllEnvs();
  });

  it("parents OpenClaw run and model spans under BYAI SDK inbound spans", async () => {
    const service = createDiagnosticsOtelService({
      includeDiagnosticSessionAttributes: true,
      includeLangfuseSessionAttributes: true,
      includeLangfuseUserAttributes: true,
    });
    const { ctx, emitTrusted } = createContext();
    await service.start(ctx as never);

    const sessionKey = "agent:main:byai-channel:direct:session-1";
    const inboundTrace = {
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      traceFlags: "00",
    };
    const runTrace = {
      traceId: "cccccccccccccccccccccccccccccccc",
      spanId: "dddddddddddddddd",
      traceFlags: "01",
    };
    emitTrusted({
      type: "message.received",
      channel: "byai-channel",
      source: "byai-channel-sdk",
      sessionId: "session-1",
      sessionKey,
      messageId: "message-1",
      userId: "0027024710",
      trace: inboundTrace,
      "byai.traceId": "byai-trace-1",
      ts: 100,
    } as never);
    emitTrusted({
      type: "run.started",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey,
      channel: "byai-channel",
      provider: "openai",
      model: "gpt-5.5",
      trace: runTrace,
      ts: 125,
    });
    emitTrusted({
      type: "model.call.started",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey,
      provider: "openai",
      model: "gpt-5.5",
      api: "responses",
      trace: {
        traceId: runTrace.traceId,
        spanId: "eeeeeeeeeeeeeeee",
        parentSpanId: runTrace.spanId,
        traceFlags: "01",
      },
      ts: 150,
    });
    emitTrusted({
      type: "run.completed",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey,
      channel: "byai-channel",
      provider: "openai",
      model: "gpt-5.5",
      durationMs: 50,
      outcome: "completed",
      trace: runTrace,
      ts: 175,
    });

    const inboundSpan = span("openclaw.message.inbound");
    const runSpan = span("openclaw.run");
    const modelSpan = span("openclaw.model.call");
    const startSpanCalls = telemetryState.tracer.startSpan.mock.calls;
    const inboundCall = startSpanCalls.find(([name]) => name === "openclaw.message.inbound");
    const runCall = startSpanCalls.find(([name]) => name === "openclaw.run");
    const modelCall = startSpanCalls.find(([name]) => name === "openclaw.model.call");

    expect(inboundCall?.[2]).toEqual({
      spanContext: expect.objectContaining({
        traceId: inboundTrace.traceId,
        spanId: inboundTrace.spanId,
        traceFlags: 1,
      }),
    });
    expect(runCall?.[2]).toEqual({
      spanContext: inboundSpan.spanContext(),
    });
    expect(modelCall?.[2]).toEqual({
      spanContext: runSpan.spanContext(),
    });
    expect(inboundCall?.[1]?.attributes).toEqual(
      expect.objectContaining({
        "langfuse.user.id": "0027024710",
        "langfuse.session.id": "session-1",
        "session.id": "session-1",
        "user.id": "0027024710",
        "openclaw.userId": "0027024710",
      }),
    );
    expect(runSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "byai.inbound.linked": true,
        "openclaw.channel": "byai-channel",
        "langfuse.session.id": "session-1",
        "session.id": "session-1",
        "langfuse.user.id": "0027024710",
        "user.id": "0027024710",
      }),
    );
    expect(modelSpan.end).not.toHaveBeenCalled();
    expect(inboundSpan.end).toHaveBeenCalledWith(175);

    await service.stop?.(ctx as never);
  });

  it("falls back to USER_CODE for Langfuse user id when events omit userId", async () => {
    vi.stubEnv("USER_CODE", "sandbox-user-99");
    const service = createDiagnosticsOtelService({
      includeDiagnosticSessionAttributes: true,
      includeLangfuseSessionAttributes: true,
      includeLangfuseUserAttributes: true,
    });
    const { ctx, emitTrusted } = createContext();
    await service.start(ctx as never);

    const sessionKey = "agent:main:byai-channel:direct:session-env";
    emitTrusted({
      type: "run.started",
      runId: "run-env",
      sessionId: "session-env",
      sessionKey,
      channel: "byai-channel",
      provider: "openai",
      model: "gpt-5.5",
      ts: 100,
    } as never);
    emitTrusted({
      type: "run.completed",
      runId: "run-env",
      sessionId: "session-env",
      sessionKey,
      channel: "byai-channel",
      provider: "openai",
      model: "gpt-5.5",
      durationMs: 10,
      outcome: "completed",
      ts: 120,
    } as never);

    const runCall = telemetryState.tracer.startSpan.mock.calls.find(
      ([name]) => name === "openclaw.run",
    );
    expect(runCall?.[1]?.attributes).toEqual(
      expect.objectContaining({
        "langfuse.user.id": "sandbox-user-99",
        "langfuse.session.id": "session-env",
        "session.id": "session-env",
        "user.id": "sandbox-user-99",
      }),
    );

    await service.stop?.(ctx as never);
    vi.unstubAllEnvs();
  });

  it("attaches BYAI first response and token usage attributes to the message span", async () => {
    const service = createDiagnosticsOtelService({
      includeDiagnosticSessionAttributes: true,
      includeLangfuseSessionAttributes: true,
    });
    const { ctx, emitTrusted } = createContext();
    await service.start(ctx as never);

    const sessionKey = "agent:main:byai-channel:direct:session-observable";
    const trace = {
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      traceFlags: "01",
    };
    emitTrusted({
      type: "message.received",
      channel: "byai-channel",
      source: "byai-channel-sdk",
      sessionId: "session-observable",
      sessionKey,
      messageId: "message-observable",
      trace,
      "byai.traceId": trace.traceId,
      ts: 100,
    } as never);
    emitTrusted({
      type: "message.dispatch.started",
      channel: "byai-channel",
      source: "byai-channel-sdk",
      sessionId: "session-observable",
      sessionKey,
      trace,
      "byai.traceId": trace.traceId,
      ts: 110,
    } as never);
    emitTrusted({
      type: "run.progress",
      runId: "",
      reason: "byai.first_visible_response",
      sessionId: "session-observable",
      sessionKey,
      trace,
      "byai.firstResponseMs": 1234,
      "byai.firstResponseEventType": "REASONING_LOG_DELTA",
      "byai.traceId": trace.traceId,
      ts: 250,
    } as never);
    emitTrusted({
      type: "run.progress",
      runId: "",
      reason: "byai.first_answer_delta",
      sessionId: "session-observable",
      sessionKey,
      trace,
      "byai.firstResponseMs": 2345,
      "byai.firstResponseEventType": "ANSWER_DELTA",
      "byai.traceId": trace.traceId,
      ts: 350,
    } as never);
    emitTrusted({
      type: "model.usage",
      sessionId: "session-observable",
      sessionKey,
      provider: "openai",
      model: "gpt-5.5",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        total: 20,
      },
      trace,
      "byai.traceId": trace.traceId,
      ts: 400,
    } as never);

    const messageSpan = span("openclaw.message.processed");
    expect(messageSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "byai.first_visible_response_ms": 1234,
        "byai.first_visible_response_event_type": "REASONING_LOG_DELTA",
        "langfuse.observation.metadata.byai_first_visible_response_ms": 1234,
        "langfuse.observation.metadata.byai_first_visible_response_event_type":
          "REASONING_LOG_DELTA",
      }),
    );
    expect(messageSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "byai.first_answer_delta_ms": 2345,
        "byai.first_answer_delta_event_type": "ANSWER_DELTA",
        "langfuse.observation.metadata.byai_first_answer_delta_ms": 2345,
        "langfuse.observation.metadata.byai_first_answer_delta_event_type": "ANSWER_DELTA",
      }),
    );
    expect(messageSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "byai.tokens.input": 15,
        "byai.tokens.output": 5,
        "byai.tokens.cache_read": 3,
        "byai.tokens.cache_write": 2,
        "byai.tokens.total": 20,
        "langfuse.observation.metadata.byai_tokens_input": 15,
        "langfuse.observation.metadata.byai_tokens_output": 5,
        "langfuse.observation.metadata.byai_tokens_cache_read": 3,
        "langfuse.observation.metadata.byai_tokens_cache_write": 2,
        "langfuse.observation.metadata.byai_tokens_total": 20,
      }),
    );
    expect(span("openclaw.model.usage").end).toHaveBeenCalledWith(400);

    await service.stop?.(ctx as never);
  });

  it("exports Langfuse usage and first-token timing on model call spans", async () => {
    const service = createDiagnosticsOtelService();
    const { ctx, emitTrusted } = createContext();
    await service.start(ctx as never);

    emitTrusted(
      {
        type: "model.call.completed",
        runId: "run-model",
        sessionId: "session-model",
        sessionKey: "agent:main:byai-channel:direct:session-model",
        provider: "openai",
        model: "gpt-5.5",
        api: "responses",
        durationMs: 1000,
        requestPayloadBytes: 100,
        responseStreamBytes: 200,
        timeToFirstByteMs: 250,
        ts: 2000,
      } as never,
      {
        modelContent: {
          outputMessages: [
            {
              role: "assistant",
              content: "ok",
              usage: {
                input: 10,
                output: 7,
                cacheRead: 2,
                cacheWrite: 1,
                total: 20,
              },
            },
          ],
        },
      },
    );

    expect(span("openclaw.model.call").setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.usage.input_tokens": 13,
        "gen_ai.usage.output_tokens": 7,
        "gen_ai.usage.prompt_tokens": 13,
        "gen_ai.usage.completion_tokens": 7,
        "gen_ai.usage.total_tokens": 20,
        "langfuse.observation.usage_details":
          '{"input":13,"output":7,"total":20,"cache_read":2,"cache_write":1}',
        "langfuse.observation.metadata.openclaw_time_to_first_byte_ms": 250,
        "langfuse.observation.completion_start_time": new Date(1250).toISOString(),
      }),
    );

    await service.stop?.(ctx as never);
  });

  it("publishes the active tool span id for plugin tools and clears it after completion", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "byai-otel-bridge-"));
    vi.stubEnv("BYAI_LANGFUSE_OBSERVATION_BRIDGE_FILE", path.join(dir, "bridge.json"));
    const service = createDiagnosticsOtelService();
    const { ctx, emitTrusted } = createContext();
    await service.start(ctx as never);
    const nowMs = Date.now();

    emitTrusted({
      type: "tool.execution.started",
      runId: "run-tool",
      sessionKey: "session-tool",
      toolCallId: "call-tool",
      toolName: "baiying_call",
      toolSource: "plugin",
      toolOwner: "baiying-enhance",
      ts: nowMs,
    } as never);

    const bridge = (globalThis as any).__byaiDiagnosticsOtelLangfuseObservationBridge;
    expect(bridge?.getToolObservationId?.({
      runId: "run-tool",
      sessionKey: "session-tool",
      toolCallId: "call-tool",
    })).toBe("0000000000000001");
    expect(bridge?.getToolTraceId?.({
      runId: "run-tool",
      sessionKey: "session-tool",
      toolCallId: "call-tool",
    })).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "bridge.json"), "utf8")).entries[
        "session:session-tool:tool:call-tool"
      ].observationId,
    ).toBe("0000000000000001");
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "bridge.json"), "utf8")).entries[
        "session:session-tool:tool:call-tool"
      ].traceId,
    ).toBe("4bf92f3577b34da6a3ce929d0e0e4736");

    emitTrusted({
      type: "tool.execution.completed",
      runId: "run-tool",
      sessionKey: "session-tool",
      toolCallId: "call-tool",
      toolName: "baiying_call",
      toolSource: "plugin",
      toolOwner: "baiying-enhance",
      durationMs: 25,
      ts: nowMs + 25,
    } as never);

    expect(bridge?.getToolObservationId?.({
      runId: "run-tool",
      sessionKey: "session-tool",
      toolCallId: "call-tool",
    })).toBeUndefined();
    expect(bridge?.getToolTraceId?.({
      runId: "run-tool",
      sessionKey: "session-tool",
      toolCallId: "call-tool",
    })).toBeUndefined();

    await service.stop?.(ctx as never);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("builds inbound spans for native channels when allowlisted", async () => {
    const service = createDiagnosticsOtelService({
      includeDiagnosticSessionAttributes: true,
      includeLangfuseSessionAttributes: true,
      inboundChannels: { channels: ["webchat"] },
    });
    const { ctx, emitInternal } = createContext();
    await service.start(ctx as never);

    const sessionKey = "webchat:session-native";
    const inboundTrace = {
      traceId: "1111111111111111111111111111aaaa",
      spanId: "11111111aaaa1111",
      traceFlags: "01",
    };
    const dispatchTrace = {
      traceId: "1111111111111111111111111111aaaa",
      spanId: "22221111bbbb1111",
      traceFlags: "01",
    };
    emitInternal({
      type: "message.received",
      channel: "webchat",
      sessionId: "session-native",
      sessionKey,
      messageId: "message-native",
      trace: inboundTrace,
      ts: 100,
    } as never);
    emitInternal({
      type: "message.dispatch.started",
      channel: "webchat",
      sessionId: "session-native",
      sessionKey,
      trace: dispatchTrace,
      ts: 110,
    } as never);
    emitInternal({
      type: "model.usage",
      sessionId: "session-native",
      sessionKey,
      channel: "webchat",
      provider: "openai",
      model: "gpt-5.5",
      usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, total: 20 },
      trace: dispatchTrace,
      ts: 200,
    } as never);
    emitInternal({
      type: "message.dispatch.completed",
      channel: "webchat",
      sessionId: "session-native",
      sessionKey,
      trace: dispatchTrace,
      outcome: "success",
      durationMs: 150,
      ts: 250,
    } as never);

    const inboundSpan = span("openclaw.message.inbound");
    const messageSpan = span("openclaw.message.processed");
    const startSpanCalls = telemetryState.tracer.startSpan.mock.calls;
    const inboundCall = startSpanCalls.find(([name]) => name === "openclaw.message.inbound");
    const messageProcessedCall = startSpanCalls.find(
      ([name]) => name === "openclaw.message.processed",
    );
    expect(inboundCall?.[2]).toEqual({
      spanContext: expect.objectContaining({
        traceId: inboundTrace.traceId,
        spanId: inboundTrace.spanId,
        traceFlags: 1,
      }),
    });
    expect(messageProcessedCall?.[2]).toEqual({
      spanContext: inboundSpan.spanContext(),
    });
    expect(messageSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "byai.tokens.input": 15,
        "byai.tokens.output": 5,
        "byai.tokens.total": 20,
      }),
    );
    expect(inboundSpan.end).toHaveBeenCalledWith(250);

    await service.stop?.(ctx as never);
  });

  it("skips inbound spans for non-allowlisted channels by default", async () => {
    const service = createDiagnosticsOtelService({
      includeLangfuseSessionAttributes: true,
    });
    const { ctx, emitTrusted } = createContext();
    await service.start(ctx as never);

    emitTrusted({
      type: "message.received",
      channel: "webchat",
      sessionId: "session-default",
      sessionKey: "webchat:session-default",
      messageId: "message-default",
      trace: {
        traceId: "22222222222222222222222222222222",
        spanId: "cccccccccccccccc",
        traceFlags: "01",
      },
      ts: 100,
    } as never);

    const inboundStart = telemetryState.tracer.startSpan.mock.calls.find(
      ([name]) => name === "openclaw.message.inbound",
    );
    expect(inboundStart).toBeUndefined();

    await service.stop?.(ctx as never);
  });
});
