# ByClaw image plugin

`@byclaw/byclaw-image` provides `image_generate` through the Harness session setup boundary. The integration supplies an enabled, authorized image model and the authoritative session root. Output files belong in `<session_root>/image/`; prompts cannot supply endpoints, credentials, headers, workflows, or filesystem paths.

The transport entrypoint is `@byclaw/byclaw-image/adapters`:

```js
import { generateImage, imageProviders } from '@byclaw/byclaw-image/adapters'

const assets = await generateImage(trustedModel, {
  prompt: 'A red kite over a field',
  size: '2K',
}, { signal })
```

`trustedModel` contains `provider`, `protocol`, `model`, `endpoint`, `apiKey`, optional trusted `headers` / `options`, and optional `timeoutMs`. The returned assets contain `bytes` and detected `mimeType`. Session/tool registration and persistence use the shared `@byclaw/media-runtime` package. Protocol/provider conflicts fail before a request; an omitted protocol selects the provider's explicit native route.

## Supported contracts

All 12 image suppliers in the model-management frontend have request/response contract tests. This means protocol implementation and offline fixtures, **not live validation of every provider or every model family**. Model-specific availability, supported resolutions, and account entitlement still apply.

| Provider / protocol | Request and result | Supported common options |
| --- | --- | --- |
| `COMFYUI` / `COMFY_IMAGE` | `/prompt`, `/history/{prompt_id}`, `/view` | One workflow execution; configured workflow controls dimensions |
| `DEEPINFRA` / `DEEPINFRA_IMAGE` | OpenAI-compatible `/images/generations` under `/v1/openai`; `data[].b64_json` | Pixel `size`, `count` |
| `FAL` / `FAL_IMAGE` | Synchronous `fal.run/{model}` with `Key` authentication; `images[].url` | FLUX-style `image_size`, `num_images`; pixel size or supported aspect ratio |
| `GOOGLE` / `GOOGLE_IMAGE` | Gemini `models/{model}:generateContent`, `x-goog-api-key`; inline image parts | One image request; `512`, `1K`, `2K`, `4K` tiers and aspect ratio as supported by model |
| `LITELLM` / `LITELLM_IMAGE` | Configured proxy `/images/generations`; `data` | Proxy image model alias, size and count |
| `MICROSOFT_FOUNDRY` / `MICROSOFT_FOUNDRY_IMAGE` | Azure OpenAI deployment or v1 image endpoint; `api-key` or Entra bearer | Pixel size, count; deployment-specific constraints apply |
| `MINIMAX` / `MINIMAX_IMAGE` | `/image_generation`; `base_resp` and `data.image_base64` / `image_urls` | Aspect ratio or dimensions 512–2048 divisible by 8, count; prompt at most 1500 characters |
| `OPENAI` / `OPENAI_IMAGE` | `/images/generations`; `data` | Pixel size or `auto`, count; DALL·E 3 restricted to one |
| `OPENROUTER` / `OPENROUTER_IMAGE` | Dedicated `/images` API; `data[].b64_json` / `media_type` | Size tier or pixels, aspect ratio, count |
| `VYDRA` / `VYDRA_IMAGE` | `/jobs` with `workflow: generate_image`; poll ID until completed; `output.imageUrl` | One image; aspect ratio and model-supported `1K`, `2K`, `4K` |
| `XAI` / `XAI_IMAGE` | `/images/generations`; `data` | `1K` / `2K` resolution, aspect ratio, count |
| `VOLCENGINE` / `VOLCENGINE_IMAGE` | Ark `/images/generations`; `data` | One image; size tier or pixels. Seedream 5 Flash/Pro omit older group-image fields |

Aliases: `COMFY`, `GEMINI`, `CHATGPT`, `DOUBAO`, and `ARK`. Names are case-insensitive and normalize spaces/hyphens to underscores.

