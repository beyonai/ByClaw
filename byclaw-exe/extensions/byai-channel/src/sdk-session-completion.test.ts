import { describe, expect, it } from "vitest";
import { resolveActiveSdkCompletionDebounceMs } from "./sdk-session-completion.js";

describe("resolveActiveSdkCompletionDebounceMs", () => {
  it("gives model fallback lifecycle events time to arrive after a root error", () => {
    expect(resolveActiveSdkCompletionDebounceMs("root_lifecycle_error")).toBe(1500);
  });

  it("keeps normal completion checks responsive", () => {
    expect(resolveActiveSdkCompletionDebounceMs("root_lifecycle_end")).toBe(200);
    expect(resolveActiveSdkCompletionDebounceMs("message_sent:ok")).toBe(200);
    expect(resolveActiveSdkCompletionDebounceMs("model_fallback_succeeded")).toBe(200);
  });
});
