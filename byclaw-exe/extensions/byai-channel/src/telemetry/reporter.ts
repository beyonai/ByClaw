import type { TelemetryRuntimeState } from "./state.js";
import {
  TELEMETRY_BUSY_MARKER,
  TELEMETRY_BUSY_VERSION,
  type TelemetryBusyLogEvent,
  type TelemetryBusyLogLine,
} from "./types.js";

export type TelemetrySink = {
  readonly id: string;
  publish(line: TelemetryBusyLogLine): void;
  close?(): Promise<void>;
};

export class TelemetryReporter {
  constructor(
    private readonly state: TelemetryRuntimeState,
    private readonly sinks: readonly TelemetrySink[],
  ) {}

  emit(event: TelemetryBusyLogEvent): TelemetryBusyLogLine {
    const snapshot = this.state.snapshot();
    const line: TelemetryBusyLogLine = {
      marker: TELEMETRY_BUSY_MARKER,
      version: TELEMETRY_BUSY_VERSION,
      event,
      ...snapshot,
    };
    this.publish(line);
    return line;
  }

  async close(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.close?.()));
  }

  private publish(line: TelemetryBusyLogLine): void {
    for (const sink of this.sinks) {
      sink.publish(line);
    }
  }
}
