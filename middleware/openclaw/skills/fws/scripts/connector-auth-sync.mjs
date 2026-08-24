#!/usr/bin/env node

const CONNECTOR_CODE = "lark";
const ENDPOINT_PATH = "connector/authorization/skill-complete";
const REQUEST_TIMEOUT_MS = 75_000;
const PUBLIC_BACKEND_ERROR_CODES = new Set([
  "AUTH_BINDING_FAILED",
  "CONNECTOR_CREDENTIAL_INVALID",
  "CONNECTOR_MANIFEST_INVALID",
  "CONNECTOR_NOT_FOUND",
  "CONNECTOR_VERIFICATION_BUSY",
  "CONNECTOR_VERIFICATION_FAILED",
  "CONNECTOR_VERIFICATION_TIMEOUT",
  "CONNECTOR_VERIFIER_NOT_FOUND",
  "CREDENTIAL_WORKSPACE_UNAVAILABLE",
]);

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

function loadBeyondToken() {
  const token = firstNonEmpty(process.env.BEYOND_TOKEN);
  if (!token) {
    throw new PublicFailure("AUTH_CONTEXT_UNAVAILABLE", false);
  }
  return token;
}

function backendEndpoint() {
  const configured = firstNonEmpty(process.env.BYAI_SERVICE_BASE_URL);
  if (!configured) {
    throw new PublicFailure("BACKEND_SERVICE_UNAVAILABLE", true);
  }
  try {
    const base = new URL(configured);
    if (!["http:", "https:"].includes(base.protocol)
        || base.username
        || base.password
        || base.search
        || base.hash) {
      throw new Error("invalid backend base URL");
    }
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
    return new URL(ENDPOINT_PATH, base);
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
  const endpoint = backendEndpoint();
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
