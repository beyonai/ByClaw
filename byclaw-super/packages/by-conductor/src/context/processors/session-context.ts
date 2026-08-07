import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  SystemContextSection,
} from "../types.js";

const SECTION_ID = "session-context";

/** 注入可信的 Session locale/timezone，并按显式时间计算用户当地日期时间。 */
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
    ...(locale ? [`User response language: ${responseLanguage(locale)}`] : []),
    ...(timezone
      ? [
          `User timezone: ${timezone}`,
          `Current local date and time: ${localDateTime(input.currentTime, timezone)}`,
        ]
      : []),
    ...(locale
      ? [
          `Respond in ${responseLanguage(locale)} by default. Use another language only when the user explicitly requests it.`,
        ]
      : []),
    "</session_context>",
  ];
  return { id: SECTION_ID, content: lines.join("\n") };
}

function localDateTime(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp)) {
    throw new Error("Context currentTime must be a finite timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error("Unable to format Session local date and time");
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function responseLanguage(locale: string): string {
  const language = new Intl.Locale(locale).language.toLowerCase();
  if (language === "zh") {
    return "Chinese";
  }
  if (language === "en") {
    return "English";
  }
  return locale;
}
