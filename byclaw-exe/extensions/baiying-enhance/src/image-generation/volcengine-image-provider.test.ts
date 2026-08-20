import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildVolcengineImageGenerationProvider } from "./volcengine-image-provider.js";

const TEST_TOKEN = "volcengine-provider-test-token";

type CapturedRequest = {
  method?: string;
  url?: string;
  authorization?: string;
  body?: Record<string, unknown>;
};

describe("Volcengine image provider", () => {
  let origin = "";
  let closeServer: (() => Promise<void>) | undefined;
  let captured: CapturedRequest;
  let responder: (req: IncomingMessage, res: ServerResponse) => void;

  beforeEach(async () => {
    captured = {};
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "doubao-seedream-test",
        data: [{ b64_json: Buffer.from("generated-image").toString("base64") }],
      }));
    };
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        captured = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined,
        };
        responder(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    origin = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  afterEach(async () => {
    await closeServer?.();
  });

  function request(overrides: Record<string, unknown> = {}) {
    return {
      provider: "volcengine",
      model: "doubao-seedream-test",
      prompt: "draw a blue whale",
      count: 3,
      resolution: "2K" as const,
      inputImages: [{ buffer: Buffer.from("reference"), mimeType: "image/png" }],
      cfg: {
        models: {
          providers: {
            volcengine: {
              apiKey: TEST_TOKEN,
              baseUrl: `${origin}/api/v3/images/generations`,
              request: { allowPrivateNetwork: true },
              watermark: false,
              seed: 42,
            },
          },
        },
      },
      ...overrides,
    };
  }

  function provider() {
    const guardedFetch = async (url: string, init: RequestInit, timeoutMs: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        return { response, release: async () => undefined };
      } finally {
        clearTimeout(timer);
      }
    };
    return buildVolcengineImageGenerationProvider({
      loadHttpRuntime: async () => ({
        postJson: ({ url, headers, body, timeoutMs }) => guardedFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }, timeoutMs),
        download: ({ url, timeoutMs }) => guardedFetch(url, { method: "GET" }, timeoutMs),
        assertOk: async (response, message) => {
          if (!response.ok) throw new Error(`${message}: ${await response.text()}`);
        },
        readJson: async (response) => response.json(),
        readBinary: async (response) => new Uint8Array(await response.arrayBuffer()),
      }),
    });
  }

  it("maps OpenClaw's shared request to the Ark ImageGenerations contract", async () => {
    const result = await provider().generateImage(request() as never);

    expect(captured).toMatchObject({
      method: "POST",
      url: "/api/v3/images/generations",
      authorization: `Bearer ${TEST_TOKEN}`,
      body: {
        model: "doubao-seedream-test",
        prompt: "draw a blue whale",
        size: "2K",
        response_format: "b64_json",
        stream: false,
        watermark: false,
        seed: 42,
        sequential_image_generation: "auto",
        sequential_image_generation_options: { max_images: 3 },
        image: [`data:image/png;base64,${Buffer.from("reference").toString("base64")}`],
      },
    });
    expect(captured.body).not.toHaveProperty("n");
    expect(result.images[0]?.buffer.toString()).toBe("generated-image");
    expect(result.model).toBe("doubao-seedream-test");
  });

  it("downloads a URL response through the guarded provider transport", async () => {
    responder = (req, res) => {
      if (req.url === "/asset.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.from("url-image"));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "doubao-seedream-4-0-test",
        created: 1_787_209_155,
        data: [{ url: `${origin}/asset.png`, size: "1024x1024" }],
        usage: {
          generated_images: 1,
          output_tokens: 4096,
          total_tokens: 4096,
        },
      }));
    };

    const result = await provider().generateImage(
      request({ count: 1, inputImages: undefined }) as never,
    );

    expect(result.images[0]?.buffer.toString()).toBe("url-image");
    expect(result.images[0]?.mimeType).toBe("image/png");
  });

  it("rejects upstream errors without including the API token", async () => {
    responder = (_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `bad credential ${TEST_TOKEN}` } }));
    };

    const error = await provider()
      .generateImage(request({ count: 1 }) as never)
      .catch((value) => value);

    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).toContain("Volcengine image generation failed");
    expect(String(error.message)).not.toContain(TEST_TOKEN);
  });

  it("honors the configured request timeout", async () => {
    responder = () => undefined;

    await expect(
      provider().generateImage(
        request({ count: 1, timeoutMs: 20 }) as never,
      ),
    ).rejects.toThrow();
  });
});
