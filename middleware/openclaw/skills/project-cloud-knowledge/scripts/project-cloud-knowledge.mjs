#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const DATASET_CONTROLLER = "datasetController";
const REQUEST_TIMEOUT_MS = 60_000;

const COMMANDS = new Set([
  "list",
  "mkdir",
  "rename-dir",
  "delete-dir",
  "check",
  "upload",
  "download",
  "remove",
  "help",
]);

class PublicFailure extends Error {
  constructor(errorCode, detail = "") {
    super(detail ? `${errorCode}: ${detail}` : errorCode);
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (text) return text;
  }
  return "";
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eqIndex = token.indexOf("=");
    const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    let value = eqIndex >= 0 ? token.slice(eqIndex + 1) : argv[index + 1];
    if (value === undefined || String(value).startsWith("--")) {
      value = true;
    } else if (eqIndex < 0) {
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  }
  return args;
}

function asArray(value) {
  if (value === undefined || value === null || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

function positiveInteger(value, field) {
  if (value === undefined || value === null || value === "" || value === true) {
    throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", field);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", field);
  }
  return parsed;
}

function requiredText(value, field) {
  const text = firstNonEmpty(value);
  if (!text) throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", field);
  return text;
}

function normalizeDirectoryPath(rawPath) {
  const text = firstNonEmpty(rawPath, "/");
  if (text === "/") return "/";
  const trimmed = text.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeFilePath(rawPath) {
  const text = requiredText(rawPath, "file-path");
  const cleaned = text.replace(/\/+/g, "/");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function normalizeBaseUrl(rawBaseUrl) {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith(DEFAULT_CONTEXT_PATH) ? trimmed : `${trimmed}${DEFAULT_CONTEXT_PATH}`;
}

function backendBaseUrl() {
  const explicit = firstNonEmpty(process.env.BYAI_SERVICE_BASE_URL, process.env.KN_MANAGER_URL);
  if (explicit) return normalizeBaseUrl(explicit);
  const host = firstNonEmpty(process.env.HOST, "127.0.0.1");
  if (/^https?:\/\//i.test(host)) return normalizeBaseUrl(host);
  const protocol = firstNonEmpty(process.env.BE_PROTOCOL, "http");
  const port = firstNonEmpty(process.env.BE_SERVER_PORT, "8086");
  const portPart = /:\d+$/.test(host) ? "" : `:${port}`;
  return normalizeBaseUrl(`${protocol}://${host}${portPart}`);
}

function resolveAuth() {
  return {
    beyondToken: firstNonEmpty(
      process.env.BEYOND_TOKEN,
      process.env.BYCLAW_BEYOND_TOKEN,
      process.env.BYCLAW_ECOSYSTEM_BEYOND_TOKEN,
    ),
    userCode: firstNonEmpty(process.env.USER_CODE, process.env.BYCLAW_ECOSYSTEM_USER_CODE),
    sessionId: firstNonEmpty(
      process.env.BAIYING_SESSION,
      process.env.SESSION_ID,
      process.env.BYCLAW_SESSION,
      process.env.BYCLAW_ECOSYSTEM_SESSION,
    ),
  };
}

function signatureHeaders(userCode, bodyText) {
  if (!userCode) return {};
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const salt = firstNonEmpty(
    process.env.BYCLAW_ECOSYSTEM_SIGNATURE_SALT,
    process.env.BYCLAW_SIGNATURE_SALT,
    DEFAULT_SIGNATURE_SALT,
  );
  const signature = crypto
    .createHash("md5")
    .update(`${userCode}${nonce}${timestamp}${bodyText}${salt}`, "utf8")
    .digest("hex");
  return { "x-signature-nonce": nonce, "x-signature-timestamp": timestamp, "x-signature-value": signature };
}

function authHeaders(bodyText = "") {
  const auth = resolveAuth();
  if (!auth.beyondToken && !auth.sessionId) {
    throw new PublicFailure("CLOUD_DISK_AUTH_CONTEXT_UNAVAILABLE");
  }
  const headers = {
    Accept: "application/json",
    ...signatureHeaders(auth.userCode, bodyText),
  };
  if (auth.beyondToken) headers["Beyond-Token"] = auth.beyondToken;
  if (auth.userCode) {
    headers["X-User-Id"] = auth.userCode;
    headers["X-USER-CODE"] = auth.userCode;
  }
  if (auth.sessionId) {
    headers["x-signature-sessionId"] = auth.sessionId;
    headers["X-CHAT-SESSION-ID"] = auth.sessionId;
    headers.Cookie = `SESSION=${auth.sessionId}; PORTAL-SESSION=${auth.sessionId}`;
  }
  return headers;
}

function endpoint(suffix) {
  return `${backendBaseUrl()}/${DATASET_CONTROLLER}/${suffix.replace(/^\/+/, "")}`;
}

async function fetchBackend(url, { method, headers, body, expectJson = true } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublicFailure("CLOUD_DISK_BACKEND_TIMEOUT");
    }
    throw new PublicFailure("CLOUD_DISK_BACKEND_UNREACHABLE");
  }

  if (!expectJson) {
    if (response.status === 401) {
      throw new PublicFailure("CLOUD_DISK_AUTH_REJECTED", "HTTP 401");
    }
    if (!response.ok) {
      const text = await response.text();
      throw new PublicFailure("CLOUD_DISK_BACKEND_HTTP_ERROR", text || `HTTP ${response.status}`);
    }
    return response;
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    throw new PublicFailure("CLOUD_DISK_RESPONSE_INVALID");
  }
  if (response.status === 401) {
    throw new PublicFailure("CLOUD_DISK_AUTH_REJECTED", parsed?.resultMsg || parsed?.msg || "HTTP 401");
  }
  if (!response.ok) {
    throw new PublicFailure("CLOUD_DISK_BACKEND_HTTP_ERROR", parsed?.msg || `HTTP ${response.status}`);
  }
  if (parsed && Object.prototype.hasOwnProperty.call(parsed, "code")
    && ![0, 200, "0", "200"].includes(parsed.code)) {
    const detail = parsed.msg || `code=${parsed.code}`;
    if (/无权|permission|access denied/i.test(detail)) {
      throw new PublicFailure("CLOUD_DISK_ACCESS_DENIED", detail);
    }
    throw new PublicFailure("CLOUD_DISK_BACKEND_REJECTED", detail);
  }
  return parsed && Object.prototype.hasOwnProperty.call(parsed, "data") ? parsed.data : parsed;
}

async function postJson(suffix, payload) {
  const bodyText = JSON.stringify(payload);
  return fetchBackend(endpoint(suffix), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(bodyText),
    },
    body: bodyText,
  });
}

