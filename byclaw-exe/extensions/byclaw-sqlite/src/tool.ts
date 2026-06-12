import path from "node:path";
import type { ResolvedByclawSqliteConfig } from "./types.js";
import type { SqliteExecutor } from "./sqlite-executor.js";

const sqlExecuteParameters = {
  type: "object",
  additionalProperties: false,
  required: ["sql"],
  properties: {
    sql: {
      type: "string",
      minLength: 1,
      description: "Single SQL statement to execute.",
    },
    params: {
      anyOf: [
        {
          type: "object",
          additionalProperties: true,
        },
        {
          type: "array",
        },
      ],
    },
    mode: {
      enum: ["auto", "all", "get", "run"],
    },
    maxRows: {
      type: "number",
      minimum: 1,
      description: "Per-request row cap for read queries.",
    },
  },
} as const;

function buildSummary(result: ReturnType<SqliteExecutor["execute"]>): string {
  if (!result.ok) {
    return `sqlExecute failed: ${result.error.message}`;
  }

  if (result.data.mode === "run") {
    return `sqlExecute completed ${result.data.statementType} with ${result.data.changes ?? 0} change(s).`;
  }

  if (result.data.mode === "get") {
    return result.data.row
      ? `sqlExecute returned 1 row for ${result.data.statementType}.`
      : `sqlExecute returned no rows for ${result.data.statementType}.`;
  }

  return `sqlExecute returned ${result.data.rowCount ?? 0} row(s) for ${result.data.statementType}${result.data.truncated ? " (truncated)." : "."}`;
}

export function createSqlExecuteTool(params: {
  config: ResolvedByclawSqliteConfig;
  executor: SqliteExecutor;
}) {
  return {
    name: params.config.toolName,
    label: "SQL Execute",
    description: `Execute SQL against ${path.basename(params.config.dbPath)}.`,
    parameters: sqlExecuteParameters,
    async execute(_toolCallId: string, input: Record<string, unknown>) {
      const result = params.executor.execute(input);
      return {
        content: [
          {
            type: "text" as const,
            text: buildSummary(result),
          },
        ],
        details: result,
      };
    },
  };
}
