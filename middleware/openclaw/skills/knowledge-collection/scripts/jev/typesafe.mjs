const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 10_000;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveTypeSafeCapability(environment = process.env) {
  const model = text(environment.TYPESAFE_MODEL) || DEFAULT_MODEL;
  if (!text(environment.TYPESAFE_API_KEY)) {
    return { status: 'unavailable', code: 'TYPESAFE_API_KEY_MISSING', model, timeoutMs: DEFAULT_TIMEOUT_MS };
  }
  return { status: 'configured', model, timeoutMs: DEFAULT_TIMEOUT_MS };
}

function failure(status, category, code, retryable, message) {
  return { ok: false, diagnostic: { status, category, code, retryable, message } };
}

function httpFailure(status) {
  let category = 'provider';
  if (status === 401 || status === 403) category = 'authentication';
  else if (status === 402) category = 'payment';
  else if (status === 429) category = 'rate-limit';
  return failure('failed', category, `TYPESAFE_HTTP_${status}`, status === 402 || status === 429 || status >= 500,
    `TypeSafe Jev request failed with HTTP ${status}`);
}

function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedUsage(value) {
  const usage = validObject(value) ? value : {};
  return {
    input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
    output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
  };
}

function requestBudget(options) {
  if (typeof options.remainingBudgetMs !== 'function') return DEFAULT_TIMEOUT_MS;
  const remaining = Number(options.remainingBudgetMs());
  if (!Number.isFinite(remaining)) return DEFAULT_TIMEOUT_MS;
  return Math.min(DEFAULT_TIMEOUT_MS, Math.floor(remaining));
}

export async function callTypeSafeJev(payload, options = {}) {
  const environment = options.environment || process.env;
  const capability = resolveTypeSafeCapability(environment);
  if (capability.status !== 'configured') {
    return failure(capability.status, 'unavailable', capability.code, false,
      'TypeSafe Jev is not configured');
  }

  const timeoutMs = requestBudget(options);
  if (timeoutMs <= 0) {
    return failure('failed', 'timeout', 'TYPESAFE_BUDGET_EXHAUSTED', false,
      'TypeSafe Jev request budget is exhausted');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(TYPESAFE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${text(environment.TYPESAFE_API_KEY)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: payload.state, model: capability.model, questions: payload.questions }),
      signal,
    });
  } catch {
    if (options.signal?.aborted) {
      return failure('failed', 'cancelled', 'TYPESAFE_CANCELLED', false, 'TypeSafe Jev request was cancelled');
    }
    if (timeout.aborted || signal.aborted) {
      return failure('failed', 'timeout', 'TYPESAFE_TIMEOUT', true, 'TypeSafe Jev request timed out');
    }
    return failure('failed', 'provider', 'TYPESAFE_REQUEST_FAILED', true, 'TypeSafe Jev request failed');
  }
  if (!response?.ok) {
    await response?.body?.cancel?.().catch(() => undefined);
    return httpFailure(Number(response?.status) || 502);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return failure('failed', 'invalid-response', 'TYPESAFE_INVALID_JSON', false,
      'TypeSafe Jev returned invalid JSON');
  }
  if (!validObject(body) || !validObject(body.answers)) {
    return failure('failed', 'invalid-response', 'TYPESAFE_INVALID_RESPONSE', false,
      'TypeSafe Jev returned an invalid response');
  }
  const model = text(body.model) || capability.model;
  return {
    ok: true,
    document: { model, answers: body.answers, usage: normalizedUsage(body.usage) },
    diagnostic: { status: 'success', model },
  };
}
