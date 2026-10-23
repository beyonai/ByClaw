import type { Row } from "./contracts.js";
import { arrayJson, objectJson } from "./message-format.js";
import { projectText } from "../group-forward-snapshot.js";

/** Known forwarding provenance remains passive even when other presentation fields are damaged. */
export function isSnapshotOnly(value: unknown): boolean {
  const meta = objectJson(value);
  return (
    ["FORWARD_SINGLE", "FORWARD_MERGED"].includes(meta.kind) ||
    objectJson(meta.forward).resourceMode === "SNAPSHOT_ONLY"
  );
}

/** Copy the public contract explicitly; old execution fields are never inherited by display references. */
export function forwardResources(meta: Row): Row[] {
  if (meta.kind === "FORWARD_MERGED") return [];
  return arrayJson(meta.resourceList)
    .filter((ref) => ref && typeof ref.id === "string" && typeof ref.resourceName === "string")
    .map((ref) =>
      Object.fromEntries(
        ["id", "resourceId", "resourceName", "resourceType"]
          .filter((key) => typeof ref[key] === "string")
          .map((key) => [key, ref[key]]),
      ),
    );
}

export function publicForward(value: unknown): Row | undefined {
  const meta = objectJson(value);
  if (!isSnapshotOnly(meta)) return undefined;
  const raw = objectJson(meta.forward);
  const result: Row = { resourceMode: "SNAPSHOT_ONLY" };
  if (typeof raw.forwardId === "string" && /^[1-9]\d*$/.test(raw.forwardId))
    result.forwardId = raw.forwardId;
  if (["SINGLE", "MERGED"].includes(raw.mode)) result.mode = raw.mode;
  if (Number.isInteger(raw.itemCount) && raw.itemCount >= 1 && raw.itemCount <= 100)
    result.itemCount = raw.itemCount;
  if (meta.kind === "FORWARD_MERGED") {
    result.title = "聊天记录";
    result.preview = arrayJson(raw.preview)
      .slice(0, 3)
      .map((entry) => ({
        speakerName: typeof entry?.speakerName === "string" ? entry.speakerName : "",
        content:
          typeof entry?.content === "string" ? [...entry.content].slice(0, 120).join("") : "",
      }));
  }
  return result;
}

export function passiveText(content: string, resources: Row[]): string {
  return projectText({ content, resourceList: resources as never });
}

/** Agent context contains readable data only, never attachment download capability or resource selectors. */
export function passiveAgentMessage(message: Row): Row {
  const result = { ...message };
  if (isSnapshotOnly(message)) {
    result.content = passiveText(String(message.content ?? ""), arrayJson(message.resourceList));
    for (const key of [
      "resourceList",
      "files",
      "metadata",
      "relatedResources",
      "taskId",
      "target",
      "groupCoordination",
    ])
      delete result[key];
    result.attachments = arrayJson(message.attachments).map((file) =>
      Object.fromEntries(
        ["fileName", "mediaType", "size"]
          .filter((key) => file?.[key] != null)
          .map((key) => [key, file[key]]),
      ),
    );
  }
  if (message.replyTo) result.replyTo = passiveAgentMessage(message.replyTo);
  return result;
}
