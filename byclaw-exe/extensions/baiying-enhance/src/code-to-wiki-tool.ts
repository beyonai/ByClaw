import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Type } from "@sinclair/typebox";
import type { AdaptedManagedAgent, AimodelProviderApi } from "./agent-adapter.js";
import type { AgentRegistryState } from "./agent-state.js";
import { getCachedAimodelAuthToken } from "./aimodel-auth-cache.js";
import { decodeBaiyingAimodelSecretRefId } from "./aimodel-config.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

const DEFAULT_GENERATE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_MAX_REPOSITORY_BYTES = 500 * 1024 * 1024;
const DEFAULT_REPOWIKI_COMMAND = "byclaw-repowiki";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type SecretRefLike = {
  id?: unknown;
  source?: unknown;
};

export type CodeToWikiSettings = {
  repoWikiCommand: string;
  generateTimeoutMs: number;
  maxCommandOutputBytes: number;
  maxRepositoryBytes: number;
};

export type ProcessOutputLine = {
  stream: "stdout" | "stderr";
  line: string;
};

export type ProcessRunRequest = {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  sensitiveValues?: string[];
  onOutputLine?: (output: ProcessOutputLine) => void;
};

export type ProcessRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
};

type OutputFile = {
  path: string;
  size: number;
};

type RepoWikiModelRuntime = {
  apiBase: string;
  apiKey: string;
  model: string;
  modelRef: string;
};

type CodeToWikiToolDeps = {
  registry: AgentRegistryState;
  resolveWorkspaceDir: (agentId: string) => string;
  settings?: Partial<CodeToWikiSettings>;
  logger?: LoggerLike;
  runProcess?: (request: ProcessRunRequest) => Promise<ProcessRunResult>;
  getModelApiKey?: (modelId: string) => string | null;
};

class CodeToWikiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodeToWikiError";
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : fallback;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function resolveCodeToWikiSettings(
  raw: {
    repoWikiCommand?: unknown;
    repoWikiGenerateTimeoutMs?: unknown;
    repoWikiMaxCommandOutputBytes?: unknown;
    repoWikiMaxRepositoryBytes?: unknown;
  } = {},
): CodeToWikiSettings {
  return {
    repoWikiCommand: nonEmptyString(raw.repoWikiCommand) || DEFAULT_REPOWIKI_COMMAND,
    generateTimeoutMs: positiveInteger(raw.repoWikiGenerateTimeoutMs, DEFAULT_GENERATE_TIMEOUT_MS),
    maxCommandOutputBytes: positiveInteger(
      raw.repoWikiMaxCommandOutputBytes,
      DEFAULT_MAX_COMMAND_OUTPUT_BYTES,
    ),
    maxRepositoryBytes: positiveInteger(
      raw.repoWikiMaxRepositoryBytes,
      DEFAULT_MAX_REPOSITORY_BYTES,
    ),
  };
}

function appendChunk(
  current: Buffer,
  chunk: Buffer,
  maxBytes: number,
): { buffer: Buffer; truncated: boolean } {
  if (current.byteLength >= maxBytes) {
    return { buffer: current, truncated: true };
  }
  const available = maxBytes - current.byteLength;
  if (chunk.byteLength <= available) {
    return { buffer: Buffer.concat([current, chunk]), truncated: false };
  }
  return {
    buffer: Buffer.concat([current, chunk.subarray(0, available)]),
    truncated: true,
  };
}

function redactText(value: string, sensitiveValues: string[] | undefined): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues ?? []) {
    if (sensitiveValue) {
      redacted = redacted.split(sensitiveValue).join("***");
    }
  }
  return redacted;
}

