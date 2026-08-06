#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const CONNECTOR_CODE = "dingtalk";
const ENDPOINT_PATH = "/byaiService/connector/authorization/skill-complete";
const REQUEST_TIMEOUT_MS = 75_000;
const PUBLIC_BACKEND_ERROR_CODES = new Set([
  "AUTH_BINDING_FAILED",
  "CONNECTOR_CREDENTIAL_INVALID",
  "CONNECTOR_MANIFEST_INVALID",
  "CONNECTOR_NOT_FOUND",
  "CONNECTOR_VERIFICATION_FAILED",
  "CONNECTOR_VERIFICATION_TIMEOUT",
  "CONNECTOR_VERIFIER_NOT_FOUND",
  "CREDENTIAL_WORKSPACE_UNAVAILABLE",
]);
const REDIS_TIMEOUT_MS = 3_000;
const SERVICE_INSTANCE_PREFIX = "byai_gateway:sd:instances:";

class PublicFailure extends Error {
  constructor(errorCode, retryable, exitCode = 1) {
    super(errorCode);
    this.errorCode = errorCode;
    this.retryable = retryable;
    this.exitCode = exitCode;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function connectorCodeFromArgs(argv) {
  if (argv.length !== 0) {
    throw new PublicFailure("CONNECTOR_SYNC_ARGUMENT_INVALID", false, 2);
  }
  return CONNECTOR_CODE;
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function candidateAuthFiles() {
  const home = os.homedir();
  const stateDir = firstNonEmpty(process.env.OPENCLAW_STATE_DIR, path.join(home, ".openclaw"));
  return [...new Set([
    path.join(home, ".openclaw", "workspace", "baiying-session.json"),
    path.join(stateDir, "workspace", "baiying-session.json"),
    path.join(stateDir, "identity", "by_user_info.json"),
    "/by/.openclaw/workspace/baiying-session.json",
    "/by/.openclaw/identity/by_user_info.json",
  ])];
}

function headerValue(headers, expectedName) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return "";
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === expectedName.toLowerCase()) {
      return firstNonEmpty(value);
    }
  }
  return "";
}

function tokenFromAuth(auth) {
  const candidates = [auth, auth?.data, auth?.user, auth?.userInfo, auth?.currentUser, auth?.loginInfo];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const token = firstNonEmpty(
      candidate.beyondToken,
      candidate.beyond_token,
      candidate["Beyond-Token"],
      candidate["beyond-token"],
      headerValue(candidate.headers, "Beyond-Token"),
    );
    if (token) {
      return token;
    }
  }
  return "";
}

function loadBeyondToken() {
  let token = firstNonEmpty(process.env.BEYOND_TOKEN);
  if (!token) {
    for (const filePath of candidateAuthFiles()) {
      const auth = readJsonIfExists(filePath);
      token = firstNonEmpty(tokenFromAuth(auth), token);
    }
  }
  if (!token) {
    throw new PublicFailure("AUTH_CONTEXT_UNAVAILABLE", false);
  }
  return token;
}

function loopbackBackendOrigin() {
  const port = firstNonEmpty(process.env.BE_SERVER_PORT, "8086");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new PublicFailure("BACKEND_SERVICE_UNAVAILABLE", true);
  }
  return `http://127.0.0.1:${port}`;
}

function encodeRedisCommand(args) {
  return `*${args.length}\r\n${args.map((argument) => {
    const text = String(argument);
    return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
  }).join("")}`;
}

function parseResp(buffer, offset = 0) {
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd < 0) {
    return undefined;
  }
  const type = buffer[offset];
  const line = buffer.slice(offset + 1, lineEnd).toString("utf8");
  const next = lineEnd + 2;
  if (type === 43) {
    return { value: line, offset: next };
  }
  if (type === 45) {
    throw new Error("redis error");
  }
  if (type === 58) {
    return { value: Number.parseInt(line, 10), offset: next };
  }
  if (type === 36) {
    const length = Number.parseInt(line, 10);
    if (length === -1) {
      return { value: null, offset: next };
    }
    const end = next + length;
    if (buffer.length < end + 2) {
      return undefined;
    }
    return { value: buffer.slice(next, end).toString("utf8"), offset: end + 2 };
  }
  if (type === 42) {
    const length = Number.parseInt(line, 10);
    const values = [];
    let cursor = next;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseResp(buffer, cursor);
      if (!parsed) {
        return undefined;
      }
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  throw new Error("unsupported redis response");
}

function connectRedis(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("redis timeout"));
    }, REDIS_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function redisCommand(socket, args) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("redis timeout"));
    }, REDIS_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseResp(buffer);
        if (parsed) {
          cleanup();
          resolve(parsed.value);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(encodeRedisCommand(args));
  });
}

