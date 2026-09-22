import { describe, expect, it, vi } from "vitest";
import {
  buildCompactionNoticeText,
  buildContextFailureText,
  buildContextOverflowText,
  buildContextRecoveryText,
} from "./i18n.js";

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

describe("context recovery internationalization", () => {
  it.each(["zh_CN", "en_US"] as const)("localizes all recovery stages and advice in %s", (language) => {
    const english = language === "en_US";
    const texts: string[] = [];
    for (const attempt of [1, 2, 3]) {
      const start = buildContextRecoveryText(language, "start", attempt);
      expect(start).toBe(english
        ? `Automatically compressing context (recovery ${attempt}/3).`
        : `正在自动压缩上下文（第 ${attempt}/3 次恢复）`);
      texts.push(start);
    }
    const retry = buildContextRecoveryText(language, "retry", 1);
    expect(retry).toBe(english
      ? "Context compressed. Automatically resending your question."
      : "上下文已压缩，正在自动重新发送您的问题");
    texts.push(retry);

    const failed = buildContextFailureText(language, "recovery_failed");
    expect(failed).toContain(english ? "necessary background and key details" : "必要的背景和关键条件");
    expect(failed).toContain(english ? "Start a new conversation" : "新建对话");
    expect(buildContextRecoveryText(language, "failed", 3)).toBe(failed);
    expect(buildContextOverflowText(language)).toBe(failed);
    const input = buildContextFailureText(language, "input_too_large");
    expect(input).toContain(english ? "relevant sections" : "相关章节");
    expect(input).not.toContain(english ? "new conversation" : "新建对话");
    const pending = buildContextFailureText(language, "operation_pending");
    expect(pending).toContain(english ? "contact an administrator" : "联系管理员");
    texts.push(failed, input, pending);
    for (const text of texts) {
      expect(/\p{Script=Han}/u.test(text)).toBe(!english);
      expect(text).not.toMatch(/prompt too large|Try \/reset|ByaiContextError/);
    }
  });

  it("uses the existing locale aliases and default without adding a separate language policy", () => {
    for (const language of ["en", "en-US", "en_GB", " EN_us "]) {
      expect(buildContextRecoveryText(language, "start", 2)).toBe(buildContextRecoveryText("en_US", "start", 2));
      expect(buildContextFailureText(language, "operation_pending")).toBe(buildContextFailureText("en_US", "operation_pending"));
    }
    for (const language of [undefined, "", "zh-CN", "unsupported"]) {
      expect(buildContextFailureText(language, "recovery_failed")).toBe(buildContextFailureText("zh_CN", "recovery_failed"));
    }
  });
});
