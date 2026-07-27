import type {
  ArtifactRef,
  Delegation,
  Run,
} from "@byclaw/by-conductor";

/** 创建 Run 后返回的轻量响应。 */
export function runResponse(run: Run) {
  return {
    sessionId: run.sessionId,
    runId: run.id,
    status: run.status,
    thinkingLevel: run.thinkingLevel ?? "off",
    eventsUrl: `/v1/runs/${run.id}/events`,
  };
}

function publicRun(run: Run) {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    status: run.status,
    thinkingLevel: run.thinkingLevel ?? "off",
    ...(run.finalAnswer ? { finalAnswer: run.finalAnswer } : {}),
    ...(run.error ? { error: run.error } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
  };
}

/** 单个 Delegation output 的对外字符上限，超出按 truncated 标记截断。 */
const MAX_DELEGATION_OUTPUT_CHARS = 20_000;
/** 单个 Delegation 对外返回的产物条数上限，总数仍通过 artifactCount 透出。 */
const MAX_DELEGATION_ARTIFACTS = 50;

/** Run 详情在 publicRun 基础上追加按创建顺序排列的对外 Delegation DTO。 */
export function runDetailsResponse(run: Run, delegations: Delegation[]) {
  return {
    ...publicRun(run),
    delegations: delegations
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(publicDelegation),
  };
}

/** 把内部 Delegation 映射为不含传输细节的对外 DTO。 */
function publicDelegation(delegation: Delegation) {
  const fullOutput = delegation.result?.output ?? delegation.partialOutput ?? "";
  const outputTruncated = fullOutput.length > MAX_DELEGATION_OUTPUT_CHARS;
  const artifacts = delegation.result?.artifacts ?? [];
  return {
    delegationId: delegation.id,
    agentId: delegation.agentId,
    ...(delegation.agentName ? { agentName: delegation.agentName } : {}),
    status: delegation.status,
    output: outputTruncated
      ? fullOutput.slice(0, MAX_DELEGATION_OUTPUT_CHARS)
      : fullOutput,
    truncated: outputTruncated,
    artifactCount: artifacts.length,
    artifacts: artifacts.slice(0, MAX_DELEGATION_ARTIFACTS).map(publicArtifact),
    ...(delegation.startedAt ? { startedAt: delegation.startedAt } : {}),
    ...(delegation.finishedAt ? { finishedAt: delegation.finishedAt } : {}),
  };
}

/** ArtifactRef 只对外暴露名称、URI、MIME 等公开字段。 */
function publicArtifact(artifact: ArtifactRef) {
  return {
    id: artifact.id,
    uri: artifact.uri,
    ...(artifact.name ? { name: artifact.name } : {}),
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
  };
}

/** 将 Run 列表映射为前端使用的 user/assistant 消息序列。 */
export function sessionMessagesResponse(
  sessionId: string,
  page: { runs: Run[]; hasMore: boolean },
) {
  const items = page.runs.flatMap((run) => {
    const common = {
      runId: run.id,
      runStatus: run.status,
    };
    const userMessage = {
      ...common,
      id: `${run.id}:user`,
      role: "user" as const,
      content: run.input,
      createdAt: run.createdAt,
      ...(run.error ? { error: run.error } : {}),
    };
    if (run.finalAnswer === undefined) {
      return [userMessage];
    }
    return [
      userMessage,
      {
        ...common,
        id: `${run.id}:assistant`,
        role: "assistant" as const,
        content: run.finalAnswer,
        createdAt: run.finishedAt ?? run.updatedAt,
      },
    ];
  });
  const oldest = page.runs[0];
  return {
    sessionId,
    items,
    nextCursor:
      page.hasMore && oldest
        ? encodeRunCursor({ createdAt: oldest.createdAt, runId: oldest.id })
        : null,
  };
}

function encodeRunCursor(cursor: { createdAt: number; runId: string }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** 解析不透明分页游标，非法输入保持原有请求错误语义。 */
export function decodeRunCursor(raw: string): { createdAt: number; runId: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { createdAt?: unknown; runId?: unknown };
    if (
      !Number.isSafeInteger(parsed.createdAt) ||
      (parsed.createdAt as number) < 0 ||
      typeof parsed.runId !== "string" ||
      parsed.runId.length === 0 ||
      parsed.runId.length > 200
    ) {
      throw new Error("invalid fields");
    }
    return {
      createdAt: parsed.createdAt as number,
      runId: parsed.runId,
    };
  } catch {
    throw new Error("Invalid messages cursor");
  }
}
