import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordLangfuseSessionObservation,
  resolveLangfuseParentObservationId,
  resolveLangfuseTraceId,
  setActiveLangfuseSessionId,
} from "./langfuse-observation.js";

const otelMock = vi.hoisted(() => ({
  activeSpan: undefined as any,
  context: { active: vi.fn(() => ({ active: true })) },
  tracer: { startSpan: vi.fn() },
  setSpanContext: vi.fn((_ctx, spanContext) => ({ spanContext })),
}));

vi.mock(
  "@opentelemetry/api",
  () => ({
    context: otelMock.context,
    trace: {
      getActiveSpan: () => otelMock.activeSpan,
      getTracer: () => otelMock.tracer,
      setSpanContext: otelMock.setSpanContext,
    },
  }),
  { virtual: true },
);

describe("resolveLangfuseParentObservationId", () => {
  const bridgeKey = "__byaiDiagnosticsOtelLangfuseObservationBridge";
  const previousBridge = (globalThis as any)[bridgeKey];

  afterEach(() => {
    if (previousBridge === undefined) {
      delete (globalThis as any)[bridgeKey];
    } else {
      (globalThis as any)[bridgeKey] = previousBridge;
    }
    otelMock.activeSpan = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    otelMock.tracer.startSpan.mockReset();
    otelMock.context.active.mockClear();
    otelMock.setSpanContext.mockClear();
  });

  it("uses explicit Langfuse parent observation id from tool context", async () => {
    await expect(
      resolveLangfuseParentObservationId({
        langfuseParentObservationId: "obs-parent-1",
      }),
    ).resolves.toBe("obs-parent-1");
  });

  it("uses current span id from span-like context fields", async () => {
    await expect(
      resolveLangfuseParentObservationId({
        currentSpan: {
          spanContext: () => ({
            spanId: "405506aa1c59aa26",
          }),
        },
      }),
    ).resolves.toBe("405506aa1c59aa26");
  });

  it("uses plain diagnostic trace span id from tool context", async () => {
    await expect(
      resolveLangfuseParentObservationId({
        trace: {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "405506aa1c59aa26",
          traceFlags: "01",
        },
      }),
    ).resolves.toBe("405506aa1c59aa26");
  });

  it("uses plain diagnostic trace id from tool context", async () => {
    await expect(
      resolveLangfuseTraceId({
        trace: {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "405506aa1c59aa26",
          traceFlags: "01",
        },
      }),
    ).resolves.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("uses a valid inbound channel trace id as the Langfuse trace id", async () => {
    otelMock.activeSpan = {
      spanContext: () => ({
        traceId: "11111111111111111111111111111111",
        spanId: "405506aa1c59aa26",
      }),
    };

    await expect(
      resolveLangfuseTraceId({
        channel_trace_id: "4BF92F3577B34DA6A3CE929D0E0E4736",
      }),
    ).resolves.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("uses diagnostics OTel bridge observation id for the current tool call", async () => {
    const getToolObservationId = vi.fn(() => "405506aa1c59aa26");
    (globalThis as any)[bridgeKey] = {
      getToolObservationId,
    };

    await expect(
      resolveLangfuseParentObservationId({
        toolCallId: "call-1",
        runId: "run-1",
        requesterSessionKey: "session-1",
      }),
    ).resolves.toBe("405506aa1c59aa26");
    expect(getToolObservationId).toHaveBeenCalledWith({
      toolCallId: "call-1",
      runId: "run-1",
      sessionKey: "session-1",
    });
  });

  it("uses diagnostics OTel bridge trace id for the current tool call", async () => {
    const getToolTraceId = vi.fn(() => "4bf92f3577b34da6a3ce929d0e0e4736");
    (globalThis as any)[bridgeKey] = {
      getToolTraceId,
    };

    await expect(
      resolveLangfuseTraceId({
        toolCallId: "call-1",
        runId: "run-1",
        requesterSessionKey: "session-1",
      }),
    ).resolves.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(getToolTraceId).toHaveBeenCalledWith({
      toolCallId: "call-1",
      runId: "run-1",
      sessionKey: "session-1",
    });
  });

  it("uses diagnostics OTel shared file observation id for the current tool call", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "baiying-langfuse-"));
    const bridgeFile = path.join(dir, "bridge.json");
    vi.stubEnv("BYAI_LANGFUSE_OBSERVATION_BRIDGE_FILE", bridgeFile);
    await fs.writeFile(
      bridgeFile,
      JSON.stringify({
        entries: {
          "session:session-file:tool:call-file": {
            observationId: "405506aa1c59aa26",
          },
        },
      }),
      "utf8",
    );

    try {
      await expect(
        resolveLangfuseParentObservationId({
          toolCallId: "call-file",
          requesterSessionKey: "session-file",
        }),
      ).resolves.toBe("405506aa1c59aa26");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("uses diagnostics OTel shared file trace id for the current tool call", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "baiying-langfuse-"));
    const bridgeFile = path.join(dir, "bridge.json");
    vi.stubEnv("BYAI_LANGFUSE_OBSERVATION_BRIDGE_FILE", bridgeFile);
    await fs.writeFile(
      bridgeFile,
      JSON.stringify({
        entries: {
          "session:session-file:tool:call-file": {
            observationId: "405506aa1c59aa26",
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          },
        },
      }),
      "utf8",
    );

    try {
      await expect(
        resolveLangfuseTraceId({
          toolCallId: "call-file",
          requesterSessionKey: "session-file",
        }),
      ).resolves.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("sets Langfuse session attributes on the active span", async () => {
    const setAttribute = vi.fn();
    otelMock.activeSpan = { setAttribute };
    vi.stubEnv("USER_CODE", "user-1");

    await expect(setActiveLangfuseSessionId(" session-1 ")).resolves.toBe(true);
    expect(setAttribute).toHaveBeenCalledWith("langfuse.session.id", "session-1");
    expect(setAttribute).toHaveBeenCalledWith("session.id", "session-1");
    expect(setAttribute).toHaveBeenCalledWith("langfuse_session_id", "session-1");
    expect(setAttribute).toHaveBeenCalledWith("openclaw.session_id", "session-1");
    expect(setAttribute).toHaveBeenCalledWith("langfuse.user.id", "user-1");
    expect(setAttribute).toHaveBeenCalledWith("user.id", "user-1");
  });

  it("records a session marker observation in the supplied trace context", async () => {
    const end = vi.fn();
    otelMock.tracer.startSpan.mockReturnValue({ end });
    vi.stubEnv("USER_CODE", "user-1");

    await expect(
      recordLangfuseSessionObservation({
        sessionId: " session-1 ",
        trace: {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "405506aa1c59aa26",
          traceFlags: "01",
        },
      }),
    ).resolves.toBe(true);

    expect(otelMock.setSpanContext).toHaveBeenCalledWith(
      { active: true },
      {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "405506aa1c59aa26",
        traceFlags: 1,
        isRemote: true,
      },
    );
    expect(otelMock.tracer.startSpan).toHaveBeenCalledWith(
      "baiying.langfuse.session",
      {
        attributes: expect.objectContaining({
          "langfuse.session.id": "session-1",
          "session.id": "session-1",
          "langfuse.user.id": "user-1",
          "user.id": "user-1",
        }),
      },
      { spanContext: expect.any(Object) },
    );
    expect(end).toHaveBeenCalledOnce();
  });
});
