import { z } from "zod";

/** Bolt (SDK) 模式配置 */
export const ByaiSdkConfigSchema = z.object({
  /** 是否启用 SDK 模式（默认开启） */
  enabled: z.boolean().optional().default(true),
});

export const ByaiTelemetryConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  consoleEnabled: z.boolean().optional().default(false),
  redisEnabled: z.boolean().optional().default(true),
  logIntervalMs: z.number().optional().default(30_000),
  activeRunMaxAgeMs: z.number().optional().default(30 * 60 * 1000),
  activeToolCallMaxAgeMs: z.number().optional().default(30 * 60 * 1000),
  activeSubagentMaxAgeMs: z.number().optional().default(2 * 60 * 60 * 1000),
  activeLeaseMs: z.number().optional().default(5 * 60 * 1000),
  cautiousLeaseMs: z.number().optional().default(2 * 60 * 1000),
  idleGraceMs: z.number().optional().default(60 * 1000),
  maxAgeMs: z.number().optional().default(30 * 60 * 1000),
});

export const ByaiChannelConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  webhookPath: z.string().optional().default("/webhook/byai-channel"),
  streamEnabled: z.boolean().optional().default(true),
  streamMode: z.enum(["delta", "final"]).optional().default("delta"),
  forceReasoningStream: z.boolean().optional().default(true),
  sessionKeyPerSessionId: z.boolean().optional().default(false),
  dmPolicy: z.enum(["open", "allowlist", "pairing"]).optional().default("open"),
  allowFrom: z.array(z.string()).optional().default([]),
  defaultTo: z.string().optional(),
  /** SDK 模式配置 */
  sdk: ByaiSdkConfigSchema.optional(),
  telemetry: ByaiTelemetryConfigSchema.optional(),
});