async function listCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const directoryPath = normalizeDirectoryPath(args["directory-path"]);
  const data = await postJson("queryDirAndFileByLevel", {
    resourceId,
    directoryPath,
  });
  const items = (Array.isArray(data) ? data : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: item.name,
      type: item.type,
      fileId: item.fileId,
      fileName: item.fileName,
      directoryPath: item.directoryPath,
      size: item.size,
      createTime: item.createTime,
      createStaffName: item.createStaffName,
    }));
  return { ok: true, action: "list", resourceId, directoryPath, items };
}

async function mkdirCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const directoryPath = normalizeDirectoryPath(args["directory-path"]);
  const directoryName = requiredText(args["directory-name"], "directory-name");
  const directoryDescription = firstNonEmpty(args["directory-description"]);
  const payload = {
    resourceId,
    directoryPath,
    directoryName,
    ...(directoryDescription ? { directoryDescription } : {}),
  };
  const data = await postJson("createFolder", payload);
  return {
    ok: true,
    action: "mkdir",
    resourceId,
    created: data && typeof data === "object"
      ? {
          directoryPath: data.directoryPath,
          directoryName: data.directoryName ?? directoryName,
          directoryDescription: data.directoryDescription ?? (directoryDescription || undefined),
        }
      : { directoryPath, directoryName },
  };
}

