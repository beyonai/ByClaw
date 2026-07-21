import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { ChatInput, PiClient, StreamEvent } from "./pi/pi.types.js";

const chatBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 100_000 },
    systemPrompt: { type: "string", minLength: 1, maxLength: 20_000 },
  },
} as const;

function sse(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function buildApp(config: AppConfig, pi: PiClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: config.corsOrigin });

  app.get("/health", async () => ({ status: "ok", piReady: pi.isReady() }));

  app.post<{ Body: ChatInput }>(
    "/api/chat",
    { schema: { body: chatBodySchema } },
    async (request) => pi.chat(request.body),
  );

  app.post<{ Body: ChatInput }>(
    "/api/chat/stream",
    { schema: { body: chatBodySchema } },
    async (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      try {
        await pi.stream(request.body, (event) => reply.raw.write(sse(event)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Pi SDK error";
        reply.raw.write(sse({ type: "error", message }));
      } finally {
        reply.raw.end();
      }
    },
  );

  return app;
}
