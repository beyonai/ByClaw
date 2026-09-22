import { describe, expect, it, vi } from "vitest";
import { buildCompactionNoticeText } from "./i18n.js";

vi.mock("./session-context.js", () => ({
  getSessionPathBySessionId: (sessionId: string) => `/tmp/${sessionId}`,
}));

describe("buildCompactionNoticeText", () => {
  it("does not announce success for a failed compaction", () => {
    expect(buildCompactionNoticeText("zh_CN", { phase: "end", completed: false })).toBe("上下文自动压缩失败");
    expect(buildCompactionNoticeText("zh_CN", { phase: "end", completed: false, willRetry: true })).toContain("正在重试");
    expect(buildCompactionNoticeText("en_US", { phase: "end", completed: false })).toContain("failed");
  });
  it("builds Chinese compaction start and recovered notices", () => {
    expect(buildCompactionNoticeText("zh_CN", { phase: "start" })).toBe(
      "正在自动压缩上下文",
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
      "Automatically compressing context.",
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
