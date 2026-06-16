import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLangfuseParentObservationId } from "./langfuse-observation.js";

describe("resolveLangfuseParentObservationId", () => {
  const bridgeKey = "__byaiDiagnosticsOtelLangfuseObservationBridge";
  const previousBridge = (globalThis as any)[bridgeKey];

  afterEach(() => {
    if (previousBridge === undefined) {
      delete (globalThis as any)[bridgeKey];
    } else {
      (globalThis as any)[bridgeKey] = previousBridge;
    }
    vi.unstubAllEnvs();
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
});
