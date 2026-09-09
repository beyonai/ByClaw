import type { GatewayDataEmitter } from "@byclaw/by-framework";
import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/runtime-store", () => ({
    createPluginRuntimeStore: () => {
        let runtime: unknown;
        return {
            setRuntime: (value: unknown) => {
                runtime = value;
            },
            tryGetRuntime: () => runtime,
            getRuntime: () => {
                if (!runtime) throw new Error("runtime unavailable");
                return runtime;
            },
        };
    },
}));

vi.mock("./diagnostics.js", () => ({
    emitByaiSdkFirstResponse: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/routing", () => ({
    resolveAgentIdFromSessionKey: () => "main",
}));

import {
    bindActiveSdkRequestRunId,
    clearActiveSdkRequestRecord,
    completeActiveSdkRequest,
    markActiveSdkRootLifecycleFinished,
    registerActiveSdkRequest,
    registerAgentRunEndPromise,
    registerSdkEmitter,
} from "./session-context.js";
import { waitForSdkSessionDispatchSettled } from "./session-dispatch-settle.js";

describe("active SDK request cancellation", () => {
    it("stops waiting for agent_end when onCancelTask clears its resolver", async () => {
        const accountId = "abort-agent-end";
        const abortController = new AbortController();
        const emitter = {
            emitChunk: vi.fn(),
            emitState: vi.fn(),
        } as unknown as GatewayDataEmitter;
        registerSdkEmitter(accountId, emitter);
        const request = registerActiveSdkRequest({
            accountId,
            sessionKey: "agent:main:direct:abort-agent-end",
            to: "user:abort-agent-end",
            sessionId: "abort-agent-end",
            traceId: "trace-abort-agent-end",
            language: "zh_CN",
            languageProvided: true,
            abortController,
        });
        bindActiveSdkRequestRunId(request.sessionKey, "run-abort-agent-end");
        registerAgentRunEndPromise("run-abort-agent-end");
        markActiveSdkRootLifecycleFinished(request.sessionKey, "error");
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        const completion = completeActiveSdkRequest(request);
        abortController.abort(new Error("user stopped"));
        clearActiveSdkRequestRecord(request);

        await expect(completion).resolves.toBe(false);
        expect(emitter.emitChunk).not.toHaveBeenCalled();
        expect(emitter.emitState).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalledWith(
            "Error waiting for agent end result:",
            expect.objectContaining({
                message: "waiting for agent end result timeout",
            })
        );
        consoleError.mockRestore();
    });

    it("does not wait for remaining business gates after cancellation", async () => {
        const abortController = new AbortController();
        const request = registerActiveSdkRequest({
            accountId: "abort-settle",
            sessionKey: "agent:main:direct:abort-settle",
            to: "user:abort-settle",
            sessionId: "abort-settle",
            traceId: "trace-abort-settle",
            language: "zh_CN",
            languageProvided: true,
            abortController,
        });
        bindActiveSdkRequestRunId(request.sessionKey, "run-abort-settle");
        request.pendingOutboundCount = 1;
        request.awaitingFollowup = true;
        request.followupRunStarted = true;
        abortController.abort(new Error("user cancelled"));

        const result = await waitForSdkSessionDispatchSettled(
            request.sessionKey,
            {
                abortSignal: abortController.signal,
                pollMs: 1000,
                timeoutMs: 30_000,
            }
        );

        expect(result).toMatchObject({ settled: true, timedOut: false });
        clearActiveSdkRequestRecord(request);
    });
});
