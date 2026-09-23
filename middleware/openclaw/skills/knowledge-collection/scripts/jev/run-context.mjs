import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { transportDependencies } from './transport-identity.mjs';

const runs = new AsyncLocalStorage();
const MAX_ENTRIES = 128;
const CACHE_TTL_MS = 60_000;
export const MAX_IN_FLIGHT = 128;

// Memory belongs to one workflow invocation, never another task or resumed process.
export function withJevRun(operation) {
  return runs.getStore() ? operation() : runs.run({ cache: new Map(), scoreCache: new Map(), inFlight: new Map(),
    circuit: null, diagnostics: { inferenceCacheHits: 0, inferenceShared: 0, scoreCacheHits: 0 } }, operation);
}

export function currentJevRun() { return runs.getStore(); }

export function inferenceKey(payload, options) {
  return createHash('sha256').update(JSON.stringify({ version: 1, payload,
    model: (options.environment || process.env).TYPESAFE_MODEL || 'jev-latest',
    privateData: options.privateData === true, policy: options.cachePolicy || null,
    credential: (options.environment || process.env).TYPESAFE_API_KEY || null,
    ...transportDependencies(options),
  })).digest('hex');
}

export function cachedInference(run, key) {
  const entry = run?.cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= CACHE_TTL_MS) { run.cache.delete(key); return null; }
  run.diagnostics.inferenceCacheHits += 1;
  return structuredClone(entry.response);
}

export function rememberInference(run, key, payload, response) {
  if (!run || run.circuit || !response.ok || !Object.keys(payload.questions || {}).length) return;
  // Cache only schema-valid, confident complete decisions. Callers still apply
  // their domain-specific thresholds; uncertain responses retain legacy behavior.
  const valid = Object.entries(payload.questions).every(([name, question]) => {
    const answer = response.document?.answers?.[name];
    if (answer?.type !== question.type) return false;
    if (question.type === 'choice') return Object.hasOwn(question.criteria || {}, answer.choice)
      && Number.isFinite(answer.confidence) && answer.confidence >= 0.8 && answer.confidence <= 1;
    return question.type === 'noul' && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1;
  });
  if (!valid) return;
  if (run.cache.size >= MAX_ENTRIES) run.cache.delete(run.cache.keys().next().value);
  run.cache.set(key, { at: Date.now(), response: structuredClone(response) });
}

export function scoreKey(dependencies) {
  return createHash('sha256').update(JSON.stringify({ version: 1, ...dependencies })).digest('hex');
}

export function cachedScore(run, key) {
  const entry = run?.scoreCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= CACHE_TTL_MS) { run.scoreCache.delete(key); return null; }
  run.diagnostics.scoreCacheHits += 1;
  return entry.value;
}

export function rememberScores(run, entries) {
  if (!run || run.circuit) return;
  for (const [key, value] of entries) {
    if (run.scoreCache.size >= MAX_ENTRIES && !run.scoreCache.has(key)) run.scoreCache.delete(run.scoreCache.keys().next().value);
    run.scoreCache.set(key, { at: Date.now(), value });
  }
}

export function recordInferenceFailure(run, response) {
  const code = response?.diagnostic?.code || '';
  if (run && !response?.ok && /^TYPESAFE_(?:TIMEOUT|REQUEST_FAILED|INVALID_|HTTP_)/.test(code)) {
    run.circuit = code;
    run.cache.clear();
    run.scoreCache.clear();
    for (const entry of run.inFlight.values()) {
      entry.closed = true;
      entry.controller.abort();
    }
    run.inFlight.clear();
  }
}
