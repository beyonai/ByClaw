import { RepositoryError, type ByclawWikiRepositoryService } from "./repository-service.js";
import type {
  CodeToWikiMode,
  CodeToWikiRequest,
  CodeToWikiToolResult,
  CodegraphQueryMode,
  CommandResult,
  ResolvedByclawWikiConfig,
  WikiPage,
} from "./types.js";
import { CODE_TO_WIKI_TOOL_NAME } from "./types.js";

const codegraphModes = ["explore", "query", "node", "files", "callers", "callees", "impact"] as const;
const wikiModes = ["wiki_status", "wiki_generate", "wiki_list", "wiki_read", "wiki_clear_draft"] as const;

const codeToWikiParameters = {
  type: "object",
  additionalProperties: false,
  required: ["repositoryUrl"],
  properties: {
    repositoryUrl: {
      type: "string",
      description: "Git repository URL to clone/cache on demand. HTTPS and SSH-style Git URLs are supported.",
    },
    branch: {
      type: "string",
      description: "Optional branch. When omitted, Git uses the repository default branch.",
    },
    gitDepth: {
      type: "number",
      minimum: 1,
      description: "Optional shallow clone/fetch depth. Defaults to plugin gitDepth, usually 1.",
    },
    credentialRef: {
      type: "string",
      description:
        "Optional environment variable name that contains a Git token for private HTTPS repositories. The token value itself must never be passed.",
    },
    refresh: {
      type: "boolean",
      description: "When true, fetch/pull the cached checkout before analysis or wiki generation.",
      default: false,
    },
    mode: {
      enum: [
        "status",
        "pull",
        "explore",
        "query",
        "node",
        "files",
        "callers",
        "callees",
        "impact",
        "wiki_status",
        "wiki_generate",
        "wiki_list",
        "wiki_read",
        "wiki_clear_draft",
      ],
      description:
        "Operation mode. CodeGraph modes analyze code; wiki_* modes inspect or generate Zread Wiki output.",
      default: "explore",
    },
    question: {
      type: "string",
      description: "Natural-language source question. Used as query when mode is explore.",
    },
    query: {
      type: "string",
      description: "Search or explore query.",
    },
    target: {
      type: "string",
      description: "File path, symbol, or node target for node/callers/callees/impact.",
    },
    symbol: {
      type: "string",
      description: "Symbol name for callers/callees/impact.",
    },
    limit: {
      type: "number",
      minimum: 1,
      description: "Result limit for query mode.",
    },
    maxDepth: {
      type: "number",
      minimum: 1,
      description: "Maximum directory depth for files mode.",
    },
    filter: {
      type: "string",
      description: "File filter for files mode.",
    },
    wikiVersion: {
      type: "string",
      description: "Zread wiki version to inspect. Defaults to current.",
    },
    wikiPage: {
      type: "string",
      description: "Zread wiki page slug or markdown file path for wiki_read.",
    },
    draftAction: {
      enum: ["resume", "clear", "cancel"],
      description: "How wiki_generate handles an existing Zread draft.",
    },
    skipFailed: {
      type: "boolean",
      description: "Pass --skip-failed to zread generate.",
      default: false,
    },
    yes: {
      type: "boolean",
      description:
        "Required true for mutating wiki modes such as wiki_generate and wiki_clear_draft, so the agent only runs them after user intent is clear.",
    },
  },
} as const;