Existing Qwen configurations have two explicit routes: `QWEN_IMAGE` (including the frontend's `Qwen` protocol value) uses DashScope's synchronous multimodal-generation API; `OPENAI_IMAGE` uses the configured Qwen OpenAI-compatible image endpoint. These do not silently substitute another supplier. Native Qwen maps `WIDTHxHEIGHT` to the API's `WIDTH*HEIGHT`. Neither route accepts `aspectRatio`.

The common `count` range is 1–8, matching the artifact persistence limit. Providers may return fewer images. Unsupported count or size controls fail before generation where the route cannot express them. Image editing, references, streaming partial images, Imagen, fal queue submission, and Azure's legacy asynchronous DALL·E 2 endpoint are outside this text-to-image contract.

Trusted `options.size`, `options.aspectRatio`, and `options.count` supply defaults when the corresponding tool argument is omitted. Explicit arguments take precedence. Defaults pass through the same validation and provider capability checks as explicit arguments; for example, a configured count of two is rejected on a single-image route before billing. Other options cannot replace the prompt, selected model, endpoint, or credentials. When size is absent from both places, recognized Seedream 4/5 model codes use `2K`; other routes use their provider's own default.

## Trusted provider configuration

Endpoints can be base API URLs or complete generation endpoints. Preserve any required deployment query string. Do not use a chat-completions URL as an image endpoint.

- **Azure:** set a resource root plus `options.deployment` and `options.apiVersion`, or a complete `/openai/deployments/.../images/generations?api-version=...` URL. `/openai/v1` is also supported and sends the deployment as `model`. `options.authType: 'bearer'` uses an already-issued Entra token; default authentication is `api-key`.
- **ComfyUI:** `options.workflow` is an API-format workflow object, `options.promptNode` selects the prompt node, `options.promptInput` defaults to `text`, and `options.outputNodes` selects image-producing output nodes. The adapter clones the workflow and changes only that input. Missing configuration fails before submission. Local HTTP Comfy endpoints are supported; output URLs are constructed against that configured server.
- **Vydra/Comfy:** `options.pollIntervalMs` and `options.maxPollAttempts` bound polling. Defaults are 5 seconds for Vydra, 1 second for Comfy, and 300 polls. Cancellation stops local polling and downloading; it does not promise cancellation of a job already accepted by the provider.
- **OpenAI/LiteLLM/Azure:** optional trusted `quality`, `output_format`, `background`, and `style` are mapped explicitly. Configure only fields supported by the selected model.
- **OpenRouter:** optional `quality`, `output_format`, `background`, `seed`, and `provider` routing configuration.
- **MiniMax:** optional `seed` and `prompt_optimizer`. **fal:** optional `seed`, `num_inference_steps`, `guidance_scale`, and `output_format`. **Ark:** optional `watermark` and `output_format`. **Native Qwen:** optional `seed`, `negative_prompt`, `prompt_extend`, and `watermark`.

Generation is never automatically retried. The default total timeout is 180 seconds; trusted model configuration can set 1 ms–30 minutes. JSON responses are bounded at 70 MiB and binary assets use the runtime's byte limit. Remote downloads receive no model credentials. Transport redirects are rejected. PNG chunk completeness, JPEG frame/scan segments and WebP chunks are checked; these container checks do not replace a full image decode during acceptance. Unsupported formats (including SVG and animated WebP) fail explicitly.

The public adapter boundary returns safe error codes and generic abort/timeout errors. It does not expose URL parser inputs, provider response bodies, caller-supplied abort reasons, or underlying error causes.

## Verification

From this package, after workspace dependencies are linked:

```sh
npm test
```

Fixtures exercise all supplier routes, aliases, response bytes, upstream failures, malformed/empty/truncated media, provider/protocol mismatch, Azure URL/query/auth mapping, Comfy workflow isolation, Vydra terminal states and final-poll completion, timeout, abort, and download credential isolation. No test invokes a live provider. The frontend registry check reads the repository's supplier definitions only in tests; production code has no frontend dependency.

## Official protocol references

Checked 2026-10-15:

- [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [DeepInfra API reference](https://github.com/deepinfra/docs/blob/main/api-reference/introduction.mdx)
- [fal FLUX request schema](https://fal.ai/models/fal-ai/flux/dev/api)
- [Google Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [LiteLLM image generations](https://docs.litellm.ai/docs/image_generation)
- [Azure OpenAI image API](https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview)
- [MiniMax text-to-image API](https://platform.minimax.io/docs/api-reference/image-generation-t2i)
- [OpenAI image API](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [OpenRouter dedicated Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [Vydra generate-image workflow](https://www.vydra.ai/docs/workflows/generate-image) and [jobs](https://www.vydra.ai/docs/jobs)
- [xAI image API](https://docs.x.ai/developers/model-capabilities/images/generation)
- [Ark image API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=en)
- [Qwen image generation API](https://www.alibabacloud.com/help/zh/model-studio/qwen-image-generation-and-editing-api-reference)
