import { describe, expect, it, vi } from "vitest";
import { buildSessionFilesPrompt } from "./i18n.js";

vi.mock("./session-context.js", () => ({
  getSessionPathBySessionId: (sessionId: string) => `/by/.sessions/${sessionId.trim()}`,
}));

describe("buildSessionFilesPrompt directory routing", () => {
  it("maps session and shared aliases to the backend canonical roots", () => {
    const prompt = buildSessionFilesPrompt("session-42", "zh-CN");

    expect(prompt).toContain(".session` 仅是用户口语别名");
    expect(prompt).toContain("UserFS 路径为 `/.sessions/session-42/`");
    expect(prompt).toContain("沙箱绝对路径时使用 `/by/.sessions/session-42/`");
    expect(prompt).toContain("UserFS 路径为 `/.shared/`");
    expect(prompt).toContain("沙箱绝对路径时使用 `/by/.shared/`");
    expect(prompt).toContain("禁止创建或使用 `/session`、`/.session`");
  });

  it("exposes the same routing contract in English", () => {
    const prompt = buildSessionFilesPrompt("session-42", "en-US");

    expect(prompt).toContain("Session aliases");
    expect(prompt).toContain("UserFS path `/.sessions/session-42/`");
    expect(prompt).toContain("sandbox absolute path, use `/by/.sessions/session-42/`");
    expect(prompt).toContain("UserFS path `/.shared/`");
    expect(prompt).toContain("sandbox absolute path, use `/by/.shared/`");
    expect(prompt).toContain("Do not create or use parallel paths");
  });
});
