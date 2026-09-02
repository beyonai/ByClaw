import { runSearxng as defaultRunSearxng } from './searxng.mjs';
import { runTencentWsa as defaultRunWsa } from './tencent-wsa.mjs';

function elapsed(start, end) {
  const value = Number(end) - Number(start);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function successDiagnostic(result, durationMs) {
  const diagnostic = {
    status: 'success',
    durationMs,
    resultCount: Array.isArray(result.document?.results) ? result.document.results.length : 0,
  };
  if (result.document?.requestId) diagnostic.requestId = result.document.requestId;
  if (result.document?.providerVersion) diagnostic.providerVersion = result.document.providerVersion;
  return diagnostic;
}

function failedDiagnostic(result, durationMs) {
  return { status: 'failed', durationMs, ...(result?.error || {}) };
}

export async function runOnlineSearch(args, options = {}) {
  const now = options.now || (() => performance.now());
  const startedAt = now();
  const runWsa = options.runWsa || defaultRunWsa;
  const runSearxng = options.runSearxng || defaultRunSearxng;
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : 60_000;

  const wsaStartedAt = now();
  const wsaResult = await runWsa(args, {
    environment: options.environment,
    timeoutMs,
    client: options.wsaClient,
    capabilities: options.wsaCapabilities,
  });
  const wsaDurationMs = elapsed(wsaStartedAt, now());
  if (wsaResult?.ok && wsaResult.document) {
    const providerDiagnostics = {
      tencentWsa: successDiagnostic(wsaResult, wsaDurationMs),
      searxng: { status: 'skipped', durationMs: 0, skipReason: 'primary_provider_succeeded' },
    };
    return {
      ok: true,
      durationMs: elapsed(startedAt, now()),
      document: {
        ...wsaResult.document,
        provider: 'tencent-wsa',
        fallbackUsed: false,
        providerDiagnostics,
      },
    };
  }

  const consumedMs = elapsed(startedAt, now());
  const remainingMs = timeoutMs - consumedMs;
  const tencentWsa = failedDiagnostic(wsaResult, wsaDurationMs);
  if (remainingMs <= 0) {
    const providerDiagnostics = {
      tencentWsa,
      searxng: { status: 'skipped', durationMs: 0, skipReason: 'hard_budget_exhausted' },
    };
    return {
      ok: false,
      provider: null,
      fallbackUsed: false,
      error: { category: 'timeout', code: 'ONLINE_SEARCH_FAILED', retryable: true, message: 'Online search hard budget exhausted' },
      providerDiagnostics,
      durationMs: elapsed(startedAt, now()),
    };
  }

  const searxngStartedAt = now();
  const searxngResult = await runSearxng(args, {
    environment: options.environment,
    timeoutMs: remainingMs,
    runProcess: options.runProcess,
    pythonExecutable: options.pythonExecutable,
    searxngScript: options.searxngScript,
  });
  const searxngDurationMs = elapsed(searxngStartedAt, now());
  const providerDiagnostics = {
    tencentWsa,
    searxng: searxngResult?.ok
      ? successDiagnostic(searxngResult, searxngDurationMs)
      : failedDiagnostic(searxngResult, searxngDurationMs),
  };
  if (searxngResult?.ok && searxngResult.document) {
    return {
      ok: true,
      durationMs: elapsed(startedAt, now()),
      document: {
        ...searxngResult.document,
        provider: 'searxng',
        fallbackUsed: true,
        providerDiagnostics,
      },
    };
  }
  return {
    ok: false,
    provider: 'searxng',
    fallbackUsed: true,
    error: {
      category: 'provider',
      code: 'ONLINE_SEARCH_FAILED',
      retryable: true,
      message: 'Tencent WSA and SearXNG both failed',
    },
    providerDiagnostics,
    durationMs: elapsed(startedAt, now()),
  };
}
