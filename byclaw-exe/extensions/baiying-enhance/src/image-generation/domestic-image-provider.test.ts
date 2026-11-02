import { describe, expect, it, vi } from "vitest";
import type { ImageGenerationRequest } from "openclaw/plugin-sdk/image-generation";
import { buildDomesticImageProvider } from "./domestic-image-provider.js";

const TOKEN = "domestic-image-fixture-token";
const IMAGE = "https://images.example.test/result.png";

function setup(id: "bailian" | "tokenhub", payload: unknown) {
  const release = vi.fn(async () => undefined);
  const releaseAsset = vi.fn(async () => undefined);
  const runtime = {
    post: vi.fn(
      async (
        _url: string,
        _headers: Headers,
        _body: Record<string, unknown>,
        _req: ImageGenerationRequest,
      ) => ({
        response: new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        }),
        release,
      }),
    ),
    download: vi.fn(async (_url: string, _req: ImageGenerationRequest) => ({
      response: new Response("image-bytes", { headers: { "content-type": "image/png" } }),
      release: releaseAsset,
    })),
    json: async (response: Response) => response.json(),
    binary: async (response: Response) => new Uint8Array(await response.arrayBuffer()),
  };
  const provider = buildDomesticImageProvider(id, { loadHttpRuntime: async () => runtime });
  const request = {
    provider: id,
    model: id === "bailian" ? "qwen-image-3.0-pro" : "hy-image-v3.5-preview",
    prompt: "a whale",
    count: 1,
    size: "2048x2048",
    timeoutMs: 1000,
    ssrfPolicy: { allowedHostnames: ["images.example.test"] },
    cfg: { models: { providers: { [id]: { apiKey: TOKEN } } } },
  } as ImageGenerationRequest;
  return { provider, request, runtime, release, releaseAsset };
}

describe("domestic native image protocols", () => {
  it.each(["qwen-image-3.0-pro", "qwen-image-3.0", "wan2.7-image-pro", "wan2.7-image"])(
    "sends DashScope messages and downloads image output for %s",
    async (model) => {
      const { provider, request, runtime, release, releaseAsset } = setup("bailian", {
        output: { choices: [{ message: { content: [{ image: IMAGE }] } }] },
      });
      request.model = model;
      request.count = 2;
      request.inputImages = [{ buffer: Buffer.from("ref"), mimeType: "image/jpeg" }];
      const result = await provider.generateImage(request);
      expect(runtime.post.mock.calls[0]?.[0]).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      );
      expect(runtime.post.mock.calls[0]?.[1].get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(runtime.post.mock.calls[0]?.[2]).toEqual({
        model,
        input: {
          messages: [
            {
              role: "user",
              content: [
                {
                  image: `data:image/jpeg;base64,${Buffer.from("ref").toString("base64")}`,
                },
                { text: "a whale" },
              ],
            },
          ],
        },
        parameters: { n: 2, size: "2048*2048" },
      });
      expect(runtime.download).toHaveBeenCalledWith(IMAGE, request);
      expect(result.images[0]?.buffer.toString()).toBe("image-bytes");
      expect(result.images[0]?.mimeType).toBe("image/png");
      expect(release).toHaveBeenCalledOnce();
      expect(releaseAsset).toHaveBeenCalledOnce();
    },
  );

  it.each(["hy-image-v3", "hy-image-v3.5-preview"])(
    "selects the correct Hunyuan endpoint and body for %s on a custom gateway",
    async (model) => {
      const { provider, request, runtime } = setup("tokenhub", { data: [{ url: IMAGE }] });
      request.model = model;
      request.cfg = {
        models: {
          providers: {
            tokenhub: {
              apiKey: TOKEN,
              baseUrl: "https://gateway.example.test/v1/wand/hunyuan-image/v35-generation",
            },
          },
        },
      } as ImageGenerationRequest["cfg"];
      await provider.generateImage(request);
      const v35 = model === "hy-image-v3.5-preview";
      expect(runtime.post.mock.calls[0]?.[0]).toBe(
        `https://gateway.example.test/v1/wand/hunyuan-image/${v35 ? "v35" : "v3"}-generation`,
      );
      expect(runtime.post.mock.calls[0]?.[2]).toEqual(
        v35
          ? {
              model,
              size: "2048x2048",
              messages: [{ role: "user", content: [{ type: "text", text: "a whale" }] }],
            }
          : { model, size: "2048x2048", prompt: "a whale" },
      );
    },
  );

  it("sends reference images in Hunyuan 3.5 message content", async () => {
    const { provider, request, runtime } = setup("tokenhub", { data: [{ url: IMAGE }] });
    request.inputImages = [{ buffer: Buffer.from("ref"), mimeType: "image/png" }];
    await provider.generateImage(request);
    expect(runtime.post.mock.calls[0]?.[2]).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,cmVm" } },
            { type: "text", text: "a whale" },
          ],
        },
      ],
    });
  });

  it("rejects unsupported counts and missing credentials before sending requests", async () => {
    const { provider, request, runtime } = setup("tokenhub", {});
    await expect(provider.generateImage({ ...request, count: 2 })).rejects.toThrow(
      "Unsupported image count",
    );
    await expect(provider.generateImage({ ...request, cfg: {} })).rejects.toThrow(
      "API key missing",
    );
    expect(runtime.post).not.toHaveBeenCalled();
  });

  it("releases the response on upstream errors and does not request assets", async () => {
    const { provider, request, runtime, release } = setup("bailian", {
      code: "InvalidApiKey",
      message: TOKEN,
    });
    await expect(provider.generateImage(request)).rejects.toThrow(
      "Image provider returned an error",
    );
    expect(release).toHaveBeenCalledOnce();
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it("redacts credentials from transport errors", async () => {
    const { provider, request, runtime } = setup("tokenhub", {});
    runtime.post.mockRejectedValueOnce(new Error(`failed with ${TOKEN}`));
    await expect(provider.generateImage(request)).rejects.toThrow("failed with [redacted]");
  });

  it("releases unsuccessful image downloads", async () => {
    const { provider, request, runtime, releaseAsset } = setup("tokenhub", {
      data: [{ url: IMAGE }],
    });
    runtime.download.mockResolvedValueOnce({
      response: new Response(null, { status: 403 }),
      release: releaseAsset,
    });
    await expect(provider.generateImage(request)).rejects.toThrow("Image download failed (403)");
    expect(releaseAsset).toHaveBeenCalledOnce();
  });
});
