import { DomainError } from "../domain/errors.js";
import { canonical } from "../domain/json.js";
import { validId } from "../domain/values.js";
import type {
  ForwardActor,
  ForwardInput,
  ForwardItemTemplate,
  ForwardReference,
  FrozenSource,
  JsonValue,
  SourceCandidate,
  SourceKind,
  CandidateAddress,
  SourceMessage,
} from "./group-forward-types.js";

const knownTypes = new Set([
  "AGENT",
  "DIG_EMPLOYEE",
  "CATALOGUE",
  "HUMAN_ASSISTANT",
  "KG_DOC",
  "KG_DOC_FOLDER",
  "KG_DOC_FILE",
  "KG_QA",
  "KG_QA_FOLDER",
  "KG_QA_FILE",
  "KG_TERM",
  "KG_TERM_FOLDER",
  "KG_TERM_FILE",
  "KG_DB",
  "DATA_SOURCE",
  "KG_DB_FOLDER",
  "KG_DB_FILE",
  "TOOLKIT",
  "MCP",
  "MCP_TOOL",
  "TOOL",
  "HUMAN",
  "VIEW",
  "OBJECT",
  "SKILL",
  "COMMON_FILE",
  "COMMON_FOLDER",
]);
const fail = (code: string): never => {
  throw new DomainError(code);
};
export function positiveId(value: unknown): string {
  if (!validId(value)) return fail("FORWARD_INVALID_REQUEST");
  return value;
}
function ids(value: unknown, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max)
    return fail("FORWARD_INVALID_REQUEST");
  return Object.freeze(
    [...new Set(value.map(positiveId))].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
    ),
  );
}
export function normalizeInput(value: unknown): ForwardInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("FORWARD_INVALID_REQUEST");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["clientRequestId", "mode", "messageIds", "targetSessionIds"].includes(key),
    ) ||
    typeof input.clientRequestId !== "string" ||
    !/^[A-Za-z0-9:_-]{1,64}$/.test(input.clientRequestId) ||
    typeof input.mode !== "string" ||
    !["SINGLE", "MERGED"].includes(input.mode)
  )
    return fail("FORWARD_INVALID_REQUEST");
  return Object.freeze({
    clientRequestId: input.clientRequestId,
    mode: input.mode as ForwardInput["mode"],
    messageIds: ids(input.messageIds, 100),
    targetSessionIds: ids(input.targetSessionIds, 10),
  });
}
/** Exact compact JSON preimage; hashing belongs to the transport contract adapter. */
export function canonicalPayload(
  actor: ForwardActor,
  sourceId: string,
  input: ForwardInput,
): string {
  const normalized = normalizeInput(input);
  return JSON.stringify([
    "byclaw.group-forward/v1",
    positiveId(actor.enterpriseId),
    positiveId(actor.userId),
    positiveId(sourceId),
    normalized.mode,
    normalized.messageIds,
    normalized.targetSessionIds,
  ]);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
export function freezeSource(
  actor: ForwardActor,
  sourceId: string,
  messages: readonly SourceMessage[],
): FrozenSource {
  positiveId(actor.userId);
  positiveId(actor.enterpriseId);
  positiveId(sourceId);
  if (messages.length < 1 || messages.length > 100) return fail("FORWARD_INVALID_REQUEST");
  const selected = [...messages].sort(
    (a, b) => a.timelineOrdinal - b.timelineOrdinal || (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
  );
  const items: ForwardItemTemplate[] = [],
    candidates: SourceCandidate[] = [];
  const selectedMessageIds = selected.map((m) => positiveId(m.id));
  if (new Set(selectedMessageIds).size !== selected.length) return fail("FORWARD_INVALID_REQUEST");
  for (const message of selected) {
    const card = message.mergedItems.length > 0;
    const parts = card ? message.mergedItems : [message];
    for (const part of parts) {
      if (part !== message && part.mergedItems?.length) return fail("FORWARD_INVALID_REQUEST");
      positiveId(part.id);
      positiveId(part.speaker.id);
      if (
        !["USER", "AGENT"].includes(part.speaker.type) ||
        typeof part.content !== "string" ||
        !part.speaker.name ||
        !Number.isFinite(Date.parse(part.createdAt))
      )
        return fail("FORWARD_INVALID_REQUEST");
      const sourceKey = `${message.id}:${items.length}`;
      const references = new Map<string, ForwardReference>(),
        origins = new Map<string, string>();
      const addCandidate = (kind: SourceKind, origin: CandidateAddress["origin"], key: string) =>
        candidates.push({
          itemKey: sourceKey,
          selectedMessageId: message.id,
          kind,
          locatorCandidate: {},
          address: { currentItemId: part.authority?.currentItemId ?? null, origin, key },
        });
      for (const raw of part.resourceList) {
        const resourceType = text(raw.resourceType),
          resourceId = text(raw.resourceId);
        let id = text(raw.id);
        if (
          !id &&
          resourceType &&
          knownTypes.has(resourceType) &&
          resourceId &&
          part.content.includes(`{{${resourceType}_${resourceId}}}`)
        )
          id = `${resourceType}_${resourceId}`;
        if (!id) continue;
        const name = text(raw.resourceName);
        if (!name) return fail("FORWARD_RESOURCE_UNRESOLVABLE");
        const origin = canonical(raw);
        if (origins.has(id)) {
          if (origins.get(id) !== origin) return fail("FORWARD_REFERENCE_CONFLICT");
          continue;
        }
        origins.set(id, origin);
        references.set(id, {
          id,
          resourceId,
          resourceName: name,
          resourceType,
          resourceCode: null,
          extData: null,
        });
        if (resourceType === "KG_DOC_FILE" || resourceType === "COMMON_FILE") {
          if (!resourceId) return fail("FORWARD_RESOURCE_UNRESOLVABLE");
          addCandidate(
            resourceType === "KG_DOC_FILE" ? "KNOWLEDGE_FILE" : "USER_WORKSPACE_FILE",
            "RESOURCE_REFERENCE",
            id,
          );
        } else if (!resourceType || !knownTypes.has(resourceType)) {
          addCandidate("UNRESOLVED_REFERENCE", "RESOURCE_REFERENCE", id);
        }
      }
      for (const match of part.content.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const key = match[1]!;
        if ([...knownTypes].some((type) => key.startsWith(`${type}_`)) && !references.has(key))
          return fail("FORWARD_RESOURCE_UNRESOLVABLE");
      }
      for (const [origin, container] of [
        ["RELATED_FILE", part.relatedResources],
        ["PUBLISHED_FILE", part.metadata],
      ] as const) {
        if (Array.isArray(container.files))
          for (const [index, file] of container.files.entries()) {
            if (!file || typeof file !== "object" || Array.isArray(file))
              return fail("FORWARD_RESOURCE_UNRESOLVABLE");
            addCandidate("UPLOADED_FILE", origin, String(index));
          }
      }
      items.push({
        sourceKey,
        selectedMessageId: message.id,
        selectedMergedCard: card,
        sourceMessageId: part.id,
        ordinal: items.length,
        content: part.content,
        speaker: {
          type: part.speaker.type,
          id: part.speaker.id,
          name: part.speaker.name,
        },
        createdAt: part.createdAt,
        resourceList: [...references.values()],
      });
      if (items.length > 100) return fail("FORWARD_TOO_MANY_ITEMS");
    }
  }
  // Count serialized public data in bytes; candidate locators never leak into the snapshot.
  if (Buffer.byteLength(JSON.stringify(items), "utf8") > 1048576)
    return fail("FORWARD_SNAPSHOT_TOO_LARGE");
  return freeze({ selectedMessageIds, items, candidates, snapshotVersion: 1 });
}
export function projectText(item: Pick<ForwardItemTemplate, "content" | "resourceList">): string {
  const names = new Map(item.resourceList.map((r) => [r.id, r.resourceName]));
  return item.content.replace(
    /\{\{([^{}]+)\}\}/g,
    (original: string, key: string) => names.get(key) ?? original,
  );
}