function normalizeRequest(input: Record<string, unknown>): CodeToWikiRequest {
  return {
    repositoryUrl: typeof input.repositoryUrl === "string" ? input.repositoryUrl : "",
    branch: typeof input.branch === "string" ? input.branch : undefined,
    gitDepth: typeof input.gitDepth === "number" ? input.gitDepth : undefined,
    credentialRef: typeof input.credentialRef === "string" ? input.credentialRef : undefined,
    refresh: typeof input.refresh === "boolean" ? input.refresh : undefined,
    mode: typeof input.mode === "string" ? (input.mode as CodeToWikiRequest["mode"]) : "explore",
    question: typeof input.question === "string" ? input.question : undefined,
    query: typeof input.query === "string" ? input.query : undefined,
    target: typeof input.target === "string" ? input.target : undefined,
    symbol: typeof input.symbol === "string" ? input.symbol : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
    maxDepth: typeof input.maxDepth === "number" ? input.maxDepth : undefined,
    filter: typeof input.filter === "string" ? input.filter : undefined,
    wikiVersion: typeof input.wikiVersion === "string" ? input.wikiVersion : undefined,
    wikiPage: typeof input.wikiPage === "string" ? input.wikiPage : undefined,
    draftAction: typeof input.draftAction === "string" ? (input.draftAction as CodeToWikiRequest["draftAction"]) : undefined,
    skipFailed: typeof input.skipFailed === "boolean" ? input.skipFailed : undefined,
    yes: typeof input.yes === "boolean" ? input.yes : undefined,
  };
}

function isCodegraphMode(mode: CodeToWikiMode): mode is CodegraphQueryMode {
  return (codegraphModes as readonly string[]).includes(mode);
}

function buildCommandDetails(result: CommandResult) {
  return {
    ok: result.ok,
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    truncated: result.truncated,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stderrBytes: Buffer.byteLength(result.stderr),
  };
}

function trimJoin(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n\n");
}

function repositoryText(status: { repositoryUrl: string; branch?: string; localPath: string }): string {
  return [
    `Repository: ${status.repositoryUrl}`,
    `Branch: ${status.branch ?? "default"}`,
    `Local checkout path: ${status.localPath}`,
  ].join("\n");
}

function wikiPagesText(pages: WikiPage[]): string {
  if (pages.length === 0) {
    return "No markdown pages found in the selected Zread wiki version.";
  }
  return pages.map((page) => `- ${page.title} (${page.slug}) -> ${page.file}`).join("\n");
}

function buildCodegraphText(params: {
  ok: boolean;
  mode: CodegraphQueryMode;
  repository: { repositoryUrl: string; branch?: string; localPath: string };
  output: string;
  includeRawOutput: boolean;
}): string {
  const header = repositoryText(params.repository);
  const outputBytes = Buffer.byteLength(params.output);
  if (params.includeRawOutput) {
    return params.ok
      ? `code_to_wiki ${params.mode} result:\n\n${header}\n\nCodeGraph output:\n\n${params.output}`
      : `code_to_wiki ${params.mode} failed:\n\n${header}\n\nCodeGraph output:\n\n${params.output}`;
  }
  return params.ok
    ? `code_to_wiki ${params.mode} completed; raw output omitted (${outputBytes} bytes).\n\n${header}`
    : `code_to_wiki ${params.mode} failed; raw output omitted (${outputBytes} bytes).\n\n${header}`;
}

function confirmationError(mode: CodeToWikiMode): { content: Array<{ type: "text"; text: string }>; details: CodeToWikiToolResult } {
  return {
    content: [{
      type: "text",
      text: `code_to_wiki ${mode} requires yes=true because it changes local Zread state or may run a long generation job.`,
    }],
    details: {
      ok: false,
      mode,
      error: {
        code: "confirmation_required",
        message: `${mode} requires yes=true.`,
      },
    },
  };
}

