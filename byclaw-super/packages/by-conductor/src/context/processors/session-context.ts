import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  SystemContextSection,
} from "../types.js";

const SECTION_ID = "session-context";

/** 注入可信的 Session locale/timezone，并按显式时间计算用户当地日期。 */
export class SessionContextProcessor implements ContextProcessor {
  readonly name = "session-context";

  process(
    state: ContextBuildState,
    input: ContextBuildInput,
  ): ContextBuildState {
    const section = renderSessionContext(input);
    return {
      ...state,
      dynamicSystemSections: [
        ...state.dynamicSystemSections.filter(({ id }) => id !== SECTION_ID),
        ...(section ? [section] : []),
      ],
    };
  }
}

function renderSessionContext(
  input: ContextBuildInput,
): SystemContextSection | undefined {
  const { locale, timezone } = input.sessionContext;
  if (!locale && !timezone) {
    return undefined;
  }
  const lines = [
    "<session_context>",
    "This is trusted session metadata.",
    ...(locale ? [`User interface locale: ${locale}`] : []),
    ...(timezone
      ? [
          `User timezone: ${timezone}`,
          `Current local date: ${localDate(input.currentTime, timezone)}`,
        ]
      : []),
    ...(locale
      ? [
          `Reply in the language used by the user. When the user's language is ambiguous, prefer ${locale}.`,
        ]
      : []),
    "</session_context>",
  ];
  return { id: SECTION_ID, content: lines.join("\n") };
}

function localDate(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp)) {
    throw new Error("Context currentTime must be a finite timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new Error("Unable to format Session local date");
  }
  return `${year}-${month}-${day}`;
}