export async function runCodeToWikiProcess(
  request: ProcessRunRequest,
): Promise<ProcessRunResult> {
  const startedAt = Date.now();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let truncated = false;
  let timedOut = false;
  let aborted = request.signal?.aborted === true;

  if (aborted) {
    return {
      ok: false,
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdout: "",
      stderr: "Tool call aborted before process start.",
      timedOut: false,
      aborted: true,
      truncated: false,
    };
  }

  return await new Promise((resolve) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let progressFlushed = false;
    const progressDecoders = {
      stdout: new StringDecoder("utf8"),
      stderr: new StringDecoder("utf8"),
    };
    const progressPending = { stdout: "", stderr: "" };

    const emitOutputLine = (stream: ProcessOutputLine["stream"], rawLine: string) => {
      const line = redactText(rawLine, request.sensitiveValues).trim();
      if (!line || !request.onOutputLine) {
        return;
      }
      try {
        request.onOutputLine({ stream, line });
      } catch {
        // Progress listeners must not interrupt the managed process.
      }
    };

    const consumeProgress = (stream: ProcessOutputLine["stream"], value: string) => {
      const lines = `${progressPending[stream]}${value}`.split(/\r\n|\n|\r/u);
      progressPending[stream] = lines.pop() ?? "";
      for (const line of lines) {
        emitOutputLine(stream, line);
      }
      if (Buffer.byteLength(progressPending[stream], "utf8") > request.maxOutputBytes) {
        emitOutputLine(stream, progressPending[stream]);
        progressPending[stream] = "";
      }
    };

    const flushProgress = () => {
      if (progressFlushed) {
        return;
      }
      progressFlushed = true;
      for (const stream of ["stdout", "stderr"] as const) {
        consumeProgress(stream, progressDecoders[stream].end());
        emitOutputLine(stream, progressPending[stream]);
        progressPending[stream] = "";
      }
    };

    const stop = () => {
      if (child.exitCode !== null || child.killed) {
        return;
      }
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 5000);
      forceKillTimer.unref();
    };

    const onAbort = () => {
      aborted = true;
      stop();
    };

    const finish = (result: ProcessRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      request.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stop();
    }, request.timeoutMs);
    timeoutTimer.unref();
    request.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const appended = appendChunk(
        stdout,
        bytes,
        request.maxOutputBytes,
      );
      stdout = appended.buffer;
      truncated = truncated || appended.truncated;
      consumeProgress("stdout", progressDecoders.stdout.write(bytes));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const appended = appendChunk(
        stderr,
        bytes,
        request.maxOutputBytes,
      );
      stderr = appended.buffer;
      truncated = truncated || appended.truncated;
      consumeProgress("stderr", progressDecoders.stderr.write(bytes));
    });

    child.once("error", (error) => {
      flushProgress();
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        stdout: redactText(stdout.toString("utf8"), request.sensitiveValues),
        stderr: redactText(error.message, request.sensitiveValues),
        timedOut,
        aborted,
        truncated,
      });
    });
    child.once("close", (exitCode, processSignal) => {
      flushProgress();
      finish({
        ok: exitCode === 0 && !timedOut && !aborted,
        exitCode,
        signal: processSignal,
        durationMs: Date.now() - startedAt,
        stdout: redactText(stdout.toString("utf8"), request.sensitiveValues),
        stderr: redactText(stderr.toString("utf8"), request.sensitiveValues),
        timedOut,
        aborted,
        truncated,
      });
    });
  });
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function workspaceCandidate(workspaceRoot: string, raw: unknown, fieldName: string): string {
  const value = nonEmptyString(raw);
  if (!value) {
    throw new CodeToWikiError(
      `${fieldName.toUpperCase()}_REQUIRED`,
      `${fieldName} must be a non-empty workspace-relative or workspace-contained absolute path.`,
    );
  }
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot, value);
  if (!isPathInside(workspaceRoot, candidate)) {
    throw new CodeToWikiError(
      "PATH_OUTSIDE_WORKSPACE",
      `${fieldName} must stay inside the current digital employee workspace.`,
    );
  }
  return candidate;
}

async function resolveWorkspaceRoot(raw: string): Promise<string> {
  const workspaceRoot = path.resolve(raw);
  await fs.mkdir(workspaceRoot, { recursive: true });
  return await fs.realpath(workspaceRoot);
}

