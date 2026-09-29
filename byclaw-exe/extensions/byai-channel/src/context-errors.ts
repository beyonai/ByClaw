import { formatDispatchError, isOpenClawContextOverflowDispatchError, isRequiredCompactionFailure } from "./dispatch-error.js";
import { buildContextFailureText } from "./i18n.js";

export type ContextFailureKind = "recovery_failed" | "input_too_large" | "operation_pending";

/** Contains only public diagnostics. Raw errors belong in the server log, not cause/metadata. */
export class ByaiContextError extends Error {
  readonly code = "BYAI_CONTEXT_FAILURE";
  constructor(readonly kind: ContextFailureKind, message: string) {
    super(message);
    this.name = "ByaiContextError";
  }

  // SDK/framework serializers may call String(error). Only expose the localized
  // message; name/code remain available for internal diagnostics and classification.
  override toString(): string {
    return this.message;
  }
}

/** Call at error boundaries, not on arbitrary assistant/user text. */
export function classifyContextFailure(error: unknown): ContextFailureKind | undefined {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  if (record?.code === "BYAI_CONTEXT_FAILURE" &&
      ["recovery_failed", "input_too_large", "operation_pending"].includes(String(record.kind))) {
    return record.kind as ContextFailureKind;
  }
  // A generic context_length_exceeded includes history and is NOT proof that this input is too large.
  if (["input_too_large", "request_too_large", "payload_too_large", "attachment_too_large"].includes(String(record?.code))) {
    return "input_too_large";
  }
  const text = formatDispatchError(error);
  if (/^(?:Error:\s*)?(?:Current (?:user )?(?:message|input|prompt)|Request payload|Attachment) (?:is too large|exceeds (?:the )?(?:maximum|model|input|context))/i.test(text)) {
    return "input_too_large";
  }
  if (isOpenClawContextOverflowDispatchError(error) || isRequiredCompactionFailure(error) ||
      /^(?:Error:\s*)?(?:Compaction (?:timed out|failed)|context_length_exceeded\b)/i.test(text) ||
      record?.code === "context_length_exceeded") return "recovery_failed";
  return undefined;
}

export function toPublicContextError(error: unknown, language?: string): unknown {
  const kind = classifyContextFailure(error);
  return kind ? new ByaiContextError(kind, buildContextFailureText(language, kind)) : error;
}

export function publicContextErrorText(error: unknown, language?: string): string {
  return formatDispatchError(toPublicContextError(error, language));
}
