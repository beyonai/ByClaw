import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";

export type FetchLike = typeof globalThis.fetch;

/** ByClaw BE 标准响应外壳。 */
export interface ByClawBeEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: T;
}

/** 把 BE 调用异常（含可选上游 HTTP 状态）转换为各客户端自有错误类型的工厂。 */
export type ByClawBeErrorFactory = (message: string, statusCode?: number) => Error;

/** 校验并标准化 ByClaw BE 根地址，同时保留服务发现返回的 path_prefix。 */
export function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  url.pathname = url.pathname === "/" ? "/" : `/${url.pathname.replace(/^\/+|\/+$/g, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

/** 在 BE 根地址后拼接固定的 API 路径。 */
export function appendPath(baseUrl: URL, path: string): URL {
  const url = new URL(baseUrl);
  const prefix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}${path}`;
  return url;
}

/** 解析最终根地址：服务发现优先，无可用实例时回退环境变量根地址。 */
export async function resolveByClawBeBase(input: {
  endpointResolver?: ByClawBeEndpointResolver;
  fallbackBaseUrl: URL;
}): Promise<URL> {
  const discovered = await input.endpointResolver?.resolve();
  return discovered ? normalizeBaseUrl(discovered) : input.fallbackBaseUrl;
}

/** 构造 Beyond-Token / System-Code 鉴权头，可附加额外头（如 language）。 */
export function beyondTokenHeaders(input: {
  beyondToken: string;
  systemCode?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "Beyond-Token": input.beyondToken,
    ...(input.systemCode ? { "System-Code": input.systemCode } : {}),
    ...(input.extra ?? {}),
  };
}

export interface PostByClawBeJsonInput {
  fetchImpl: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
  fallbackBaseUrl: URL;
  timeoutMs: number;
  /** 请求路径（相对根地址）。 */
  path: string;
  beyondToken: string;
  systemCode?: string;
  body: unknown;
  /** 额外请求头（如 discover 的 `language`）。 */
  extraHeaders?: Record<string, string>;
  /** 用于拼接错误文案的业务标签，如 "discover" / "group chat"。 */
  label: string;
  /** 把网络/上游/外壳异常转换为本客户端的错误类型。 */
  toError: ByClawBeErrorFactory;
}

/**
 * 执行一次标准的 ByClaw BE POST JSON 调用，并解包标准响应外壳。
 *
 * 覆盖：地址解析（服务发现→回退）、超时、Beyond-Token/System-Code 头、
 * HTTP 状态、JSON 解析与 `code/success/data` 外壳校验。data 的业务形状由调用方自行校验。
 * 成功时返回外壳里的 `data`（保证非 undefined）。
 */
export async function postByClawBeJson(input: PostByClawBeJsonInput): Promise<unknown> {
  const base = await resolveByClawBeBase({
    ...(input.endpointResolver ? { endpointResolver: input.endpointResolver } : {}),
    fallbackBaseUrl: input.fallbackBaseUrl,
  });
  const url = appendPath(base, input.path);
  let response: Response;
  try {
    response = await input.fetchImpl(url, {
      method: "POST",
      headers: beyondTokenHeaders({
        beyondToken: input.beyondToken,
        ...(input.systemCode ? { systemCode: input.systemCode } : {}),
        ...(input.extraHeaders ? { extra: input.extraHeaders } : {}),
      }),
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    throw input.toError(
      error instanceof Error
        ? `ByClaw BE ${input.label} request failed: ${error.message}`
        : `ByClaw BE ${input.label} request failed`,
    );
  }

  if (!response.ok) {
    throw input.toError(`ByClaw BE ${input.label} returned HTTP ${response.status}`, response.status);
  }

  let envelope: ByClawBeEnvelope;
  try {
    envelope = (await response.json()) as ByClawBeEnvelope;
  } catch {
    throw input.toError(`ByClaw BE ${input.label} returned invalid JSON`);
  }

  if (envelope.code !== 0 || envelope.success === false || envelope.data === undefined) {
    throw input.toError(
      `ByClaw BE ${input.label} returned invalid result${
        typeof envelope.msg === "string" && envelope.msg ? `: ${envelope.msg}` : ""
      }`,
    );
  }
  return envelope.data;
}