async function redisHash(host, port, key) {
  const socket = await connectRedis(host, port);
  try {
    const password = firstNonEmpty(process.env.REDIS_PASSWORD);
    const username = firstNonEmpty(process.env.REDIS_USERNAME);
    if (password) {
      await redisCommand(socket, username ? ["AUTH", username, password] : ["AUTH", password]);
    }
    const database = Number(firstNonEmpty(process.env.REDIS_DATABASE, "0"));
    if (Number.isInteger(database) && database > 0) {
      await redisCommand(socket, ["SELECT", database]);
    }
    return await redisCommand(socket, ["HGETALL", key]);
  } finally {
    socket.end();
  }
}

function serviceInstanceOrigin(raw) {
  try {
    const instance = JSON.parse(raw);
    const protocol = firstNonEmpty(instance.protocol, "http").toLowerCase();
    const host = firstNonEmpty(instance.host);
    const port = Number(instance.port);
    if (!["http", "https"].includes(protocol)
        || !host
        || /[\s/?#@]/.test(host)
        || !Number.isInteger(port)
        || port < 1
        || port > 65535) {
      return undefined;
    }
    return {
      origin: `${protocol}://${host}:${port}`,
      weight: Number(instance.weight) || 1,
      id: firstNonEmpty(instance.id),
    };
  } catch {
    return undefined;
  }
}

async function discoverBackendOrigin() {
  const redisHost = firstNonEmpty(process.env.REDIS_HOST);
  if (!redisHost) {
    return loopbackBackendOrigin();
  }
  const redisPort = Number(firstNonEmpty(process.env.REDIS_PORT, "6379"));
  if (!Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) {
    throw new PublicFailure("BACKEND_SERVICE_UNAVAILABLE", true);
  }
  try {
    const serviceName = firstNonEmpty(process.env.BE_DOMAINNAME, "ByaiService");
    const values = await redisHash(redisHost, redisPort, `${SERVICE_INSTANCE_PREFIX}${serviceName}`);
    const instances = [];
    for (let index = 1; Array.isArray(values) && index < values.length; index += 2) {
      const instance = serviceInstanceOrigin(values[index]);
      if (instance) {
        instances.push(instance);
      }
    }
    instances.sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
    if (!instances.length) {
      throw new Error("no backend instances");
    }
    return instances[0].origin;
  } catch {
    throw new PublicFailure("BACKEND_SERVICE_UNAVAILABLE", true);
  }
}

function sanitizeBackendResult(payload) {
  const data = payload && typeof payload === "object" ? payload.data : undefined;
  if (payload?.code === 0 && data?.connected === true) {
    return { connected: true };
  }
  const errorCode = typeof data?.errorCode === "string"
    && PUBLIC_BACKEND_ERROR_CODES.has(data.errorCode)
    ? data.errorCode
    : "CONNECTOR_SYNC_FAILED";
  return {
    connected: false,
    errorCode,
    retryable: data?.retryable === true,
  };
}

async function synchronizeOnce(endpoint, connectorCode, beyondToken) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Beyond-Token": beyondToken,
      },
      body: JSON.stringify({ connectorCode }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublicFailure("CONNECTOR_SYNC_TIMEOUT", false);
    }
    throw new PublicFailure("CONNECTOR_SYNC_NETWORK_ERROR", true);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new PublicFailure("CONNECTOR_SYNC_HTTP_ERROR", retryable);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PublicFailure("CONNECTOR_SYNC_RESPONSE_INVALID", true);
  }
  return sanitizeBackendResult(payload);
}

async function synchronize(connectorCode, beyondToken) {
  const endpoint = new URL(ENDPOINT_PATH, await discoverBackendOrigin());
  let lastFailure;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await synchronizeOnce(endpoint, connectorCode, beyondToken);
      if (result.connected || !result.retryable || attempt === 1) {
        return result;
      }
    } catch (error) {
      const failure = error instanceof PublicFailure
        ? error
        : new PublicFailure("CONNECTOR_SYNC_FAILED", false);
      lastFailure = failure;
      if (!failure.retryable || attempt === 1) {
        throw failure;
      }
    }
  }
  throw lastFailure ?? new PublicFailure("CONNECTOR_SYNC_FAILED", false);
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main() {
  try {
    const connectorCode = connectorCodeFromArgs(process.argv.slice(2));
    const beyondToken = loadBeyondToken();
    const result = await synchronize(connectorCode, beyondToken);
    printResult(result);
    process.exitCode = result.connected ? 0 : 1;
  } catch (error) {
    const failure = error instanceof PublicFailure
      ? error
      : new PublicFailure("CONNECTOR_SYNC_FAILED", false);
    printResult({
      connected: false,
      errorCode: failure.errorCode,
      retryable: failure.retryable,
    });
    process.exitCode = failure.exitCode;
  }
}

await main();
