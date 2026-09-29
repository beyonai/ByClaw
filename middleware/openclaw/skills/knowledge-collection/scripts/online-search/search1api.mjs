const DEFAULT_BASE_URL = 'https://api.search1api.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const CATEGORY_SERVICE = Object.freeze({
  general: 'google',
  news: 'google',
  it: 'github',
  science: 'arxiv',
  videos: 'youtube',
  'social media': 'reddit',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function disabled(value) {
  return ['0', 'false', 'no', 'off'].includes(text(value).toLowerCase());
}

function error(category, code, retryable, message) {
  return { ok: false, error: { category, code, retryable, message } };
}

function httpError(status) {
  let category = 'provider';
  if (status === 401 || status === 403) category = 'authentication';
  else if (status === 402) category = 'payment';
  else if (status === 429) category = 'rate-limit';
  return error(category, `SEARCH1API_HTTP_${status}`, status === 402 || status === 429 || status >= 500,
    `Search1API request failed with HTTP ${status}`);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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

export async function runSearch1Api(args, options = {}) {
  const environment = options.environment || process.env;
  if (disabled(environment.SEARCH1API_ENABLED)) {
    return error('unavailable', 'SEARCH1API_DISABLED', false, 'Search1API is disabled');
  }
  const apiKey = text(environment.SEARCH1API_API_KEY);
  if (!apiKey) {
    return error('unavailable', 'SEARCH1API_KEY_MISSING', false, 'Search1API is not configured');
  }
  const timeoutMs = Math.min(positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const requestedSource = text(args.source).toLowerCase();
  const service = ['github', 'arxiv'].includes(requestedSource)
    ? requestedSource : (CATEGORY_SERVICE[text(args.category).toLowerCase()] || 'google');
  const body = {
    query: text(args.query),
    search_service: service,
    ...(text(args['time-range']) ? { time_range: text(args['time-range']) } : {}),
    max_results: positiveInteger(args['max-results'], 20),
  };
  const baseUrl = (text(environment.SEARCH1API_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let response;
  try {
    response = await (options.fetchImpl || fetch)(`${baseUrl}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (options.signal?.aborted) return error('cancelled', 'SEARCH1API_CANCELLED', false, 'Search1API request was cancelled');
    if (timeout.aborted || signal.aborted) return error('timeout', 'SEARCH1API_TIMEOUT', true, 'Search1API request timed out');
    return error('provider', 'SEARCH1API_REQUEST_FAILED', true, 'Search1API request failed');
  }
  if (!response?.ok) {
    await response?.body?.cancel?.().catch(() => undefined);
    return httpError(Number(response?.status) || 502);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return error('invalid-response', 'SEARCH1API_INVALID_JSON', false, 'Search1API returned invalid JSON');
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
    return error('invalid-response', 'SEARCH1API_INVALID_RESPONSE', false, 'Search1API returned an invalid response');
  }
  const results = payload.results.flatMap((row, index) => {
    const url = safeHttpUrl(row?.link);
    if (!row || typeof row !== 'object' || !url || !text(row.title)) return [];
    return [{
      url,
      title: text(row.title),
      content: text(row.snippet),
      ...(text(row.published_date) ? { publishedAt: text(row.published_date) } : {}),
      engine: service,
      provider: 'search1api',
      originalRank: index + 1,
      evidenceLevel: 'search-summary',
    }];
  });
  return {
    ok: true,
    document: { query: body.query, provider: 'search1api', results },
  };
}