async function resolveRepositoryDirectory(
  workspaceRoot: string,
  raw: unknown,
): Promise<string> {
  const candidate = workspaceCandidate(workspaceRoot, raw, "repository_path");
  let repositoryPath: string;
  try {
    repositoryPath = await fs.realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new CodeToWikiError(
        "REPOSITORY_NOT_FOUND",
        `repository_path does not exist: ${candidate}`,
      );
    }
    throw error;
  }
  if (!isPathInside(workspaceRoot, repositoryPath)) {
    throw new CodeToWikiError(
      "PATH_OUTSIDE_WORKSPACE",
      "repository_path resolves outside the current digital employee workspace.",
    );
  }
  if (!(await fs.stat(repositoryPath)).isDirectory()) {
    throw new CodeToWikiError(
      "REPOSITORY_NOT_DIRECTORY",
      `repository_path is not a directory: ${repositoryPath}`,
    );
  }
  return repositoryPath;
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await fs.lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new CodeToWikiError("OUTPUT_DIRECTORY_INVALID", "No valid output directory parent exists.");
    }
    current = parent;
  }
}

async function resolveOutputDirectory(
  workspaceRoot: string,
  raw: unknown,
): Promise<{ directory: string; created: boolean }> {
  const candidate = workspaceCandidate(workspaceRoot, raw, "output_directory");
  if (candidate === workspaceRoot) {
    throw new CodeToWikiError(
      "OUTPUT_DIRECTORY_INVALID",
      "output_directory must be a child directory of the current digital employee workspace.",
    );
  }

  const ancestor = await nearestExistingAncestor(candidate);
  const resolvedAncestor = await fs.realpath(ancestor);
  if (!isPathInside(workspaceRoot, resolvedAncestor)) {
    throw new CodeToWikiError(
      "PATH_OUTSIDE_WORKSPACE",
      "output_directory resolves outside the current digital employee workspace.",
    );
  }

  let created = false;
  try {
    const existing = await fs.stat(candidate);
    if (!existing.isDirectory()) {
      throw new CodeToWikiError(
        "OUTPUT_DIRECTORY_INVALID",
        `output_directory is not a directory: ${candidate}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
    await fs.mkdir(candidate, { recursive: true });
    created = true;
  }

  const directory = await fs.realpath(candidate);
  if (!isPathInside(workspaceRoot, directory)) {
    if (created) {
      await fs.rm(candidate, { recursive: true, force: true }).catch(() => undefined);
    }
    throw new CodeToWikiError(
      "PATH_OUTSIDE_WORKSPACE",
      "output_directory resolves outside the current digital employee workspace.",
    );
  }
  return { directory, created };
}

function baseChildEnvironment(): NodeJS.ProcessEnv {
  const allowedNames = [
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowedNames) {
    const value = process.env[name];
    if (value) {
      env[name] = value;
    }
  }
  return env;
}

function resolveSecretModelId(agent: AdaptedManagedAgent): string {
  const apiKey = agent.provider?.apiKey;
  if (apiKey && typeof apiKey === "object") {
    const ref = apiKey as SecretRefLike;
    if (ref.source === "exec" && typeof ref.id === "string") {
      return decodeBaiyingAimodelSecretRefId(ref.id).trim();
    }
  }
  return agent.baiyingModelId?.trim() ?? "";
}

function liteLlmModelName(api: AimodelProviderApi, modelId: string): string {
  const prefix = api === "anthropic-messages" ? "anthropic" : "openai";
  const normalized = modelId.startsWith(`${prefix}/`)
    ? modelId.slice(prefix.length + 1)
    : modelId;
  return `${prefix}/${normalized}`;
}

export function resolveRepoWikiModelRuntime(
  agent: AdaptedManagedAgent,
  getModelApiKey: (modelId: string) => string | null = getCachedAimodelAuthToken,
): RepoWikiModelRuntime {
  const provider = agent.provider;
  const modelId = provider?.modelId?.trim() ?? "";
  const apiBase = provider?.baseUrl?.trim() ?? "";
  if (!provider || !modelId || !apiBase) {
    throw new CodeToWikiError(
      "MODEL_CONFIG_UNAVAILABLE",
      "The current digital employee does not have a usable Redis-backed model configuration.",
    );
  }
  const secretModelId = resolveSecretModelId(agent);
  const inlineApiKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
  const apiKey =
    (inlineApiKey && inlineApiKey !== "secretref-managed" ? inlineApiKey : "") ||
    (secretModelId ? getModelApiKey(secretModelId)?.trim() ?? "" : "");
  if (!apiKey) {
    throw new CodeToWikiError(
      "MODEL_API_KEY_UNAVAILABLE",
      "The current digital employee model API key is unavailable from Redis.",
    );
  }
  return {
    apiBase,
    apiKey,
    model: liteLlmModelName(provider.api, modelId),
    modelRef: agent.modelRef || `${agent.providerKey}/${modelId}`,
  };
}

async function measureDirectoryBytes(root: string, limit: number): Promise<number> {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        total += (await fs.stat(entryPath)).size;
        if (total > limit) {
          return total;
        }
      }
    }
  }
  return total;
}

async function listOutputFiles(root: string): Promise<OutputFile[]> {
  const files: OutputFile[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push({
          path: path.relative(root, entryPath).split(path.sep).join("/"),
          size: (await fs.stat(entryPath)).size,
        });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function processFailureMessage(label: string, result: ProcessRunResult): string {
  if (result.aborted) {
    return `${label} was cancelled.`;
  }
  if (result.timedOut) {
    return `${label} timed out.`;
  }
  const output = result.stderr.trim() || result.stdout.trim();
  return output ? `${label} failed: ${output}` : `${label} failed with exit code ${result.exitCode}.`;
}

function toolErrorResult(error: unknown) {
  const code = error instanceof CodeToWikiError ? error.code : "CODE_TO_WIKI_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `code_to_wiki failed: ${message}` }],
    details: {
      ok: false,
      error: { code, message },
    },
  };
}

const toolParameters = Type.Object(
  {
    repository_path: Type.String({
      description:
        "Existing repository directory. Use a path relative to the current digital employee workspace, " +
        "or an absolute path contained by that workspace. Clone or update the repository with a Git tool first.",
    }),
    output_directory: Type.String({
      description:
        "Directory where RepoWiki writes documentation. Use a workspace-relative path or a workspace-contained " +
        "absolute path. Existing directories are reused and are never deleted by this tool.",
    }),
    language: Type.Optional(
      Type.Union(
        [Type.Literal("en"), Type.Literal("zh"), Type.Literal("ja"), Type.Literal("ko")],
        { description: "Wiki output language. Defaults to zh." },
      ),
    ),
    output_format: Type.Optional(
      Type.Union(
        [Type.Literal("markdown"), Type.Literal("json"), Type.Literal("html")],
        { description: "RepoWiki output format. Defaults to markdown." },
      ),
    ),
  },
  { additionalProperties: false },
);

export function createCodeToWikiToolFactory(deps: CodeToWikiToolDeps): (ctx: any) => any {
  const settings = { ...resolveCodeToWikiSettings(), ...deps.settings };
  const runProcess = deps.runProcess ?? runCodeToWikiProcess;
  const getModelApiKey = deps.getModelApiKey ?? getCachedAimodelAuthToken;

  return (ctx: any) => {
    const agentId = nonEmptyString(ctx?.agentId);
    if (!agentId.startsWith(MANAGED_AGENT_PREFIX)) {
      return null;
    }
    const agent = deps.registry.get(agentId);
    if (!agent) {
      return null;
    }

    return {
      name: "code_to_wiki",
      label: "Code To Wiki",
      description:
        "Generate Wiki documentation from an existing repository in this digital employee's workspace. " +
        "Clone or update source code separately with a Git tool. This tool runs RepoWiki with the current " +
        "digital employee's Redis-managed model and streams RepoWiki progress.",
      parameters: toolParameters,
      async execute(
        _toolCallId: string,
        input: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: (partial: {
          content: Array<{ type: "text"; text: string }>;
          details?: Record<string, unknown>;
        }) => void,
      ) {
        let runtimeRoot = "";
        let outputDir = "";
        let outputDirectoryCreated = false;
        let completed = false;
        try {
          const language = nonEmptyString(input.language) || "zh";
          const outputFormat = nonEmptyString(input.output_format) || "markdown";
          const modelRuntime = resolveRepoWikiModelRuntime(agent, getModelApiKey);
          const workspaceRoot = await resolveWorkspaceRoot(deps.resolveWorkspaceDir(agentId));
          const repositoryDir = await resolveRepositoryDirectory(
            workspaceRoot,
            input.repository_path,
          );

          const repositoryBytes = await measureDirectoryBytes(
            repositoryDir,
            settings.maxRepositoryBytes,
          );
          if (repositoryBytes > settings.maxRepositoryBytes) {
            throw new CodeToWikiError(
              "REPOSITORY_TOO_LARGE",
              `repository_path exceeds the ${settings.maxRepositoryBytes}-byte repository limit.`,
            );
          }

          const resolvedOutput = await resolveOutputDirectory(
            workspaceRoot,
            input.output_directory,
          );
          outputDir = resolvedOutput.directory;
          outputDirectoryCreated = resolvedOutput.created;
          runtimeRoot = await fs.mkdtemp(path.join(tmpdir(), "byclaw-repowiki-"));

          onUpdate?.({
            content: [
              {
                type: "text",
                text: [
                  "code_to_wiki is starting RepoWiki with an existing repository.",
                  `Repository: ${repositoryDir}`,
                  `Output directory: ${outputDir}`,
                ].join("\n"),
              },
            ],
            details: {
              status: "preparing",
              repositoryPath: repositoryDir,
              outputDirectory: outputDir,
            },
          });
          const repoWikiResult = await runProcess({
            command: settings.repoWikiCommand,
            args: [
              "scan",
              repositoryDir,
              "--output",
              outputDir,
              "--format",
              outputFormat,
              "--lang",
              language,
            ],
            cwd: workspaceRoot,
            env: {
              ...baseChildEnvironment(),
              BYCLAW_REPOWIKI_DATA_DIR: runtimeRoot,
              REPOWIKI_API_BASE: modelRuntime.apiBase,
              REPOWIKI_API_KEY: modelRuntime.apiKey,
              REPOWIKI_LANG: language,
              REPOWIKI_MODEL: modelRuntime.model,
            },
            timeoutMs: settings.generateTimeoutMs,
            maxOutputBytes: settings.maxCommandOutputBytes,
            signal,
            sensitiveValues: [modelRuntime.apiKey],
            onOutputLine: ({ stream, line }) => {
              onUpdate?.({
                content: [{ type: "text", text: `RepoWiki: ${line}` }],
                details: {
                  status: "generating",
                  stream,
                  message: line,
                  repositoryPath: repositoryDir,
                  outputDirectory: outputDir,
                },
              });
            },
          });
          if (!repoWikiResult.ok) {
            throw new CodeToWikiError(
              repoWikiResult.aborted ? "TOOL_ABORTED" : "REPOWIKI_FAILED",
              processFailureMessage("RepoWiki generation", repoWikiResult),
            );
          }
          const combinedOutput = `${repoWikiResult.stdout}\n${repoWikiResult.stderr}`;
          if (/\[LLM Error:|LLM (?:call|stream) failed/iu.test(combinedOutput)) {
            throw new CodeToWikiError(
              "REPOWIKI_LLM_FAILED",
              "RepoWiki reported an LLM failure and did not produce trustworthy documentation.",
            );
          }

          const files = await listOutputFiles(outputDir);
          if (files.length === 0 || files.every((file) => file.size === 0)) {
            throw new CodeToWikiError(
              "REPOWIKI_OUTPUT_MISSING",
              "RepoWiki completed without producing documentation files.",
            );
          }

          completed = true;
          deps.logger?.info?.(
            `baiying-enhance: code_to_wiki completed agent=${agentId} files=${files.length}`,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `code_to_wiki generated ${files.length} documentation file(s).`,
                  `Output directory: ${outputDir}`,
                  `Files: ${files.map((file) => file.path).join(", ")}`,
                ].join("\n"),
              },
            ],
            details: {
              ok: true,
              repository: {
                path: repositoryDir,
              },
              output: {
                directory: outputDir,
                format: outputFormat,
                language,
                files,
              },
              model: {
                ref: modelRuntime.modelRef,
              },
              metrics: {
                generateDurationMs: repoWikiResult.durationMs,
                repositoryBytes,
              },
            },
          };
        } catch (error) {
          deps.logger?.warn?.(
            `baiying-enhance: code_to_wiki failed agent=${agentId} code=${
              error instanceof CodeToWikiError ? error.code : "CODE_TO_WIKI_FAILED"
            }`,
          );
          return toolErrorResult(error);
        } finally {
          if (!completed && outputDirectoryCreated && outputDir) {
            await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
          }
          if (runtimeRoot) {
            await fs.rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
          }
        }
      },
    };
  };
}
