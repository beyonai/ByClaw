import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AdaptedManagedAgent, AimodelProviderApi } from "./agent-adapter.js";
import type { AgentRegistryState } from "./agent-state.js";
import { getCachedAimodelAuthToken } from "./aimodel-auth-cache.js";
import { decodeBaiyingAimodelSecretRefId } from "./aimodel-config.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

const DEFAULT_CLONE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_GENERATE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_MAX_REPOSITORY_BYTES = 500 * 1024 * 1024;
const DEFAULT_REPOWIKI_COMMAND = "byclaw-repowiki";
const DEFAULT_GIT_COMMAND = "git";
const OUTPUT_DIRECTORY_NAME = "generated-wikis";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type SecretRefLike = {
  id?: unknown;
  source?: unknown;
};

export type CodeToWikiSettings = {
  gitCommand: string;
  repoWikiCommand: string;
  cloneTimeoutMs: number;
  generateTimeoutMs: number;
  maxCommandOutputBytes: number;
  maxRepositoryBytes: number;
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

export type GitCloneCredentials = {
  gitHubToken?: string;
  privateHost?: string;
  privateUsername?: string;
  privateToken?: string;
};

type CodeToWikiToolDeps = {
  registry: AgentRegistryState;
  loadGitCredentials: () => Promise<GitCloneCredentials>;
  resolveWorkspaceDir: (agentId: string) => string;
  settings?: Partial<CodeToWikiSettings>;
  logger?: LoggerLike;
  runProcess?: (request: ProcessRunRequest) => Promise<ProcessRunResult>;
  getModelApiKey?: (modelId: string) => string | null;
  now?: () => Date;
  randomId?: () => string;
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
    repoWikiGitCommand?: unknown;
    repoWikiCloneTimeoutMs?: unknown;
    repoWikiGenerateTimeoutMs?: unknown;
    repoWikiMaxCommandOutputBytes?: unknown;
    repoWikiMaxRepositoryBytes?: unknown;
  } = {},
): CodeToWikiSettings {
  return {
    gitCommand: nonEmptyString(raw.repoWikiGitCommand) || DEFAULT_GIT_COMMAND,
    repoWikiCommand: nonEmptyString(raw.repoWikiCommand) || DEFAULT_REPOWIKI_COMMAND,
    cloneTimeoutMs: positiveInteger(raw.repoWikiCloneTimeoutMs, DEFAULT_CLONE_TIMEOUT_MS),
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
      const appended = appendChunk(
        stdout,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        request.maxOutputBytes,
      );
      stdout = appended.buffer;
      truncated = truncated || appended.truncated;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const appended = appendChunk(
        stderr,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        request.maxOutputBytes,
      );
      stderr = appended.buffer;
      truncated = truncated || appended.truncated;
    });

    child.once("error", (error) => {
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

export type ParsedGitRepository = {
  canonicalUrl: string;
  host: string;
  name: string;
  namespace: string;
};

export function parseGitRepositoryUrl(raw: string): ParsedGitRepository {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CodeToWikiError(
      "INVALID_REPOSITORY_URL",
      "repository_url must be a valid HTTPS Git repository URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CodeToWikiError(
      "INVALID_REPOSITORY_URL",
      "Only credential-free HTTPS Git repository URLs without query strings or fragments are supported.",
    );
  }
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new CodeToWikiError(
      "INVALID_REPOSITORY_URL",
      "repository_url must include a repository path.",
    );
  }
  let decodedSegments: string[];
  try {
    decodedSegments = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new CodeToWikiError(
      "INVALID_REPOSITORY_URL",
      "repository_url contains an invalid encoded path segment.",
    );
  }
  const name = (decodedSegments.at(-1) ?? "").replace(/\.git$/i, "").trim();
  if (!name || name === "." || name === ".." || /[\u0000-\u001f/\\]/u.test(name)) {
    throw new CodeToWikiError(
      "INVALID_REPOSITORY_URL",
      "repository_url contains an invalid repository name.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (url.hostname.toLowerCase() === "github.com" && !url.pathname.toLowerCase().endsWith(".git")) {
    url.pathname = `${url.pathname}.git`;
  }
  return {
    canonicalUrl: url.toString(),
    host: url.host.toLowerCase(),
    namespace: decodedSegments.slice(0, -1).join("/"),
    name,
  };
}

function validateBranch(raw: unknown): string | undefined {
  const branch = nonEmptyString(raw);
  if (!branch) {
    return undefined;
  }
  if (
    branch.length > 255 ||
    /[\u0000-\u0020~^:?*]/u.test(branch) ||
    branch.includes("\\") ||
    branch.includes("[") ||
    branch.includes("]") ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{")
  ) {
    throw new CodeToWikiError("INVALID_BRANCH", "branch is not a valid Git branch name.");
  }
  return branch;
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

export function buildGitCloneEnvironment(
  repository: ParsedGitRepository,
  credentials: GitCloneCredentials = {},
): {
  env: NodeJS.ProcessEnv;
  sensitiveValues: string[];
} {
  const env = {
    ...baseChildEnvironment(),
    GIT_TERMINAL_PROMPT: "0",
  };
  const repositoryUrl = new URL(repository.canonicalUrl);
  const targetHost = repository.host;
  const gitHubToken = credentials.gitHubToken?.trim() ?? "";
  const privateHost = credentials.privateHost?.trim().toLowerCase() ?? "";
  const privateUsername = credentials.privateUsername?.trim() ?? "";
  const privateToken = credentials.privateToken?.trim() ?? "";
  const useGitHubToken = targetHost === "github.com" && Boolean(gitHubToken);
  const useHostCredential =
    privateHost === targetHost && Boolean(privateUsername) && Boolean(privateToken);
  if (!useGitHubToken && !useHostCredential) {
    return { env, sensitiveValues: [] };
  }
  const username = useGitHubToken ? "x-access-token" : privateUsername;
  const token = useGitHubToken ? gitHubToken : privateToken;
  const basicCredential = Buffer.from(`${username}:${token}`, "utf8").toString("base64");
  const credentialScope = `${repositoryUrl.protocol}//${repositoryUrl.host}/`;
  return {
    env: {
      ...env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${credentialScope}.extraheader`,
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicCredential}`,
    },
    sensitiveValues: [token, basicCredential],
  };
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

function buildCloneArgs(repository: ParsedGitRepository, branch?: string): string[] {
  const args = ["clone", "--depth", "1", "--single-branch"];
  if (branch) {
    args.push("--branch", branch);
  }
  args.push("--", repository.canonicalUrl, "repository");
  return args;
}

function outputSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "repository"
  );
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
    repository_url: Type.String({
      description:
        "Public or private Git HTTPS repository URL. Credentials must not be embedded in the URL.",
    }),
    branch: Type.Optional(
      Type.String({
        description: "Optional branch to shallow-clone. The repository default branch is used when omitted.",
      }),
    ),
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
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? randomUUID;

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
        "Generate complete Wiki documentation for a public or private HTTPS Git repository. " +
        "The tool shallow-clones the repository and runs RepoWiki with this digital employee's " +
        "Redis-managed model.",
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
        let runRoot = "";
        let outputDir = "";
        let completed = false;
        try {
          const repository = parseGitRepositoryUrl(nonEmptyString(input.repository_url));
          const branch = validateBranch(input.branch);
          const language = nonEmptyString(input.language) || "zh";
          const outputFormat = nonEmptyString(input.output_format) || "markdown";
          const modelRuntime = resolveRepoWikiModelRuntime(agent, getModelApiKey);
          const gitEnvironment = buildGitCloneEnvironment(
            repository,
            await deps.loadGitCredentials(),
          );

          runRoot = await fs.mkdtemp(path.join(tmpdir(), "byclaw-repowiki-"));
          const repositoryDir = path.join(runRoot, "repository");
          const runtimeDir = path.join(runRoot, "runtime");
          await fs.mkdir(runtimeDir, { recursive: true });

          const timestamp = now().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
          const jobId = outputSegment(randomId()).slice(0, 12);
          outputDir = path.join(
            deps.resolveWorkspaceDir(agentId),
            OUTPUT_DIRECTORY_NAME,
            `${outputSegment(
              [repository.namespace, repository.name].filter(Boolean).join("-"),
            )}-${timestamp}-${jobId}`,
          );
          await fs.mkdir(outputDir, { recursive: true });

          onUpdate?.({
            content: [{ type: "text", text: "code_to_wiki is shallow-cloning the repository." }],
            details: { status: "cloning" },
          });
          const cloneResult = await runProcess({
            command: settings.gitCommand,
            args: buildCloneArgs(repository, branch),
            cwd: runRoot,
            env: gitEnvironment.env,
            timeoutMs: settings.cloneTimeoutMs,
            maxOutputBytes: settings.maxCommandOutputBytes,
            signal,
            sensitiveValues: gitEnvironment.sensitiveValues,
          });
          if (!cloneResult.ok) {
            const authHint =
              gitEnvironment.sensitiveValues.length > 0
                ? ""
                : repository.host === "github.com"
                  ? " Configure the user's GH_TOKEN when this is a private GitHub repository."
                  : ` Configure GIT_HOST, GIT_USERNAME, and GIT_TOKEN for ${
                      repository.host
                    } when this is a private repository.`;
            throw new CodeToWikiError(
              cloneResult.aborted ? "TOOL_ABORTED" : "GIT_CLONE_FAILED",
              `${processFailureMessage("Git shallow clone", cloneResult)}${authHint}`,
            );
          }

          const repositoryBytes = await measureDirectoryBytes(
            repositoryDir,
            settings.maxRepositoryBytes,
          );
          if (repositoryBytes > settings.maxRepositoryBytes) {
            throw new CodeToWikiError(
              "REPOSITORY_TOO_LARGE",
              `The shallow checkout exceeds the ${settings.maxRepositoryBytes}-byte repository limit.`,
            );
          }

          onUpdate?.({
            content: [{ type: "text", text: "code_to_wiki is generating documentation with RepoWiki." }],
            details: { status: "generating" },
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
            cwd: runRoot,
            env: {
              ...baseChildEnvironment(),
              BYCLAW_REPOWIKI_DATA_DIR: runtimeDir,
              REPOWIKI_API_BASE: modelRuntime.apiBase,
              REPOWIKI_API_KEY: modelRuntime.apiKey,
              REPOWIKI_LANG: language,
              REPOWIKI_MODEL: modelRuntime.model,
            },
            timeoutMs: settings.generateTimeoutMs,
            maxOutputBytes: settings.maxCommandOutputBytes,
            signal,
            sensitiveValues: [modelRuntime.apiKey],
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
                url: repository.canonicalUrl,
                branch: branch ?? "default",
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
                cloneDurationMs: cloneResult.durationMs,
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
          if (!completed && outputDir) {
            await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
          }
          if (runRoot) {
            await fs.rm(runRoot, { recursive: true, force: true }).catch(() => undefined);
          }
        }
      },
    };
  };
}
