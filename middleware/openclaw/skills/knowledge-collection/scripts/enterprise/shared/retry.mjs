import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

const MAX_ATTEMPTS = 3;
const MAX_DELAY_MS = 30_000;

export async function withRateLimitRetry(operation, { delay = setTimeoutPromise } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await operation(attempt);
    if (!result?.rateLimited) return result;
    if (attempt === MAX_ATTEMPTS) {
      return { rateLimited: true, exhausted: true };
    }

    const retryAfterMs = Number(result.retryAfterMs);
    const requestedDelay = Number.isFinite(retryAfterMs) && retryAfterMs >= 0
      ? retryAfterMs
      : 1_000 * (2 ** (attempt - 1));
    await delay(Math.min(requestedDelay, MAX_DELAY_MS));
  }
  throw new Error('unreachable');
}
