import { DomainError } from "./errors.js";
export type HumanTaskJson = Record<string, any>;
export function check(value: unknown, code: string): asserts value {
  if (!value) throw new DomainError(`HUMAN_TASK_${code}`);
}
export function taskId(body: HumanTaskJson, key: string): string {
  const value = body[key];
  check(
    typeof value === "string" &&
      /^[1-9][0-9]{0,18}$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
    `INVALID_${key}`,
  );
  return value;
}
export function requestId(body: HumanTaskJson): string {
  check(
    typeof body.requestId === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(body.requestId),
    "REQUEST_ID_REQUIRED",
  );
  return body.requestId;
}
/** Incomplete proposals remain editable; confirming requires every immutable task field. */
export function humanTaskItems(raw: unknown, complete: boolean): HumanTaskJson[] {
  check(Array.isArray(raw) && raw.length > 0 && raw.length <= 100, "INVALID_ITEMS");
  const keys = new Set<string>();
  return raw.map((value: unknown, index: number) => {
    check(value && typeof value === "object" && !Array.isArray(value), "INVALID_ITEM");
    const item = value as HumanTaskJson;
    const itemKey = item.itemKey ?? String(index + 1);
    check(
      typeof itemKey === "string" && itemKey.length <= 128 && !keys.has(itemKey),
      "INVALID_ITEM_KEY",
    );
    keys.add(itemKey);
    const result: HumanTaskJson = { itemKey };
    for (const field of ["title", "content", "acceptanceCriteria"]) {
      check(item[field] == null || typeof item[field] === "string", "INVALID_ITEM");
      result[field] = (item[field] ?? "").trim();
      check(result[field].length <= (field === "title" ? 512 : 100000), "ITEM_TOO_LARGE");
    }
    if (item.assigneeUserId) result.assigneeUserId = taskId(item, "assigneeUserId");
    if (item.deadline) {
      check(
        typeof item.deadline === "string" &&
          /(?:Z|[+-]\d\d:\d\d)$/.test(item.deadline) &&
          Number.isFinite(Date.parse(item.deadline)),
        "INVALID_DEADLINE",
      );
      result.deadline = new Date(item.deadline).toISOString();
    }
    if (complete) check(result.title && result.content && result.assigneeUserId, "ITEM_INCOMPLETE");
    return result;
  });
}
export function requireSubmission(task: HumanTaskJson, body: HumanTaskJson): void {
  check(task.status !== "ACCEPTED", "ACCEPTED");
  check(
    (typeof body.text === "string" && body.text.trim()) ||
      (Array.isArray(body.files) && body.files.length),
    "CONTENT_REQUIRED",
  );
}
export function requireReview(task: HumanTaskJson, body: HumanTaskJson): void {
  check(task.status === "PENDING_REVIEW", "NOT_PENDING_REVIEW");
  check(
    task.latestSubmissionId === body.submissionId && body.expectedRevision === task.revision,
    "STALE_VERSION",
  );
  check(body.decision === "ACCEPT" || body.decision === "RETURN", "INVALID_DECISION");
  check(
    body.decision !== "RETURN" || (typeof body.opinion === "string" && body.opinion.trim()),
    "OPINION_REQUIRED",
  );
}
