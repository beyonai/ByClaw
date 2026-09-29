import { callTypeSafeJev, resolveTypeSafeCapability } from './typesafe.mjs';
import { currentJevRun, inferenceKey, cachedInference, rememberInference, recordInferenceFailure, MAX_IN_FLIGHT } from './run-context.mjs';

const fail = (code, status = 'fallback') => ({ ok: false, diagnostic: { status, code } });

// The same gate applies before either an inference or ranking-score cache hit.
export function jevGate(options = {}, run = currentJevRun()) {
  const environment = options.environment || process.env;
  if (['false', '0', 'off'].includes(String(environment.TYPESAFE_ENABLED || '').trim().toLowerCase())) {
    return { code: 'JEV_DISABLED', status: 'disabled' };
  }
  if (options.privateData && !enterpriseInferenceAllowed(environment)) return { code: 'ENTERPRISE_INFERENCE_NOT_ENABLED' };
  if (!options.callJev) {
    const capability = resolveTypeSafeCapability(environment);
    if (capability.status !== 'configured') return { code: capability.code, status: capability.status, unavailable: true };
  }
  if (options.signal?.aborted) return { code: 'TYPESAFE_CANCELLED' };
  const remaining = options.remainingBudgetMs ? Number(options.remainingBudgetMs()) : 10000;
  const timeoutMs = Math.min(10000, Number.isFinite(remaining) ? Math.floor(remaining) : 0);
  if (timeoutMs <= 0) return { code: 'TYPESAFE_BUDGET_EXHAUSTED' };
  if (run?.circuit) return { code: 'JEV_CIRCUIT_OPEN' };
  return { timeoutMs };
}

function validAnswer(question, answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || answer.type !== question?.type) return false;
  if (question.type === 'choice') return typeof answer.choice === 'string' && Object.hasOwn(question.criteria || {}, answer.choice)
    && Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1;
  return question.type === 'noul' && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1;
}

function validResponse(response, payload) {
  try {
    if (!response || typeof response !== 'object' || ![true, false].includes(response.ok)) return fail('TYPESAFE_INVALID_RESPONSE');
    if (response.ok && (!response.document?.answers || typeof response.document.answers !== 'object'
      || Array.isArray(response.document.answers))) return fail('TYPESAFE_INVALID_RESPONSE');
    if (response.ok && !Object.entries(payload.questions || {}).every(([name, question]) =>
      validAnswer(question, response.document.answers[name]))) return fail('TYPESAFE_INVALID_RESPONSE');
    structuredClone(response);
    return response;
  } catch {
    return fail('TYPESAFE_INVALID_RESPONSE');
  }
}

function startInference(run, key, payload, options) {
  const entry = { controller: new AbortController(), waiters: 0, settled: false, closed: false };
  const shared = Boolean(run && run.inFlight.size < MAX_IN_FLIGHT);
  if (shared) run.inFlight.set(key, entry);
  const providerOptions = { ...options, signal: entry.controller.signal,
    // A provider may snapshot its budget before another waiter joins. A run's
    // shared transport therefore has its own ceiling; waiter timers enforce
    // each caller's budget and abort the transport when the last waiter leaves.
    ...(run ? { remainingBudgetMs: () => 10000 } : {}),
  };
  entry.promise = Promise.resolve().then(() => entry.closed ? fail('TYPESAFE_CANCELLED')
    : (options.callJev || callTypeSafeJev)(payload, providerOptions))
    .then((response) => validResponse(response, payload), () => fail('TYPESAFE_REQUEST_FAILED'))
    .then((response) => {
      entry.settled = true;
      if (shared && run.inFlight.get(key) === entry) run.inFlight.delete(key);
      if (entry.closed || run?.circuit) return fail('JEV_CIRCUIT_OPEN');
      if (response.ok) rememberInference(run, key, payload, response);
      else recordInferenceFailure(run, response);
      return response;
    }).catch(() => {
      entry.settled = true;
      if (shared && run.inFlight.get(key) === entry) run.inFlight.delete(key);
      const response = fail('TYPESAFE_INVALID_RESPONSE');
      if (!entry.closed && !run?.circuit) recordInferenceFailure(run, response);
      return response;
    });
  return entry;
}

function waitForInference(entry, options, timeoutMs, run, key) {
  entry.waiters += 1;
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const complete = (response) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) {
        entry.closed = true;
        entry.controller.abort();
        if (run?.inFlight.get(key) === entry) run.inFlight.delete(key);
        if (response?.diagnostic?.code === 'TYPESAFE_TIMEOUT') recordInferenceFailure(run, response);
      }
      try { resolve(structuredClone(response)); }
      catch { resolve(fail('TYPESAFE_INVALID_RESPONSE')); }
    };
    const onAbort = () => complete(fail('TYPESAFE_CANCELLED'));
    timer = setTimeout(() => complete(fail('TYPESAFE_TIMEOUT')), timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    entry.promise.then(complete);
  });
}

// Optional inference must not throw, leak provider errors, or outlive each caller's budget.
export async function safeCallJev(payload, options = {}) {
  const run = currentJevRun();
  try {
    const gate = jevGate(options, run);
    if (gate.code) {
      if (gate.unavailable) return callTypeSafeJev(payload, options);
      return fail(gate.code, gate.status);
    }
    const key = inferenceKey(payload, options);
    const cached = cachedInference(run, key);
    if (cached) return cached;
    let entry = run?.inFlight.get(key);
    if (entry) run.diagnostics.inferenceShared += 1;
    else entry = startInference(run, key, payload, options);
    return await waitForInference(entry, options, gate.timeoutMs, run, key);
  } catch {
    const response = fail('TYPESAFE_REQUEST_FAILED');
    recordInferenceFailure(run, response);
    return response;
  }
}

export function enterpriseInferenceAllowed(environment = process.env) {
  return String(environment.TYPESAFE_ENTERPRISE_ENABLED || '').trim().toLowerCase() === 'true';
}

export function publicOnlyTask(task) {
  return Array.isArray(task?.sourceScope) && task.sourceScope.length > 0
    && task.sourceScope.every((source) => source === 'public-internet');
}
