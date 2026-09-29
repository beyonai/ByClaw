import { describe, expect, it } from "vitest";
import { ByaiContextError, classifyContextFailure, publicContextErrorText, toPublicContextError } from "./context-errors.js";
import { isRecoverableContextPreflightError } from "./dispatch-error.js";

describe("context error boundaries", () => {
  it.each([
    "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session.",
    "Preflight compaction required but failed: Compaction timed out",
    "Compaction timed out",
  ])("replaces raw infrastructure errors with actionable advice: %s", (raw) => {
    const error = toPublicContextError(new Error(raw), "zh_CN") as Error;
    expect(error).toBeInstanceOf(ByaiContextError);
    expect(error.message).toContain("历史记录已保留");
    expect(error.message).toContain("必要的背景和关键条件");
    expect(String(error)).not.toMatch(/prompt too large|Try \/reset|Compaction timed out/);
    expect(error.cause).toBeUndefined();
  });

  it("distinguishes proven oversized submissions from oversized history", () => {
    const input = Object.assign(new Error("too many bytes"), { code: "attachment_too_large" });
    expect(classifyContextFailure(input)).toBe("input_too_large");
    expect(publicContextErrorText(input, "zh_CN")).toContain("相关章节");
    expect(publicContextErrorText(input, "zh_CN")).not.toContain("新建");
    expect(classifyContextFailure({ code: "context_length_exceeded" })).toBe("recovery_failed");
  });

  it.each(["recovery_failed", "input_too_large", "operation_pending"] as const)(
    "relocalizes serialized %s errors and exposes no technical prefix", (kind) => {
      const chinese = toPublicContextError({ code: "BYAI_CONTEXT_FAILURE", kind }, "zh_CN") as ByaiContextError;
      const english = toPublicContextError(JSON.parse(JSON.stringify(chinese)), "en_US") as ByaiContextError;
      expect(String(chinese)).toBe(chinese.message);
      expect(String(chinese)).toMatch(/\p{Script=Han}/u);
      expect(String(english)).toBe(english.message);
      expect(String(english)).not.toMatch(/\p{Script=Han}/u);
      expect(String(english)).not.toContain("ByaiContextError");
      expect(english.code).toBe("BYAI_CONTEXT_FAILURE");
      expect(english.kind).toBe(kind);
    },
  );

  it("preserves unrelated errors and localizes public errors without retaining raw causes", () => {
    const error = new Error("Redis connection failed");
    expect(toPublicContextError(error, "zh_CN")).toBe(error);
    const publicError = toPublicContextError(new Error("Compaction timed out"), "zh_CN");
    expect(publicContextErrorText(publicError, "en_US")).toContain("Start a new conversation");
  });

  it("retries required preflight timeout but not tool-loop errors or configuration failures", () => {
    expect(isRecoverableContextPreflightError(new Error("Preflight compaction required but failed: timeout"))).toBe(true);
    expect(isRecoverableContextPreflightError("Preflight compaction required but failed: Unauthorized 401 timeout")).toBe(false);
    expect(isRecoverableContextPreflightError("Context overflow: prompt too large for the model (mid-turn precheck).")).toBe(false);
    expect(isRecoverableContextPreflightError("Connection timed out")).toBe(false);
  });
});