export function createCodeToWikiTool(params: {
  config: ResolvedByclawWikiConfig;
  service: ByclawWikiRepositoryService;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
  };
}) {
  return {
    name: CODE_TO_WIKI_TOOL_NAME,
    label: "Code To Wiki",
    description:
      "Clone/cache a requested Git repository, index it with CodeGraph for fast code analysis, and optionally generate/read Zread Wiki output. Upload, review, notification, and publishing are handled by separate skills.",
    parameters: codeToWikiParameters,
    async execute(_toolCallId: string, input: Record<string, unknown>) {
      const request = normalizeRequest(input);
      const mode = request.mode ?? "explore";

      try {
        if (mode === "status") {
          const status = await params.service.getStatus(request);
          const details: CodeToWikiToolResult = {
            ok: true,
            mode,
            repository: {
              repositoryUrl: status.repositoryUrl,
              branch: status.branch,
              localPath: status.localPath,
            },
            status,
          };
          return {
            content: [{
              type: "text" as const,
              text: `code_to_wiki status:\n\n${repositoryText(details.repository!)}\nState: ${status.state}\nCodeGraph indexed: ${status.codegraphIndexed}\nZread wiki exists: ${status.zreadWikiExists}`,
            }],
            details,
          };
        }

        if (mode === "pull") {
          const status = await params.service.prepare(request, { refresh: true });
          const details: CodeToWikiToolResult = {
            ok: true,
            mode,
            repository: {
              repositoryUrl: status.repositoryUrl,
              branch: status.branch,
              localPath: status.localPath,
            },
            status,
          };
          return {
            content: [{
              type: "text" as const,
              text: `code_to_wiki pull completed:\n\n${repositoryText(details.repository!)}\nCommit: ${status.lastCommit ?? "unknown"}`,
            }],
            details,
          };
        }

        if (isCodegraphMode(mode)) {
          const result = await params.service.runCodegraph(request, {
            mode,
            refresh: request.refresh,
            query: request.question ?? request.query,
            target: request.target,
            symbol: request.symbol,
            limit: request.limit,
            maxDepth: request.maxDepth,
            filter: request.filter,
          });
          const output = trimJoin(result.stdout, result.stderr);
          const status = await params.service.getStatus(request);
          const repository = {
            repositoryUrl: status.repositoryUrl,
            branch: status.branch,
            localPath: status.localPath,
          };
          const details: CodeToWikiToolResult = {
            ok: result.ok,
            mode,
            repository,
            output: params.config.includeRawOutputInToolResult ? output : undefined,
            outputBytes: Buffer.byteLength(output),
            outputOmitted: !params.config.includeRawOutputInToolResult,
            status,
            command: buildCommandDetails(result),
            error: result.ok
              ? undefined
              : {
                  code: result.timedOut ? "timeout" : "codegraph_failed",
                  message: output || `CodeGraph ${mode} failed.`,
                },
          };
          return {
            content: [{
              type: "text" as const,
              text: buildCodegraphText({
                ok: result.ok,
                mode,
                repository,
                output,
                includeRawOutput: params.config.includeRawOutputInToolResult,
              }),
            }],
            details,
          };
        }

        if (!(wikiModes as readonly string[]).includes(mode)) {
          throw new RepositoryError("INVALID_REQUEST", `Unsupported mode: ${mode}`);
        }

        if (mode === "wiki_status") {
          const { status, zread } = await params.service.getZreadStatus(request);
          const repository = {
            repositoryUrl: status.repositoryUrl,
            branch: status.branch,
            localPath: status.localPath,
          };
          return {
            content: [{
              type: "text" as const,
              text: [
                "code_to_wiki wiki_status:",
                "",
                repositoryText(repository),
                `Zread installed: ${zread.installed}`,
                `Zread version: ${zread.version ?? "unknown"}`,
                `Login/config available: ${zread.hasLogin || zread.hasConfig}`,
                `Zread home: ${zread.homePath}`,
                `Zread config: ${zread.configPath}`,
                `Model source: ${zread.modelSource}`,
                `Model: ${zread.modelProvider && zread.modelName ? `${zread.modelProvider}/${zread.modelName}` : "not configured"}`,
                zread.modelConfigError ? `Model config error: ${zread.modelConfigError}` : undefined,
                `Current wiki: ${zread.hasCurrentWiki}`,
                `Draft exists: ${zread.hasDraft}`,
                `Page count: ${zread.pageCount}`,
              ].filter(Boolean).join("\n"),
            }],
            details: {
              ok: true,
              mode,
              repository,
              status,
              zread,
            } satisfies CodeToWikiToolResult,
          };
        }

        if (mode === "wiki_generate") {
          if (request.yes !== true) {
            return confirmationError(mode);
          }
          const { status, zread, command } = await params.service.generateWiki(request, {
            draftAction: request.draftAction,
            skipFailed: request.skipFailed,
          });
          const output = trimJoin(command.stdout, command.stderr);
          const repository = {
            repositoryUrl: status.repositoryUrl,
            branch: status.branch,
            localPath: status.localPath,
          };
          return {
            content: [{
              type: "text" as const,
              text: [
                "code_to_wiki wiki_generate completed:",
                "",
                repositoryText(repository),
                `Current wiki version: ${zread.currentVersion ?? "current"}`,
                `Page count: ${zread.pageCount}`,
                params.config.includeRawOutputInToolResult && output ? `Zread output:\n\n${output}` : undefined,
              ].filter(Boolean).join("\n"),
            }],
            details: {
              ok: true,
              mode,
              repository,
              output: params.config.includeRawOutputInToolResult ? output : undefined,
              outputBytes: Buffer.byteLength(output),
              outputOmitted: !params.config.includeRawOutputInToolResult,
              status,
              zread,
              command: buildCommandDetails(command),
            } satisfies CodeToWikiToolResult,
          };
        }

        if (mode === "wiki_list") {
          const listed = await params.service.listWiki(request, request.wikiVersion ?? "current");
          const repository = {
            repositoryUrl: listed.status.repositoryUrl,
            branch: listed.status.branch,
            localPath: listed.status.localPath,
          };
          return {
            content: [{
              type: "text" as const,
              text: [
                `code_to_wiki wiki_list (${listed.version}):`,
                "",
                repositoryText(repository),
                "",
                wikiPagesText(listed.pages),
              ].join("\n"),
            }],
            details: {
              ok: true,
              mode,
              repository,
              status: listed.status,
              wiki: {
                version: listed.version,
                rootPath: listed.rootPath,
                pages: listed.pages,
              },
            } satisfies CodeToWikiToolResult,
          };
        }

        if (mode === "wiki_read") {
          const read = await params.service.readWikiPage(request, request.wikiVersion ?? "current", request.wikiPage ?? "");
          const repository = {
            repositoryUrl: read.status.repositoryUrl,
            branch: read.status.branch,
            localPath: read.status.localPath,
          };
          return {
            content: [{
              type: "text" as const,
              text: [
                `code_to_wiki wiki_read (${read.version}/${read.page.slug}):`,
                "",
                repositoryText(repository),
                "",
                read.page.markdown ?? "",
              ].join("\n"),
            }],
            details: {
              ok: true,
              mode,
              repository,
              status: read.status,
              wiki: {
                version: read.version,
                rootPath: read.rootPath,
                page: read.page,
              },
            } satisfies CodeToWikiToolResult,
          };
        }

        if (mode === "wiki_clear_draft") {
          if (request.yes !== true) {
            return confirmationError(mode);
          }
          const { status, zread } = await params.service.clearWikiDraft(request);
          const repository = {
            repositoryUrl: status.repositoryUrl,
            branch: status.branch,
            localPath: status.localPath,
          };
          return {
            content: [{
              type: "text" as const,
              text: `code_to_wiki wiki_clear_draft completed:\n\n${repositoryText(repository)}\nDraft exists: ${zread.hasDraft}`,
            }],
            details: {
              ok: true,
              mode,
              repository,
              status,
              zread,
            } satisfies CodeToWikiToolResult,
          };
        }

        throw new RepositoryError("INVALID_REQUEST", `Unsupported mode: ${mode}`);
      } catch (error) {
        const repositoryError = error instanceof RepositoryError;
        const message = error instanceof Error ? error.message : String(error);
        params.logger?.warn(`byclaw-wiki: code_to_wiki ${mode} failed: ${message}`);
        const details: CodeToWikiToolResult = {
          ok: false,
          mode,
          error: {
            code: repositoryError ? error.code.toLowerCase() : "execution_error",
            message,
          },
        };
        return {
          content: [{ type: "text" as const, text: `code_to_wiki ${mode} failed: ${message}` }],
          details,
        };
      }
    },
  };
}
