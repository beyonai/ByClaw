import { THINKING_LEVELS } from "@byclaw/by-conductor";

/** HTTP 输入校验集中在此文件，路由只保留业务流程。 */
export const messageBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 100_000 },
    thinkingLevel: { type: "string", enum: THINKING_LEVELS },
  },
} as const;

export const createSessionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    ...messageBodySchema.properties,
    context: {
      type: "object",
      additionalProperties: false,
      properties: {
        locale: { type: "string", minLength: 1, maxLength: 32 },
        timezone: { type: "string", minLength: 1, maxLength: 100 },
      },
    },
  },
} as const;

export const runIdParamSchema = {
  type: "object",
  required: ["runId"],
  properties: { runId: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

export const sessionIdParamSchema = {
  type: "object",
  required: ["sessionId"],
  properties: { sessionId: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

export const interactionParamSchema = {
  type: "object",
  required: ["runId", "interactionId"],
  properties: {
    runId: { type: "string", minLength: 1, maxLength: 200 },
    interactionId: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

export const interactionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["submit", "skip", "cancel"] },
    answers: { type: "object", additionalProperties: true },
    text: { type: "string", maxLength: 100_000 },
  },
} as const;

export const sessionMessagesQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    before: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

const capabilitySourceItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    code: { type: "string", maxLength: 100 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 1_000 },
  },
} as const;

const capabilityAgentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    code: { type: "string", maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 10_000 },
    instructions: { type: "string", maxLength: 50_000 },
    skills: {
      type: "array",
      maxItems: 50,
      items: capabilitySourceItemSchema,
    },
    tools: {
      type: "array",
      maxItems: 50,
      items: capabilitySourceItemSchema,
    },
    knowledgeDomains: stringArraySchema(50, 200),
    inputTypes: stringArraySchema(30, 200),
    outputTypes: stringArraySchema(30, 200),
    constraints: stringArraySchema(30, 500),
    examples: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["request", "expectedOutcome"],
        properties: {
          request: { type: "string", minLength: 1, maxLength: 2_000 },
          expectedOutcome: {
            type: "string",
            minLength: 1,
            maxLength: 2_000,
          },
        },
      },
    },
  },
} as const;

export const agentCapabilityCompileBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["agent"],
  properties: {
    locale: { type: "string", minLength: 2, maxLength: 32 },
    agent: capabilityAgentSchema,
  },
} as const;

export const agentCapabilityUpsertBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["agent"],
  properties: {
    locale: { type: "string", minLength: 2, maxLength: 32 },
    sourceVersion: { type: "string", minLength: 1, maxLength: 128 },
    agent: capabilityAgentSchema,
  },
} as const;

export const agentCapabilityParamSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agentId"],
  properties: {
    agentId: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

function stringArraySchema(maxItems: number, maxLength: number) {
  return {
    type: "array",
    maxItems,
    items: { type: "string", minLength: 1, maxLength },
  } as const;
}
