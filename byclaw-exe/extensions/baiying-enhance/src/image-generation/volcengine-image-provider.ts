import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "openclaw/plugin-sdk/image-generation";

const VOLCENGINE_PROVIDER_ID = "volcengine";
const DEFAULT_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_MODEL = "doubao-seedream-5-0-260128";
const DEFAULT_TIMEOUT_MS = 180_000;

type GuardedResponse = { response: Response; release: () => Promise<void> };

type VolcengineHttpRuntime = {
  postJson: (params: {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
    timeoutMs: number;
    allowPrivateNetwork: boolean;
    ssrfPolicy?: ImageGenerationRequest["ssrfPolicy"];
  }) => Promise<GuardedResponse>;
  download: (params: {
    url: string;
    timeoutMs: number;
    allowPrivateNetwork: boolean;
    ssrfPolicy?: ImageGenerationRequest["ssrfPolicy"];
  }) => Promise<GuardedResponse>;
  assertOk: (response: Response, message: string) => Promise<void>;
  readJson: (response: Response) => Promise<unknown>;
  readBinary: (response: Response) => Promise<Uint8Array>;
};

type VolcengineProviderDeps = {
  loadHttpRuntime?: () => Promise<VolcengineHttpRuntime>;
};

async function loadOpenClawHttpRuntime(): Promise<VolcengineHttpRuntime> {
  const runtime = await import("openclaw/plugin-sdk/provider-http");
  return {
    postJson: async (params) => runtime.postJsonRequest({
      url: params.url,
      headers: params.headers,
      body: params.body,
      timeoutMs: params.timeoutMs,
      fetchFn: fetch,
      allowPrivateNetwork: params.allowPrivateNetwork,
      ssrfPolicy: params.ssrfPolicy,
    }),
    download: async (params) => runtime.fetchWithTimeoutGuarded(
      params.url,
      { method: "GET" },
      params.timeoutMs,
      fetch,
      { ssrfPolicy: params.ssrfPolicy, auditContext: "volcengine-image-download" },
    ),
    assertOk: async (response, message) => runtime.assertOkOrThrowHttpError(response, message),
    readJson: async (response) => runtime.readProviderJsonResponse(response, "volcengine.image-generation"),
    readBinary: async (response) => runtime.readProviderBinaryResponse(response, "volcengine.image-download", "image"),
  };
}

function toDataUrl(buffer: Buffer, mimeType?: string): string {
  return `data:${text(mimeType) || "image/png"};base64,${buffer.toString("base64")}`;
}

function imageFromBase64(base64: string, index: number, mimeType = "image/png"): GeneratedImageAsset | undefined {
  if (!base64.trim()) return undefined;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) return undefined;
  return { buffer, mimeType, fileName: `image-${index + 1}.${mimeType === "image/jpeg" ? "jpg" : "png"}` };
}

function imageFromDataUrl(dataUrl: string, index: number): GeneratedImageAsset | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/su.exec(dataUrl);
  return match ? imageFromBase64(match[2], index, match[1]) : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function providerConfig(req: ImageGenerationRequest): Record<string, unknown> {
  return record(req.cfg?.models?.providers?.[VOLCENGINE_PROVIDER_ID]);
}

