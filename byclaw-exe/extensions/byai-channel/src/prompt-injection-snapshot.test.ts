import { describe, expect, it, vi } from "vitest";
import {
    buildPromptInjectionSnapshot,
    clearPromptInjectionSnapshot,
    resetPromptInjectionSnapshotsForTest,
    setPromptInjectionSnapshot,
    takePromptInjectionSnapshot,
} from "./prompt-injection-snapshot.js";
import type { ActiveSdkRequest } from "./session-context.js";

vi.mock("./session-context.js", () => ({
    getSessionPathBySessionId: (sessionId: string) => `/tmp/${sessionId}`,
}));

function mockRequest(overrides: Partial<ActiveSdkRequest> = {}): ActiveSdkRequest {
    return {
        accountId: "default",
        sessionKey: "agent:main:direct:100",
        to: "user:100",
        sessionId: "100",
        traceId: "trace-1",
        createdAt: Date.now(),
        boundRunIds: new Set(),
        pendingChildSessionKeys: new Set(),
        pendingOutboundCount: 0,
        awaitingFollowup: false,
        deferredForFollowup: false,
        followupRunStarted: false,
        lastReasoningText: "",
        lastReasoningMessageId: "",
        language: "zh-CN",
        languageProvided: true,
        channelExtension: { channelType: "web" },
        ...overrides,
    };
}

describe("prompt-injection-snapshot", () => {
    it("stores and returns appendSystemContext for before_prompt_build", () => {
        resetPromptInjectionSnapshotsForTest();
        const request = mockRequest();
        const snapshot = buildPromptInjectionSnapshot({
            request,
            workspaceDir: "/tmp/agent-main",
        });
        setPromptInjectionSnapshot(request.sessionKey, snapshot);

        const taken = takePromptInjectionSnapshot(request.sessionKey);
        expect(taken?.appendSystemContext).toContain("Session Root");
        expect(taken?.appendSystemContext).toContain("Skill 安装工作规范");
        expect(taken?.appendSystemContext).toContain("/tmp/agent-main/skills");
        expect(taken?.appendSystemContext).toContain("OpenClaw Workshop");
        expect(taken?.appendSystemContext).toContain("channelType");
        expect(taken?.appendSystemContext).toContain("渠道语言");

        clearPromptInjectionSnapshot(request.sessionKey);
        expect(takePromptInjectionSnapshot(request.sessionKey)).toBeUndefined();
    });
});
