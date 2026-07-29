import { afterEach, describe, expect, it, vi } from "vitest";
import { registerByaiHooks } from "./hooks.js";
import {
  clearActiveSdkRequestRecord,
  registerActiveSdkRequest,
  type ActiveSdkRequest,
} from "./session-context.js";

type HookHandler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function captureHooks(): Map<string, HookHandler> {
  const hooks = new Map<string, HookHandler>();
  registerByaiHooks({
    on: (name: string, handler: HookHandler) => {
      hooks.set(name, handler);
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as never);
  return hooks;
}

describe("byai-channel language prompt hook", () => {
  const requests: ActiveSdkRequest[] = [];

  afterEach(() => {
    for (const request of requests.splice(0)) {
      clearActiveSdkRequestRecord(request);
    }
  });

  it.each([
    {
      language: "zh_CN" as const,
      languageProvided: false,
      expectedTitle: "## 渠道语言（强制 · 最高优先级）",
    },
    {
      language: "en_US" as const,
      languageProvided: true,
      expectedTitle: "## Channel language (mandatory · highest priority)",
    },
  ])("injects $language for every active request", ({
    language,
    languageProvided,
    expectedTitle,
  }) => {
    const sessionKey = `agent:main:direct:language-${language}`;
    const request = registerActiveSdkRequest({
      accountId: "default",
      sessionKey,
      to: `user:language-${language}`,
      sessionId: `language-${language}`,
      traceId: `trace-language-${language}`,
      language,
      languageProvided,
    });
    requests.push(request);
    const hook = captureHooks().get("before_prompt_build");

    expect(hook).toBeTypeOf("function");
    const result = hook?.(
      { prompt: "hello" },
      { sessionKey, sessionId: request.sessionId, channelId: "byai-channel" },
    ) as { appendSystemContext?: string };

    expect(result.appendSystemContext).toContain(expectedTitle);
  });
});
