import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createDiagnosticsOtelService } from "./src/service.js";

/** BYAI Langfuse exporter; keeps the official diagnostics id so OpenClaw grants internal diagnostics. */
export default definePluginEntry({
  id: "diagnostics-otel",
  name: "BYAI Diagnostics OpenTelemetry",
  description:
    "Export OpenClaw diagnostics to OpenTelemetry (BYAI Langfuse session/user mapping and byai-channel inbound traces)",
  register(api) {
    // Loud beacon: written via console.warn so it survives whatever the plugin
    // logger is doing. Remove once diagnosis is done.
    console.warn("[byai-diagnostics-otel] register() called (fork build)");
    api.registerService(
      createDiagnosticsOtelService({
        id: "diagnostics-otel",
        exporterName: "diagnostics-otel",
        includeDiagnosticSessionAttributes: true,
        includeLangfuseSessionAttributes: true,
        includeLangfuseUserAttributes: true,
        assignToolContentIoAttributes: true,
        // Build message.inbound SERVER spans for both byai-channel and stock
        // openclaw channels (webchat / websocket). See README for how to add
        // more native channel ids.
        inboundChannels: {
          channels: ["byai-channel", "webchat"],
          sources: ["byai-channel-sdk"],
        },
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