async function renameDirCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const directoryPath = normalizeDirectoryPath(args["directory-path"]);
  if (directoryPath === "/") {
    throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", "directory-path must not be root");
  }
  const directoryName = requiredText(args["directory-name"], "directory-name");
  const data = await postJson("renameFolder", {
    resourceId,
    directoryPath,
    directoryName,
  });
  return {
    ok: true,
    action: "rename-dir",
    resourceId,
    renamed: data && typeof data === "object"
      ? {
          directoryPath: data.directoryPath ?? directoryPath,
          directoryName: data.directoryName ?? directoryName,
        }
      : { directoryPath, directoryName },
  };
}

async function deleteDirCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const directoryPath = normalizeDirectoryPath(args["directory-path"]);
  if (directoryPath === "/") {
    throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", "directory-path must not be root");
  }
  await postJson("deleteFolder", {
    resourceId,
    directoryPath,
  });
  return { ok: true, action: "delete-dir", resourceId, directoryPath };
}

async function checkCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const directoryPath = normalizeDirectoryPath(args["directory-path"]);
  const fileNames = asArray(args["file-name"]).map(String).map((name) => name.trim()).filter(Boolean);
  if (fileNames.length === 0) throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", "file-name");
  const data = await postJson("checkUploadFileConflicts", {
    resourceId,
    directoryPath,
    fileNames,
  });
  return { ok: true, action: "check", resourceId, directoryPath, ...normalizeConflict(data) };
}

function normalizeConflict(data) {
  if (!data || typeof data !== "object") {
    return { conflict: false, overwritePaths: [] };
  }
  return {
    conflict: Boolean(data.conflict),
    overwritePaths: Array.isArray(data.overwritePaths) ? data.overwritePaths : [],
  };
}

function collectUploadSources(args) {
  const files = asArray(args.file).map(String).filter(Boolean);
  const text = args.text === true ? "" : (args.text === undefined ? undefined : String(args.text));
  const fileName = firstNonEmpty(args["file-name"]);
  if (files.length > 0 && text !== undefined) {
    throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", "file and text are mutually exclusive");
  }
  if (text !== undefined) {
    if (!fileName) throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", "file-name");
    return [{ kind: "text", fileName, content: text }];
  }
  if (files.length === 0) throw new PublicFailure("CLOUD_DISK_INPUT_INVALID", "file");
  return files.map((filePath) => {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new PublicFailure("CLOUD_DISK_FILE_MISSING", filePath);
    }
    return { kind: "file", filePath: resolved, fileName: path.basename(resolved) };
  });
}

async function uploadCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const directoryPath = normalizeDirectoryPath(args["directory-path"]);
  const sources = collectUploadSources(args);
  const overwrite = args.overwrite === true || String(args.overwrite).toLowerCase() === "true";
  const skipIfDuplicate = args["skip-if-duplicate"] === true
    || String(args["skip-if-duplicate"]).toLowerCase() === "true";
  const checkConflicts = args["check-conflicts"] === true
    || String(args["check-conflicts"]).toLowerCase() === "true";

  if (checkConflicts && !overwrite) {
    const conflict = await postJson("checkUploadFileConflicts", {
      resourceId,
      directoryPath,
      fileNames: sources.map((item) => item.fileName),
    });
    const normalized = normalizeConflict(conflict);
    if (normalized.conflict) {
      return {
        ok: true,
        action: "upload",
        conflict: true,
        needsOverwriteConfirmation: true,
        resourceId,
        directoryPath,
        overwritePaths: normalized.overwritePaths,
      };
    }
  }

  const form = new FormData();
  for (const source of sources) {
    if (source.kind === "text") {
      form.append("files", new Blob([source.content], { type: "text/plain; charset=utf-8" }), source.fileName);
    } else {
      form.append("files", new Blob([fs.readFileSync(source.filePath)]), source.fileName);
    }
  }
  form.append("resourceId", String(resourceId));
  form.append("directoryPath", directoryPath);
  form.append("overwrite", overwrite ? "true" : "false");
  form.append("skipIfDuplicate", skipIfDuplicate ? "true" : "false");
  form.append("processFrontMatter", "false");

  const data = await fetchBackend(endpoint("uploadFiles"), {
    method: "POST",
    headers: authHeaders(""),
    body: form,
  });
  return { ok: true, action: "upload", resourceId, directoryPath, uploaded: data };
}

