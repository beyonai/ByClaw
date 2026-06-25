import { describe, expect, it, vi } from "vitest";
import { buildCompactionNoticeText } from "./i18n.js";

vi.mock("./session-context.js", () => ({
  getSessionPathBySessionId: (sessionId: string) => `/tmp/${sessionId}`,
}));

describe("buildCompactionNoticeText", () => {
  it("builds Chinese compaction start and recovered notices", () => {
    expect(buildCompactionNoticeText("zh_CN", { phase: "start" })).toBe(
      "上下文自动压缩开始",
    );
    expect(
      buildCompactionNoticeText("zh_CN", {
        phase: "end",
        completed: true,
        willRetry: true,
      }),
    ).toBe("上下文自动压缩完成");
  });

  it("builds English compaction start and recovered notices", () => {
    expect(buildCompactionNoticeText("en_US", { phase: "start" })).toBe(
      "Automatic context compression started.",
    );
    expect(
      buildCompactionNoticeText("en_US", {
        phase: "end",
        completed: true,
        willRetry: true,
      }),
    ).toBe("Automatic context compression completed.");
  });
});
