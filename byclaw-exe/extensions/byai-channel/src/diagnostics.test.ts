import { describe, expect, it, vi } from "vitest";

const diagnosticRuntimeMock = vi.hoisted(() => ({
  emitTrustedDiagnosticEvent: vi.fn(),
  createDiagnosticTraceContext: vi.fn(
    (input: { traceId?: string } = {}) => ({
      traceId: input.traceId ?? "99999999999999999999999999999999",
      spanId: "1111111111111111",
      traceFlags: "01",
    }),
  ),
  freezeDiagnosticTraceContext: vi.fn((trace: unknown) => Object.freeze({ ...(trace as object) })),
  isValidDiagnosticTraceId: vi.fn(
    (value: unknown) =>
      typeof value === "string" &&
      /^[0-9a-f]{32}$/.test(value) &&
      !/^0+$/.test(value),
  ),
}));

vi.mock("openclaw/plugin-sdk/diagnostic-runtime", () => diagnosticRuntimeMock);

import {
  createByaiSdkDiagnosticTrace,
  emitByaiSdkDispatchCompleted,
  emitByaiSdkDispatchStarted,
  emitByaiSdkMessageReceived,
  runWithByaiSdkDiagnosticTrace,
} from "./diagnostics.js";

describe("byai SDK diagnostics", () => {
  it("uses valid BYAI trace ids as diagnostic trace ids", () => {
    const trace = createByaiSdkDiagnosticTrace("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    expect(trace.trace.traceId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(trace.byaiTraceId).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(diagnosticRuntimeMock.createDiagnosticTraceContext).toHaveBeenCalledWith({
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("keeps invalid BYAI trace ids as attributes instead of faking W3C ids", () => {
    const trace = createByaiSdkDiagnosticTrace("byai-trace-1");

    expect(trace.trace.traceId).toBe("99999999999999999999999999999999");
    expect(trace.byaiTraceId).toBe("byai-trace-1");
    expect(diagnosticRuntimeMock.createDiagnosticTraceContext).toHaveBeenCalledWith({});
  });

  it("emits trusted inbound and dispatch diagnostics for SDK messages", () => {
    diagnosticRuntimeMock.emitTrustedDiagnosticEvent.mockClear();
    const trace = createByaiSdkDiagnosticTrace("byai-trace-2");
    const ref = {
      sessionId: "session-1",
      sessionKey: "agent:main:byai-channel:direct:session-1",
      messageId: "message-1",
      userId: "0027024710",
      traceId: "byai-trace-2",
    };

    emitByaiSdkMessageReceived(ref, trace);
    const startedAt = emitByaiSdkDispatchStarted(ref, trace);
    emitByaiSdkDispatchCompleted(ref, trace, {
      startedAt,
      outcome: "completed",
    });

    expect(diagnosticRuntimeMock.emitTrustedDiagnosticEvent).toHaveBeenCalledTimes(3);
    expect(diagnosticRuntimeMock.emitTrustedDiagnosticEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "message.received",
        channel: "byai-channel",
        source: "byai-channel-sdk",
        sessionId: ref.sessionId,
        sessionKey: ref.sessionKey,
        messageId: ref.messageId,
        userId: ref.userId,
        "byai.traceId": "byai-trace-2",
      }),
    );
    expect(diagnosticRuntimeMock.emitTrustedDiagnosticEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "message.dispatch.started",
        source: "byai-channel-sdk",
      }),
    );
    expect(diagnosticRuntimeMock.emitTrustedDiagnosticEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: "message.dispatch.completed",
        source: "byai-channel-sdk",
        outcome: "completed",
      }),
    );
  });

  it("runs SDK dispatch inside the BYAI diagnostic trace scope", () => {
    const trace = createByaiSdkDiagnosticTrace("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    expect(runWithByaiSdkDiagnosticTrace(trace, () => "ok")).toBe("ok");
    expect(diagnosticRuntimeMock.freezeDiagnosticTraceContext).toHaveBeenCalledWith(trace.trace);
  });
});