async function downloadCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const filePath = normalizeFilePath(args["file-path"]);
  const output = path.resolve(requiredText(args.output, "output"));
  const url = new URL(endpoint("download"));
  url.searchParams.set("resourceId", String(resourceId));
  url.searchParams.set("directoryPath", filePath);

  const response = await fetchBackend(url.toString(), {
    method: "GET",
    headers: authHeaders(""),
    expectJson: false,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buffer);
  return {
    ok: true,
    action: "download",
    resourceId,
    filePath,
    output,
    bytes: buffer.length,
    contentType: response.headers.get("content-type") || undefined,
  };
}

async function removeCommand(args) {
  const resourceId = positiveInteger(args["resource-id"], "resource-id");
  const filePath = normalizeFilePath(args["file-path"]);
  await postJson("removeFile", {
    resourceId,
    directoryPath: filePath,
  });
  return { ok: true, action: "remove", resourceId, filePath };
}

function help() {
  return {
    ok: true,
    commands: ["list", "mkdir", "rename-dir", "delete-dir", "check", "upload", "download", "remove"],
    usage: [
      "project-cloud-knowledge.mjs list --resource-id <id> [--directory-path <dir>]",
      "project-cloud-knowledge.mjs mkdir --resource-id <id> --directory-path <parent> --directory-name <name> [--directory-description <desc>]",
      "project-cloud-knowledge.mjs rename-dir --resource-id <id> --directory-path <path> --directory-name <newName>",
      "project-cloud-knowledge.mjs delete-dir --resource-id <id> --directory-path <path>",
      "project-cloud-knowledge.mjs check --resource-id <id> --directory-path <dir> --file-name <name> [--file-name ...]",
      "project-cloud-knowledge.mjs upload --resource-id <id> --directory-path <dir> (--file <path> [...] | --file-name <name> --text <content>) [--overwrite] [--skip-if-duplicate] [--check-conflicts]",
      "project-cloud-knowledge.mjs download --resource-id <id> --file-path <path> --output <local>",
      "project-cloud-knowledge.mjs remove --resource-id <id> --file-path <path>",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  if (command === "help" || args.help === true) return help();
  if (!COMMANDS.has(command)) throw new PublicFailure("CLOUD_DISK_COMMAND_INVALID", command);
  if (!args["resource-id"]) throw new PublicFailure("CLOUD_DISK_RESOURCE_ID_MISSING");

  if (command === "list") return listCommand(args);
  if (command === "mkdir") return mkdirCommand(args);
  if (command === "rename-dir") return renameDirCommand(args);
  if (command === "delete-dir") return deleteDirCommand(args);
  if (command === "check") return checkCommand(args);
  if (command === "upload") return uploadCommand(args);
  if (command === "download") return downloadCommand(args);
  if (command === "remove") return removeCommand(args);
  return help();
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const failure = error instanceof PublicFailure
    ? error
    : new PublicFailure("CLOUD_DISK_FAILED", error instanceof Error ? error.message : String(error));
  process.stdout.write(`${JSON.stringify({ ok: false, errorCode: failure.errorCode, detail: failure.detail })}\n`);
  process.exitCode = 1;
}
