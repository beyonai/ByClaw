import { z } from "zod";

/** Bolt (SDK) 模式配置 */
export const ByaiSdkConfigSchema = z.object({
  /** 是否启用 SDK 模式（默认开启） */
  enabled: z.boolean().optional().default(true),
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
});
