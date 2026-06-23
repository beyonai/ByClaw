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
    emitTrusted(event: Omit<DiagnosticEventPayload, "seq" | "ts"> & { ts?: number }) {
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
        {},
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
});
