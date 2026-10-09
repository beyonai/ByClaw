import { randomUUID } from 'node:crypto';

const processNonce = randomUUID();
const transports = new WeakMap();
let transportCount = 0;

function transportIdentity(value) {
  if (typeof value !== 'function') return 'default';
  if (!transports.has(value)) transports.set(value, `${processNonce}:${++transportCount}`);
  return transports.get(value);
}

export function transportDependencies(options) {
  return { callJev: transportIdentity(options.callJev), fetchImpl: transportIdentity(options.fetchImpl) };
}
