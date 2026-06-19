import type { TelemetrySink } from "../reporter.js";
import { TELEMETRY_BUSY_PREFIX, type TelemetryBusyLogLine } from "../types.js";

export class ConsoleTelemetrySink implements TelemetrySink {
  readonly id = "console-log";

  publish(line: TelemetryBusyLogLine): void {
    console.log(`${TELEMETRY_BUSY_PREFIX} ${JSON.stringify(line)}`);
  }
}
