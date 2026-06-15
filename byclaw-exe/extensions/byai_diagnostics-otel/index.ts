import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createDiagnosticsOtelService } from "./src/service.js";

/** BYAI Langfuse exporter; registers as bundled `diagnostics-otel` for internalDiagnostics. */
export default definePluginEntry({
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description:
    "Export OpenClaw diagnostics to OpenTelemetry (BYAI Langfuse session/user mapping and byai-channel inbound traces)",
  register(api) {
    api.registerService(
      createDiagnosticsOtelService({
        id: "diagnostics-otel",
        exporterName: "diagnostics-otel",
        includeDiagnosticSessionAttributes: true,
        includeLangfuseSessionAttributes: true,
        includeLangfuseUserAttributes: true,
        assignToolContentIoAttributes: true,
        forceContentCapture: {
          inputMessages: true,
          outputMessages: true,
          toolInputs: true,
          toolOutputs: true,
          systemPrompt: true,
          toolDefinitions: true,
        },
      }),
    );
  },
});