function resolveEndpoint(raw: unknown): string {
  const parsed = new URL(text(raw) || DEFAULT_ENDPOINT);
  if (!/\/images\/generations\/?$/u.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/images/generations`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function numberOption(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildRequestBody(req: ImageGenerationRequest, config: Record<string, unknown>) {
  const callOptions = record(req.providerOptions?.volcengine);
  const options = { ...config, ...callOptions };
  const count = Math.max(1, Math.min(15, Math.floor(req.count ?? 1)));
  const body: Record<string, unknown> = {
    model: req.model || DEFAULT_MODEL,
    prompt: req.prompt,
    response_format: "b64_json",
    stream: false,
    sequential_image_generation: count > 1 ? "auto" : "disabled",
  };
  if (count > 1) body.sequential_image_generation_options = { max_images: count };
  const size = text(req.size) || text(req.resolution);
  if (size) body.size = size;
  const seed = numberOption(options.seed);
  if (seed !== undefined) body.seed = Math.floor(seed);
  if (typeof options.watermark === "boolean") body.watermark = options.watermark;
  const guidanceScale = numberOption(options.guidanceScale ?? options.guidance_scale);
  if (guidanceScale !== undefined) body.guidance_scale = guidanceScale;
  const optimizePromptOptions = record(options.optimizePromptOptions ?? options.optimize_prompt_options);
  if (Object.keys(optimizePromptOptions).length > 0) body.optimize_prompt_options = optimizePromptOptions;
  if (req.outputFormat === "png" || req.outputFormat === "jpeg") body.output_format = req.outputFormat;
  if ((req.inputImages?.length ?? 0) > 0) {
    body.image = req.inputImages?.map((image) =>
      toDataUrl(image.buffer, image.mimeType),
    );
  }
  return body;
}

async function downloadImage(params: {
  url: string;
  req: ImageGenerationRequest;
  timeoutMs: number;
  allowPrivateNetwork: boolean;
  runtime: VolcengineHttpRuntime;
}): Promise<GeneratedImageAsset> {
  const { response, release } = await params.runtime.download({
    url: params.url,
    timeoutMs: params.timeoutMs,
    allowPrivateNetwork: params.allowPrivateNetwork,
    ssrfPolicy: params.req.ssrfPolicy,
  });
  try {
    await params.runtime.assertOk(response, "Volcengine image download failed");
    const bytes = await params.runtime.readBinary(response);
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "image/png";
    return { buffer: Buffer.from(bytes), mimeType };
  } finally {
    await release();
  }
}

async function parseImages(params: {
  payload: unknown;
  req: ImageGenerationRequest;
  timeoutMs: number;
  allowPrivateNetwork: boolean;
  runtime: VolcengineHttpRuntime;
}): Promise<GeneratedImageAsset[]> {
  const data = record(params.payload).data;
  if (!Array.isArray(data)) throw new Error("Volcengine image response malformed");
  const images: GeneratedImageAsset[] = [];
  for (const [index, item] of data.entries()) {
    const entry = record(item);
    const base64 = text(entry.b64_json);
    if (base64) {
      const image = imageFromBase64(base64, index);
      if (image) images.push(image);
      continue;
    }
    const url = text(entry.url);
    if (!url) throw new Error("Volcengine image response malformed");
    if (url.startsWith("data:")) {
      const image = imageFromDataUrl(url, index);
      if (image) images.push(image);
      continue;
    }
    images.push(await downloadImage({ ...params, url }));
  }
  if (images.length === 0) throw new Error("Volcengine image response missing image data");
  return images;
}

function sanitizedError(error: unknown, apiKey: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
  return new Error(
    redacted.startsWith("Volcengine image generation failed")
      ? redacted
      : `Volcengine image generation failed: ${redacted}`,
    error instanceof Error ? { cause: error } : undefined,
  );
}

export function buildVolcengineImageGenerationProvider(
  deps: VolcengineProviderDeps = {},
): ImageGenerationProvider {
  return {
    id: VOLCENGINE_PROVIDER_ID,
    label: "Volcengine Ark",
    defaultModel: DEFAULT_MODEL,
    models: [DEFAULT_MODEL],
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    isConfigured: ({ cfg }) => Boolean(text(cfg?.models?.providers?.[VOLCENGINE_PROVIDER_ID]?.apiKey)),
    capabilities: {
      generate: { maxCount: 15, supportsSize: true, supportsAspectRatio: false, supportsResolution: true },
      edit: { enabled: true, maxCount: 15, maxInputImages: 10, supportsSize: true, supportsAspectRatio: false, supportsResolution: true },
      geometry: { resolutions: ["1K", "2K", "4K"] },
      output: { formats: ["png", "jpeg"] },
    },
    async generateImage(req) {
      const config = providerConfig(req);
      const apiKey = text(config.apiKey);
      if (!apiKey) throw new Error("Volcengine API key missing");
      const endpoint = resolveEndpoint(config.baseUrl);
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const requestConfig = record(config.request);
      const allowPrivateNetwork = requestConfig.allowPrivateNetwork === true;
      const runtime = await (deps.loadHttpRuntime ?? loadOpenClawHttpRuntime)();
      const headers = new Headers({
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      });
      try {
        const { response, release } = await runtime.postJson({
          url: endpoint,
          headers,
          body: buildRequestBody(req, config),
          timeoutMs,
          allowPrivateNetwork,
          ssrfPolicy: req.ssrfPolicy,
        });
        try {
          await runtime.assertOk(response, "Volcengine image generation failed");
          const payload = await runtime.readJson(response);
          return {
            images: await parseImages({ payload, req, timeoutMs, allowPrivateNetwork, runtime }),
            model: req.model || DEFAULT_MODEL,
            metadata: { provider: VOLCENGINE_PROVIDER_ID },
          };
        } finally {
          await release();
        }
      } catch (error) {
        throw sanitizedError(error, apiKey);
      }
    },
  };
}
