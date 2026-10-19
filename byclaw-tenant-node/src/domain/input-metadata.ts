import { DomainError } from "./errors.js";
import { requireId } from "./values.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("INVALID_MIRROR");
  return value as Record<string, unknown>;
}

/** Voice history retains an owned file reference; audio bytes and provider configuration stay transient. */
export function inputMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  const metadata = object(value);
  if (metadata.messageType !== "VOICE" && metadata.voice === undefined) return { ...metadata };
  if (
    metadata.messageType !== "VOICE" ||
    Object.keys(metadata).some((key) => !["messageType", "voice"].includes(key))
  )
    throw new DomainError("INVALID_MIRROR");
  const voice = object(metadata.voice);
  if (
    Object.keys(voice).some(
      (key) => !["fileId", "fileName", "mimeType", "durationMs"].includes(key),
    ) ||
    typeof voice.fileName !== "string" ||
    !voice.fileName.trim() ||
    !voice.fileName.toLowerCase().endsWith(".mp3") ||
    Buffer.byteLength(voice.fileName) > 512 ||
    /[\u0000-\u001f\u007f]/u.test(voice.fileName) ||
    voice.mimeType !== "audio/mpeg" ||
    (voice.durationMs !== undefined &&
      (!Number.isSafeInteger(voice.durationMs) ||
        (voice.durationMs as number) < 1 ||
        (voice.durationMs as number) > 300000))
  )
    throw new DomainError("INVALID_MIRROR");
  return {
    messageType: "VOICE",
    voice: {
      fileId: requireId(voice.fileId),
      fileName: voice.fileName,
      mimeType: "audio/mpeg",
      ...(voice.durationMs === undefined ? {} : { durationMs: voice.durationMs }),
    },
  };
}
