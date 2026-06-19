export type ZonedScheduleParts = {
  key: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
};

const weekdayByName = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
]);

export function getZonedScheduleParts(date: Date, timezone: string): ZonedScheduleParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = weekdayByName.get(parts.weekday ?? "") ?? date.getUTCDay();
  const year = parts.year ?? "0000";
  const month = parts.month ?? "00";
  const day = parts.day ?? "00";
  const hour = Number(parts.hour ?? 0);
  const minute = Number(parts.minute ?? 0);
  return {
    key: `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    dayOfWeek: weekday,
    hour,
    minute,
  };
}

export function shouldRunWeeklySchedule(params: {
  now: Date;
  timezone: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
  lastRunKey?: string;
}): { run: boolean; key: string } {
  const parts = getZonedScheduleParts(params.now, params.timezone);
  const run =
    parts.dayOfWeek === params.dayOfWeek &&
    parts.hour === params.hour &&
    parts.minute === params.minute &&
    parts.key !== params.lastRunKey;
  return { run, key: parts.key };
}
