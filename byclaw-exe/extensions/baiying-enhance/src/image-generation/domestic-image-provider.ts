import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "openclaw/plugin-sdk/image-generation";

type ProviderId = "bailian" | "tokenhub";
type GuardedResponse = { response: Response; release: () => Promise<void> };
type HttpRuntime = {
  post: (
    url: string,
    headers: Headers,
    body: Record<string, unknown>,
    req: ImageGenerationRequest,
  ) => Promise<GuardedResponse>;
  download: (url: string, req: ImageGenerationRequest) => Promise<GuardedResponse>;
  json: (response: Response) => Promise<unknown>;
  binary: (response: Response) => Promise<Uint8Array>;
};

const DEFINITIONS = {
  bailian: {
    label: "Alibaba Cloud Model Studio",
    model: "qwen-image-3.0-pro",
    endpoint:
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    models: ["qwen-image-3.0-pro", "qwen-image-3.0", "wan2.7-image-pro", "wan2.7-image"],
  },
  tokenhub: {
    label: "Tencent TokenHub",
    model: "hy-image-v3.5-preview",
    endpoint: "https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation",
    models: ["hy-image-v3", "hy-image-v3.5-preview"],
  },
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

async function loadHttpRuntime(): Promise<HttpRuntime> {
  const http = await import("openclaw/plugin-sdk/provider-http");
  return {
    post: (url, headers, body, req) =>
      http.postJsonRequest({
        url,
        headers,
        body,
        fetchFn: fetch,
        timeoutMs: req.timeoutMs ?? 180_000,
        ssrfPolicy: req.ssrfPolicy,
        allowPrivateNetwork: false,
      }),
    download: (url, req) =>
      http.fetchWithTimeoutGuarded(url, { method: "GET" }, req.timeoutMs ?? 180_000, fetch, {
        ssrfPolicy: req.ssrfPolicy,
        auditContext: "domestic-image-download",
      }),
    json: (response) => http.readProviderJsonResponse(response, "domestic.image-generation"),
    binary: (response) =>
      http.readProviderBinaryResponse(response, "domestic.image-download", "image"),
  };
}

/** 原厂同步接口各有独立结构；不将 DashScope/混元伪装成 OpenAI Images。 */
function buildRequest(id: ProviderId, req: ImageGenerationRequest, model: string) {
  const images = (req.inputImages ?? []).map(
    (image) => `data:${image.mimeType || "image/png"};base64,${image.buffer.toString("base64")}`,
  );
  const count = req.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > (id === "bailian" ? 4 : 1)) {
    throw new Error("Unsupported image count for this provider");
  }
  if (images.length > 3) throw new Error("This image route supports up to three reference images");
  if (id === "bailian") {
    const parameters: Record<string, unknown> = { n: count };
    if (req.size) parameters.size = req.size.replace("x", "*");
    return {
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [...images.map((image) => ({ image })), { text: req.prompt }],
          },
        ],
      },
      parameters,
    };
  }
  const size = req.size ? { size: req.size.replace("*", "x") } : {};
  return model === "hy-image-v3.5-preview"
    ? {
        model,
        ...size,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
              { type: "text", text: req.prompt },
            ],
          },
        ],
      }
    : { model, prompt: req.prompt, ...size, ...(images.length ? { images } : {}) };
}

function imageUrls(id: ProviderId, payload: unknown): string[] {
  const body = record(payload);
  if (body.error || body.code) throw new Error("Image provider returned an error");
  if (id === "tokenhub") {
    return Array.isArray(body.data)
      ? body.data.map((item) => text(record(item).url)).filter(Boolean)
      : [];
  }
  const choices = record(body.output).choices;
  return Array.isArray(choices)
    ? choices.flatMap((choice) => {
        const content = record(record(choice).message).content;
        return Array.isArray(content)
          ? content.map((item) => text(record(item).image)).filter(Boolean)
          : [];
      })
    : [];
}

export function buildDomesticImageProvider(
  id: ProviderId,
  deps: { loadHttpRuntime?: () => Promise<HttpRuntime> } = {},
): ImageGenerationProvider {
  const definition = DEFINITIONS[id];
  return {
    id,
    label: definition.label,
    models: definition.models,
    defaultModel: definition.model,
    defaultTimeoutMs: 180_000,
    isConfigured: ({ cfg }) => Boolean(text(cfg?.models?.providers?.[id]?.apiKey)),
    capabilities: {
      generate: {
        maxCount: id === "bailian" ? 4 : 1,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      edit: {
        enabled: true,
        maxCount: id === "bailian" ? 4 : 1,
        maxInputImages: 3,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
    },
    async generateImage(req) {
      const config = record(req.cfg?.models?.providers?.[id]);
      const apiKey = text(config.apiKey);
      if (!apiKey) throw new Error(`${definition.label} API key missing`);
      const model = req.model || definition.model;
      // 已登记模板使用完整服务地址；保留自定义网关的域名，混元版本切换只切已知路径尾部。
      let endpoint = text(config.baseUrl) || definition.endpoint;
      if (id === "tokenhub") {
        endpoint = endpoint.replace(
          /\/v(?:3|35)-generation\/?$/u,
          model === "hy-image-v3.5-preview" ? "/v35-generation" : "/v3-generation",
        );
      }
      const runtime = await (deps.loadHttpRuntime ?? loadHttpRuntime)();
      try {
        const { response, release } = await runtime.post(
          endpoint,
          new Headers({
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          }),
          buildRequest(id, req, model),
          req,
        );
        let urls: string[];
        try {
          if (!response.ok) throw new Error(`Image request failed (${response.status})`);
          urls = imageUrls(id, await runtime.json(response));
          if (!urls.length) throw new Error("Image provider response missing image data");
        } finally {
          await release();
        }
        const images: GeneratedImageAsset[] = [];
        for (const url of urls) {
          // 下载使用同一 SSRF 防护，但绝不转发上游 API Key 到图片存储地址。
          const asset = await runtime.download(url, req);
          try {
            if (!asset.response.ok)
              throw new Error(`Image download failed (${asset.response.status})`);
            images.push({
              buffer: Buffer.from(await runtime.binary(asset.response)),
              mimeType: asset.response.headers.get("content-type")?.split(";", 1)[0] || "image/png",
            });
          } finally {
            await asset.release();
          }
        }
        return { images, model, metadata: { provider: id } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.replaceAll(apiKey, "[redacted]"));
      }
    },
  };
}
