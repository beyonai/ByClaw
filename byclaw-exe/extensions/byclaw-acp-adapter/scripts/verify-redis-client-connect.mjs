#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRedisConnectGate } from "../src/redis-connect-gate.js";

let status = "wait";
let connectCalls = 0;

const ensureConnected = createRedisConnectGate({
  isReady: () => status === "ready",
  connect: async () => {
    connectCalls += 1;
    if (status === "connecting" || status === "ready") {
      throw new Error("Redis is already connecting/connected");
    }
    status = "connecting";
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = "ready";
  },
});

await Promise.all([
  ensureConnected(),
  ensureConnected(),
  ensureConnected(),
  ensureConnected(),
  ensureConnected(),
]);

assert.equal(connectCalls, 1, "concurrent callers must share one Redis connection attempt");

await ensureConnected();
assert.equal(connectCalls, 1, "ready Redis clients must not reconnect");

let retryCalls = 0;
const ensureConnectedAfterFailure = createRedisConnectGate({
  isReady: () => false,
  connect: async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      throw new Error("initial connection failed");
    }
  },
});

await assert.rejects(ensureConnectedAfterFailure(), /initial connection failed/u);
await ensureConnectedAfterFailure();
assert.equal(retryCalls, 2, "failed Redis connection attempts must be retryable");

console.log("redis client concurrent connect verification passed");
