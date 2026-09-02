const INDUSTRY_BY_CATEGORY = Object.freeze({ news: 'news', science: 'acad', finance: 'finance', gov: 'gov' });
const FRESHNESS_BY_RANGE = Object.freeze({ day: 'd1', week: 'd7', month: 'm1', year: 'y1' });
const COUNT_VALUES = Object.freeze([10, 20, 30, 40, 50]);
const MAX_WARNING_CHARS = 300;
const DEFAULT_TIMEOUT_MS = 10_000;

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requestedLimit(args) {
  return positiveInteger(args?.['requested-count']) || positiveInteger(args?.['max-results']);
}

function roundedCount(limit) {
  if (!limit) return null;
  return COUNT_VALUES.find((candidate) => candidate >= limit) || COUNT_VALUES.at(-1);
}

export function buildSearchParams(args = {}, capabilities = {}) {
  const query = requireText(args.query, 'query');
  const params = { Query: query, Mode: 0 };
  const industry = INDUSTRY_BY_CATEGORY[String(args.category || '').trim()];
  const freshness = FRESHNESS_BY_RANGE[String(args['time-range'] || '').trim()];
  const count = roundedCount(requestedLimit(args));
  if (capabilities.industry && industry) params.Industry = industry;
  if (freshness) params.Freshness = freshness;
  if (capabilities.count && count) params.Cnt = count;
  return params;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePage(page) {
  const url = safeHttpUrl(page?.url);
  const title = optionalText(page?.title);
  if (!url || !title) return null;
  const candidate = {
    url,
    title,
    content: optionalText(page.content) || optionalText(page.passage) || '',
    engine: 'tencent-wsa',
  };
  if (Number.isFinite(page.score)) candidate.score = page.score;
  const publishedAt = optionalText(page.date);
  if (publishedAt) candidate.publishedAt = publishedAt;
  const site = optionalText(page.site);
  if (site) candidate.site = site;
  if (Number.isFinite(page.authority_level)) candidate.authorityLevel = page.authority_level;
  return candidate;
}

function invalidResponse(message) {
  return Object.assign(new Error(message), { code: 'INVALID_WSA_RESPONSE' });
}

export function normalizeSearchResponse(rawResponse, fallbackQuery = '') {
  const response = rawResponse?.Response && typeof rawResponse.Response === 'object'
    ? rawResponse.Response : rawResponse;
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw invalidResponse('WSA response must be an object');
  }
  if (!Array.isArray(response.Pages)) {
    throw invalidResponse('WSA response Pages must be an array');
  }

  const warnings = [];
  const results = [];
  response.Pages.forEach((encoded, index) => {
    try {
      const page = typeof encoded === 'string' ? JSON.parse(encoded) : encoded;
      const candidate = normalizePage(page);
      if (!candidate) throw new Error('missing a safe URL or title');
      results.push(candidate);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`Pages[${index}] ignored: ${detail}`.slice(0, MAX_WARNING_CHARS));
    }
  });
  if (response.Pages.length > 0 && results.length === 0) {
    throw invalidResponse('WSA response contained no normalizable Pages');
  }

  const document = {
    query: optionalText(response.Query) || requireText(fallbackQuery, 'query'),
    provider: 'tencent-wsa',
    results,
    warnings,
  };
  const requestId = optionalText(response.RequestId);
  if (requestId) document.requestId = requestId;
  const providerVersion = optionalText(response.Version);
  if (providerVersion) document.providerVersion = providerVersion;
  const message = optionalText(response.Msg);
  if (message) document.message = message.slice(0, MAX_WARNING_CHARS);
  return document;
}

function redact(value) {
  return String(value || '')
    .replace(/((?:authorization|cookie|credential|password|secret(?:id|key)?|token)\s*(?:=|:)\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 1_000);
}

function errorCategory(code, message) {
  const combined = `${code} ${message}`;
  if (/limit|throttl|rate/i.test(combined)) return 'rate-limit';
  if (/auth|unauthor|signature|credential/i.test(combined)) return 'authentication';
  if (/resource|notfound|not.?open|unavailable/i.test(combined)) return 'resource';
  if (/timeout/i.test(combined)) return 'timeout';
  if (/network|dns|tls|socket|connect|fetch/i.test(combined)) return 'network';
  if (/INVALID_WSA_RESPONSE/.test(code)) return 'invalid-response';
  return 'provider';
}

export function sanitizeProviderError(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'WSA_PROVIDER_ERROR';
  const message = redact(error instanceof Error ? error.message : error);
  const category = errorCategory(code, message);
  const result = {
    category,
    code,
    retryable: ['rate-limit', 'timeout', 'network', 'provider'].includes(category),
    message: message || 'Tencent WSA request failed',
  };
  if (typeof error?.requestId === 'string' && error.requestId.trim()) {
    result.requestId = error.requestId.trim();
  }
  return result;
}

function unavailable(code, message) {
  return { ok: false, error: { category: 'unavailable', code, retryable: false, message } };
}

function configuredCapabilities(environment) {
  const values = new Set(String(environment.TENCENT_WSA_CAPABILITIES || '')
    .split(',').map((value) => value.trim()).filter(Boolean));
  return { industry: values.has('industry'), count: values.has('count') };
}

async function createSdkClient(environment, timeoutMs) {
  const imported = await import('tencentcloud-sdk-nodejs');
  const sdk = imported.default || imported;
  const Client = sdk?.wsa?.v20250508?.Client;
  if (typeof Client !== 'function') throw Object.assign(new Error('Tencent WSA SDK client is unavailable'), {
    code: 'WSA_SDK_UNAVAILABLE',
  });
  return new Client({
    credential: {
      secretId: environment.TENCENTCLOUD_SECRET_ID,
      secretKey: environment.TENCENTCLOUD_SECRET_KEY,
    },
    region: '',
    profile: {
      httpProfile: {
        endpoint: 'wsa.tencentcloudapi.com',
        reqTimeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
      },
    },
  });
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`WSA timeout after ${timeoutMs}ms`), {
          code: 'WSA_TIMEOUT',
        })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runTencentWsa(args, options = {}) {
  const environment = options.environment || process.env;
  const enabledSetting = String(environment.TENCENT_WSA_ENABLED || '').trim().toLowerCase();
  const hasCredentials = Boolean(optionalText(environment.TENCENTCLOUD_SECRET_ID)
    && optionalText(environment.TENCENTCLOUD_SECRET_KEY));
  if (enabledSetting === 'false' || (enabledSetting !== 'true' && !hasCredentials)) {
    return unavailable('WSA_DISABLED', 'Tencent WSA is not enabled');
  }
  if (!hasCredentials) {
    return unavailable('WSA_CREDENTIALS_MISSING', 'Tencent WSA credentials are not configured');
  }
  const configuredTimeout = positiveInteger(environment.TENCENT_WSA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const timeoutMs = positiveInteger(options.timeoutMs)
    ? Math.min(options.timeoutMs, configuredTimeout) : configuredTimeout;
  try {
    const client = options.client || await createSdkClient(environment, timeoutMs);
    const params = buildSearchParams(args, options.capabilities || configuredCapabilities(environment));
    const response = await withTimeout(Promise.resolve(client.SearchPro(params)), timeoutMs);
    const document = normalizeSearchResponse(response, params.Query);
    const limit = requestedLimit(args);
    if (limit) document.results = document.results.slice(0, limit);
    return { ok: true, document };
  } catch (error) {
    return { ok: false, error: sanitizeProviderError(error) };
  }
}
