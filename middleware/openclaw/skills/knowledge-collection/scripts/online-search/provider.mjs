import { runSearxng as defaultRunSearxng } from './searxng.mjs';
import { runSearch1Api as defaultRunSearch1Api } from './search1api.mjs';
import { runTencentWsa as defaultRunWsa } from './tencent-wsa.mjs';

const MAX_COMMERCIAL_PROVIDER_TIMEOUT_MS = 15_000;

function elapsed(start, end) {
  const value = Number(end) - Number(start);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function successDiagnostic(result, durationMs) {
  const diagnostic = { status: 'success', durationMs,
    resultCount: Array.isArray(result.document?.results) ? result.document.results.length : 0 };
  if (result.document?.requestId) diagnostic.requestId = result.document.requestId;
  if (result.document?.providerVersion) diagnostic.providerVersion = result.document.providerVersion;
  return diagnostic;
}

function failedDiagnostic(result, durationMs) {
  const status = result?.error?.category === 'unavailable' ? 'unavailable' : 'failed';
  return { status, durationMs, ...(result?.error || {}) };
}

function canonicalUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|ref_)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return String(raw || '');
  }
}

function normalizedResult(row, provider, index) {
  const engine = typeof row?.engine === 'string' && row.engine ? row.engine : provider;
  return { ...row, provider: typeof row?.provider === 'string' && row.provider ? row.provider : provider,
    engine, originalRank: Number.isSafeInteger(row?.originalRank) && row.originalRank > 0 ? row.originalRank : index + 1,
    providers: [provider], engines: [engine], providerAgreement: 1 };
}

function distinctValues(...values) {
  return [...new Set(values.flat().filter((value) => typeof value === 'string' && value.trim()))];
}

function mergedText(left, right) {
  return distinctValues(left, right).join('\n');
}

function mergeDocuments(successes, query) {
  const merged = new Map();
  for (const { provider, document } of successes) {
    for (const [index, raw] of (document.results || []).entries()) {
      const row = normalizedResult(raw, provider, index);
      const key = canonicalUrl(row.url);
      const found = merged.get(key);
      if (!found) { merged.set(key, row); continue; }
      if (found.providers.includes(provider)) {
        merged.set(`${key}#${provider}:${index}`, row);
        continue;
      }
      const providers = [...new Set([...found.providers, provider])];
      const engines = [...new Set([...found.engines, row.engine])];
      const sourceUrls = distinctValues(found.sourceUrls || [], found.url, row.sourceUrls || [], row.url);
      merged.set(key, { ...found,
        title: String(row.title || '').length > String(found.title || '').length ? row.title : found.title,
        content: mergedText(found.content, row.content),
        passage: mergedText(found.passage, row.passage),
        sourceUrls,
        originalRank: Math.min(found.originalRank, row.originalRank), providers, engines,
        providerAgreement: providers.length });
    }
  }
  const providers = successes.map(({ provider }) => provider);
  const providerDocument = successes.length === 1 ? successes[0].document : {};
  return { ...providerDocument, query, provider: providers.length === 1 ? providers[0] : 'multi', providers,
    fallbackUsed: false, results: [...merged.values()] };
}

async function timed(run, now, failureCode) {
  const startedAt = now();
  let result;
  try {
    result = await run();
  } catch {
    result = { ok: false, error: { category: 'provider', code: failureCode,
      retryable: true, message: 'Online search provider failed unexpectedly' } };
  }
  return { result, durationMs: elapsed(startedAt, now()) };
}

export async function runOnlineSearch(args, options = {}) {
  const now = options.now || (() => performance.now());
  const startedAt = now();
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 60_000;
  const commercialTimeoutMs = Math.max(1, Math.min(
    MAX_COMMERCIAL_PROVIDER_TIMEOUT_MS,
    Math.floor(timeoutMs / 2),
  ));
  const environment = options.environment || process.env;
  const [wsa, search1api] = await Promise.all([
    timed(() => (options.runWsa || defaultRunWsa)(args, { environment, timeoutMs: commercialTimeoutMs,
      client: options.wsaClient, capabilities: options.wsaCapabilities }), now, 'WSA_UNEXPECTED_ERROR'),
    timed(() => (options.runSearch1Api || defaultRunSearch1Api)(args, { environment, timeoutMs: commercialTimeoutMs,
      fetchImpl: options.search1ApiFetch, signal: options.signal }), now, 'SEARCH1API_UNEXPECTED_ERROR'),
  ]);
  const providerDiagnostics = {
    tencentWsa: wsa.result?.ok ? successDiagnostic(wsa.result, wsa.durationMs) : failedDiagnostic(wsa.result, wsa.durationMs),
    search1api: search1api.result?.ok ? successDiagnostic(search1api.result, search1api.durationMs)
      : failedDiagnostic(search1api.result, search1api.durationMs),
  };
  const successes = [];
  if (wsa.result?.ok && wsa.result.document) successes.push({ provider: 'tencent-wsa', document: wsa.result.document });
  if (search1api.result?.ok && search1api.result.document) successes.push({ provider: 'search1api', document: search1api.result.document });
  if (successes.length > 0 && options.supplementWithSearxng !== true) {
    providerDiagnostics.searxng = { status: 'skipped', durationMs: 0, skipReason: 'commercial_provider_succeeded' };
    const document = mergeDocuments(successes, args.query);
    return { ok: true, durationMs: elapsed(startedAt, now()), document: { ...document, providerDiagnostics } };
  }

  const remainingMs = timeoutMs - elapsed(startedAt, now());
  if (remainingMs <= 0) {
    providerDiagnostics.searxng = { status: 'skipped', durationMs: 0, skipReason: 'hard_budget_exhausted' };
    if (successes.length > 0) {
      const document = mergeDocuments(successes, args.query);
      return { ok: true, durationMs: elapsed(startedAt, now()), document: { ...document, providerDiagnostics } };
    }
    return { ok: false, provider: null, fallbackUsed: false,
      error: { category: 'timeout', code: 'ONLINE_SEARCH_FAILED', retryable: true,
        message: 'Online search hard budget exhausted' }, providerDiagnostics,
      durationMs: elapsed(startedAt, now()) };
  }
  const searxng = await timed(() => (options.runSearxng || defaultRunSearxng)(args, { environment,
    timeoutMs: remainingMs, runProcess: options.runProcess, pythonExecutable: options.pythonExecutable,
    searxngScript: options.searxngScript }), now, 'SEARXNG_UNEXPECTED_ERROR');
  providerDiagnostics.searxng = searxng.result?.ok ? successDiagnostic(searxng.result, searxng.durationMs)
    : failedDiagnostic(searxng.result, searxng.durationMs);
  if (searxng.result?.ok && searxng.result.document) {
    const document = mergeDocuments([...successes, { provider: 'searxng', document: searxng.result.document }], args.query);
    document.fallbackUsed = successes.length === 0;
    return { ok: true, durationMs: elapsed(startedAt, now()), document: { ...document, providerDiagnostics } };
  }
  if (successes.length > 0) {
    const document = mergeDocuments(successes, args.query);
    return { ok: true, durationMs: elapsed(startedAt, now()), document: { ...document, providerDiagnostics } };
  }
  return { ok: false, provider: 'searxng', fallbackUsed: true,
    error: { category: 'provider', code: 'ONLINE_SEARCH_FAILED', retryable: true,
      message: 'All online search providers failed' }, providerDiagnostics,
    durationMs: elapsed(startedAt, now()) };
}
