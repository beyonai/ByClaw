import { isIP } from "node:net";

export type ThirdPartyIntegrationType = "INTERFACE" | "A2A" | "PAGE";

export interface ThirdPartyExecutionDescriptor {
  resourceId: string;
  revision?: number;
  integrationType: ThirdPartyIntegrationType;
  endpoint: string;
  headers: Record<string, string>;
  authType?: string;
  expiresAt?: number;
}

export interface ExecutionDescriptorClientOptions {
  baseUrl: string;
  timeoutMs: number;
  pathPrefix?: string;
  serviceCredential?: string;
  fetchImpl?: typeof globalThis.fetch;
  resolveBaseUrl?: () => Promise<string | undefined>;
  allowInsecureExternalHttp?: boolean;
  allowedExternalHosts?: readonly string[];
  maxResponseBytes?: number;
}

export interface ExecutionDescriptorRequest {
  resourceId: string;
  beyondToken: string;
  systemCode?: string;
  expectedIntegrationType: ThirdPartyIntegrationType;
  signal?: AbortSignal;
}

const DEFAULT_DESCRIPTOR_PATH =
  "/byaiService/api/internal/v1/digital-employees";
const BLOCKED_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 获取一次性三方执行描述；响应中的 endpoint/header 只在当前调用栈内使用。 */
export class ExecutionDescriptorClient {
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #pathPrefix: string;
  readonly #serviceCredential: string | undefined;
  readonly #fetch: typeof globalThis.fetch;
  readonly #resolveBaseUrl: (() => Promise<string | undefined>) | undefined;
  readonly #allowInsecureExternalHttp: boolean;
  readonly #allowedExternalHosts: ReadonlySet<string>;
  readonly #maxResponseBytes: number;

  constructor(options: ExecutionDescriptorClientOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#pathPrefix = normalizePathPrefix(
      options.pathPrefix ?? DEFAULT_DESCRIPTOR_PATH,
    );
    this.#serviceCredential = options.serviceCredential?.trim() || undefined;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#resolveBaseUrl = options.resolveBaseUrl;
    this.#allowInsecureExternalHttp =
      options.allowInsecureExternalHttp ?? false;
    this.#allowedExternalHosts = new Set(
      (options.allowedExternalHosts ?? [])
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    this.#maxResponseBytes = options.maxResponseBytes ?? 262_144;
  }

  async get(
    input: ExecutionDescriptorRequest,
  ): Promise<ThirdPartyExecutionDescriptor> {
    const resourceId = input.resourceId.trim();
    if (!resourceId) {
      throw new Error("Third-party resourceId must not be empty");
    }
    if (!input.beyondToken.trim()) {
      throw new Error("Beyond-Token is required for execution descriptor");
    }
    const discovered = await this.#resolveBaseUrl?.();
    const baseUrl = discovered
      ? normalizeBaseUrl(discovered)
      : this.#fallbackBaseUrl;
    const url = new URL(baseUrl);
    const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    url.pathname = `${basePath}${this.#pathPrefix}/${encodeURIComponent(resourceId)}/execution-descriptor`;
    url.search = "";
    url.hash = "";

    const signals = [
      AbortSignal.timeout(this.#timeoutMs),
      ...(input.signal ? [input.signal] : []),
    ];
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "Beyond-Token": input.beyondToken,
        ...(input.systemCode ? { "System-Code": input.systemCode } : {}),
        ...(this.#serviceCredential
          ? { "X-Byclaw-Super-Service": this.#serviceCredential }
          : {}),
      },
      body: JSON.stringify({
        expectedIntegrationType: input.expectedIntegrationType,
      }),
      signal: AbortSignal.any(signals),
    });
    if (!response.ok) {
      throw new Error(
        `Execution descriptor returned HTTP ${response.status}`,
      );
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.#maxResponseBytes) {
      throw new Error("Execution descriptor response is too large");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("Execution descriptor returned invalid JSON");
    }
    const descriptor = parseDescriptor(raw, resourceId);
    if (descriptor.integrationType !== input.expectedIntegrationType) {
      throw new Error(
        `Execution descriptor integration type mismatch: expected ${input.expectedIntegrationType}, received ${descriptor.integrationType}`,
      );
    }
    if (
      descriptor.expiresAt !== undefined &&
      descriptor.expiresAt <= Date.now()
    ) {
      throw new Error("Execution descriptor is expired");
    }
    validateExternalUrl(descriptor.endpoint, {
      allowInsecureHttp: this.#allowInsecureExternalHttp,
      allowedHosts: this.#allowedExternalHosts,
    });
    return descriptor;
  }

  async health(): Promise<{ healthy: boolean; message?: string }> {
    try {
      normalizeBaseUrl(this.#fallbackBaseUrl.toString());
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export interface ParsedSseEvent {
  event?: string;
  id?: string;
  data: string;
}

/** 按 EventSource 行语义解析流，正确处理多行 data、CRLF、心跳和末尾无空行。 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ParsedSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let eventType: string | undefined;
  let eventId: string | undefined;

  const dispatch = (): ParsedSseEvent | undefined => {
    if (dataLines.length === 0) {
      eventType = undefined;
      return undefined;
    }
    const event: ParsedSseEvent = {
      data: dataLines.join("\n"),
      ...(eventType ? { event: eventType } : {}),
      ...(eventId ? { id: eventId } : {}),
    };
    dataLines = [];
    eventType = undefined;
    return event;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        if (line === "") {
          const event = dispatch();
          if (event) {
            yield event;
          }
        } else if (!line.startsWith(":")) {
          const separator = line.indexOf(":");
          const field = separator >= 0 ? line.slice(0, separator) : line;
          let fieldValue = separator >= 0 ? line.slice(separator + 1) : "";
          if (fieldValue.startsWith(" ")) {
            fieldValue = fieldValue.slice(1);
          }
          if (field === "data") {
            dataLines.push(fieldValue);
          } else if (field === "event") {
            eventType = fieldValue;
          } else if (field === "id" && !fieldValue.includes("\0")) {
            eventId = fieldValue;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
      if (done) {
        if (buffer) {
          const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          }
        }
        const event = dispatch();
        if (event) {
          yield event;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string {
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function validateExternalUrl(
  value: string,
  options: {
    allowInsecureHttp?: boolean;
    allowedHosts?: ReadonlySet<string>;
  } = {},
): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(options.allowInsecureHttp && url.protocol === "http:")
  ) {
    throw new Error(`Third-party endpoint protocol is not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("Third-party endpoint must not contain userinfo");
  }
  const host = url.hostname.toLowerCase();
  if (options.allowedHosts && options.allowedHosts.size > 0) {
    if (!options.allowedHosts.has(host)) {
      throw new Error(`Third-party endpoint host is not allowlisted: ${host}`);
    }
  } else if (isBlockedHost(host)) {
    throw new Error(`Third-party endpoint host is not allowed: ${host}`);
  }
  return url;
}

function parseDescriptor(
  value: unknown,
  expectedResourceId: string,
): ThirdPartyExecutionDescriptor {
  const envelope = record(value);
  const data = record(envelope?.data) ?? envelope;
  if (!data) {
    throw new Error("Execution descriptor payload must be an object");
  }
  const resourceId = stringValue(data.resourceId) || expectedResourceId;
  if (resourceId !== expectedResourceId) {
    throw new Error("Execution descriptor resourceId mismatch");
  }
  const integrationType = stringValue(data.integrationType).toUpperCase();
  if (
    integrationType !== "INTERFACE" &&
    integrationType !== "A2A" &&
    integrationType !== "PAGE"
  ) {
    throw new Error(
      `Execution descriptor integrationType is invalid: ${integrationType || "<empty>"}`,
    );
  }
  const endpoint =
    stringValue(data.endpoint) ||
    stringValue(data.agentSseUrl) ||
    stringValue(data.agentHomeUrl) ||
    stringValue(data.agentWebUrl);
  if (!endpoint) {
    throw new Error("Execution descriptor endpoint is missing");
  }
  const revision = finiteNumber(data.revision);
  const expiresAt = finiteNumber(data.expiresAt);
  return {
    resourceId,
    integrationType,
    endpoint,
    headers: normalizeHeaders(data.headers ?? data.agentSseHead),
    ...(revision !== undefined ? { revision } : {}),
    ...(stringValue(data.authType)
      ? { authType: stringValue(data.authType) }
      : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

function normalizeHeaders(value: unknown): Record<string, string> {
  let parsed = value;
  if (typeof value === "string" && value.trim()) {
    parsed = safeJsonParse(value);
  }
  const input = record(parsed);
  if (!input) {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [name, raw] of Object.entries(input)) {
    const normalizedName = name.trim();
    const lower = normalizedName.toLowerCase();
    if (
      !normalizedName ||
      BLOCKED_HEADER_NAMES.has(lower) ||
      /[\r\n]/.test(normalizedName)
    ) {
      continue;
    }
    if (
      (typeof raw === "string" || typeof raw === "number") &&
      !/[\r\n]/.test(String(raw))
    ) {
      output[normalizedName] = String(raw);
    }
  }
  return output;
}

function isBlockedHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split(".").map(Number);
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (ipVersion === 6) {
    const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return false;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ByClaw BE base URL protocol is invalid: ${url.protocol}`);
  }
  url.pathname =
    url.pathname === "/"
      ? "/"
      : `/${url.pathname.replace(/^\/+|\/+$/g, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Execution descriptor path must not be empty");
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}
