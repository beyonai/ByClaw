import type { ByclawWikiRepositoryService } from "./repository-service.js";
import type { CodeToWikiRequest, CodegraphToolResult, ResolvedByclawWikiConfig } from "./types.js";
import { sendDocumentationNotification } from "./notification.js";

const codeToWikiParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    repositoryId: {
      type: "string",
      description: "Repository id from byclaw-wiki config. Defaults to byclaw.",
    },
    mode: {
      enum: [
        "explore",
        "query",
        "node",
        "files",
        "callers",
        "callees",
        "impact",
        "status",
        "notify_document",
      ],
      description:
        "CodeGraph operation. Use explore for source questions. Use notify_document after OpenClaw has generated the operation document.",
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
    documentTitle: {
      type: "string",
      description: "Document title for notify_document mode.",
    },
    documentMarkdown: {
      type: "string",
      description: "Generated operation document markdown to send to the configured group robot.",
    },
  },
} as const;

function normalizeRequest(input: Record<string, unknown>): CodeToWikiRequest {
  return {
    repositoryId: typeof input.repositoryId === "string" ? input.repositoryId : undefined,
    mode: typeof input.mode === "string" ? (input.mode as CodeToWikiRequest["mode"]) : "explore",
    question: typeof input.question === "string" ? input.question : undefined,
    query: typeof input.query === "string" ? input.query : undefined,
    target: typeof input.target === "string" ? input.target : undefined,
    symbol: typeof input.symbol === "string" ? input.symbol : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
    maxDepth: typeof input.maxDepth === "number" ? input.maxDepth : undefined,
    filter: typeof input.filter === "string" ? input.filter : undefined,
    documentTitle: typeof input.documentTitle === "string" ? input.documentTitle : undefined,
    documentMarkdown: typeof input.documentMarkdown === "string" ? input.documentMarkdown : undefined,
  };
}

function buildCommandDetails(result: Awaited<ReturnType<ByclawWikiRepositoryService["runCodegraph"]>>) {
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

function buildToolText(params: {
  ok: boolean;
  mode: string;
  repositoryId: string;
  output: string;
  includeRawOutput: boolean;
  notification: { attempted: boolean; ok?: boolean; skippedReason?: string; error?: string };
}): string {
  const outputBytes = Buffer.byteLength(params.output);

  if (params.includeRawOutput) {
    return params.ok
      ? `code_to_wiki ${params.mode} result for ${params.repositoryId}:\n\n${params.output}`
      : `code_to_wiki ${params.mode} failed for ${params.repositoryId}:\n\n${params.output}`;
  }

  return params.ok
    ? `code_to_wiki ${params.mode} completed for ${params.repositoryId}; raw CodeGraph output omitted (${outputBytes} bytes).`
    : `code_to_wiki ${params.mode} failed for ${params.repositoryId}; raw output omitted (${outputBytes} bytes).`;
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
    name: params.config.toolName,
    label: "Code To Wiki",
    description:
      "Inspect the configured GitHub source repositories through CodeGraph before answering code, architecture, API, or implementation questions.",
    parameters: codeToWikiParameters,
    async execute(_toolCallId: string, input: Record<string, unknown>) {
      const request = normalizeRequest(input);
      const mode = request.mode ?? "explore";
      const repository = params.service.getRepository(request.repositoryId);
      if (!repository) {
        return {
          content: [{ type: "text" as const, text: `code_to_wiki failed: unknown repository ${request.repositoryId}.` }],
          details: {
            ok: false,
            mode,
            error: {
              code: "unknown_repository",
              message: `Unknown repository ${request.repositoryId}.`,
            },
          },
        };
      }

      if (mode === "status") {
        const status = params.service.getStatus(repository.id);
        const details: CodegraphToolResult = {
          ok: true,
          repository,
          mode,
          status,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `code_to_wiki status for ${repository.id}: ${status?.state ?? "unknown"}.`,
            },
          ],
          details,
        };
      }

      if (mode === "notify_document") {
        const documentMarkdown = request.documentMarkdown?.trim();
        if (!documentMarkdown) {
          return {
            content: [
              {
                type: "text" as const,
                text: "code_to_wiki notify_document failed: documentMarkdown is required.",
              },
            ],
            details: {
              ok: false,
              repository,
              mode,
              error: {
                code: "invalid_request",
                message: "documentMarkdown is required for notify_document mode.",
              },
            },
          };
        }

        const notification = await sendDocumentationNotification({
          config: params.config.notification,
          repository,
          question: request.question,
          query: request.query,
          documentTitle: request.documentTitle,
          documentMarkdown,
        });
        if (notification.attempted && notification.ok) {
          params.logger?.info(`byclaw-wiki: generated document notification sent for ${repository.id}`);
        } else if (notification.attempted) {
          params.logger?.warn(
            `byclaw-wiki: generated document notification failed for ${repository.id}: ${notification.error ?? notification.statusCode ?? "unknown"}`,
          );
        } else {
          params.logger?.info(
            `byclaw-wiki: generated document notification skipped for ${repository.id}: ${notification.skippedReason ?? "unknown"}`,
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: notification.attempted && notification.ok
                ? `code_to_wiki sent generated document notification for ${repository.id}.`
                : `code_to_wiki did not send generated document notification for ${repository.id}: ${notification.skippedReason ?? notification.error ?? "unknown"}.`,
            },
          ],
          details: {
            ok: Boolean(notification.attempted && notification.ok),
            repository,
            mode,
            notification,
          },
        };
      }

      try {
        const query = request.question ?? request.query;
        const result = await params.service.runCodegraph({
          repositoryId: repository.id,
          mode,
          query,
          target: request.target,
          symbol: request.symbol,
          limit: request.limit,
          maxDepth: request.maxDepth,
          filter: request.filter,
        });
        const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
        const details: CodegraphToolResult = {
          ok: result.ok,
          repository,
          mode,
          output: params.config.includeRawOutputInToolResult ? output : undefined,
          outputBytes: Buffer.byteLength(output),
          outputOmitted: !params.config.includeRawOutputInToolResult,
          status: params.service.getStatus(repository.id),
          command: buildCommandDetails(result),
          error: result.ok
            ? undefined
            : {
                code: result.timedOut ? "timeout" : "codegraph_failed",
                message: output || `CodeGraph ${mode} failed.`,
              },
        };
        return {
          content: [
            {
              type: "text" as const,
              text: buildToolText({
                ok: result.ok,
                mode,
                repositoryId: repository.id,
                output,
                includeRawOutput: params.config.includeRawOutputInToolResult,
                notification: { attempted: false, skippedReason: "lookup_only" },
              }),
            },
          ],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details: CodegraphToolResult = {
          ok: false,
          repository,
          mode,
          status: params.service.getStatus(repository.id),
          error: {
            code: "execution_error",
            message,
          },
        };
        return {
          content: [{ type: "text" as const, text: `code_to_wiki failed: ${message}` }],
          details,
        };
      }
    },
  };
}
