import { describe, expect, it, vi } from "vitest";
import { inputMetadata } from "../src/domain/input-metadata.js";
import { MirrorInputWriter } from "../src/infrastructure/persistence/mirror-input.js";
import { mirrorHash, validateMirror } from "../src/interfaces/contracts/mirror.js";
import { event, identity } from "./fixtures.js";

const metadata = {
  messageType: "VOICE",
  voice: { fileId: "401", fileName: "语音.mp3", mimeType: "audio/mpeg", durationMs: 1250 },
};
const input = (value: unknown = metadata) =>
  event({
    eventType: "INPUT",
    payload: { id: "200", userId: "20", messageContent: "[语音消息]", metadata: value },
  });

describe("voice input mirror", () => {
  it("validates the stable voice reference without changing the producer hash", () => {
    const envelope = input();
    expect(validateMirror(envelope, identity)).toBe(envelope);
    expect(envelope.payload.metadata).toEqual(metadata);
    expect(inputMetadata(metadata)).toEqual(metadata);
  });
  it("accepts absent metadata and optional duration for ordinary and voice input", () => {
    const ordinary = input();
    delete ordinary.payload.metadata;
    ordinary.payloadHash = mirrorHash(ordinary);
    expect(() => validateMirror(ordinary, identity)).not.toThrow();
    expect(() => validateMirror(input(null), identity)).not.toThrow();
    expect(
      inputMetadata({
        messageType: "VOICE",
        voice: { fileId: "401", fileName: "voice.mp3", mimeType: "audio/mpeg" },
      }),
    ).toEqual({
      messageType: "VOICE",
      voice: { fileId: "401", fileName: "voice.mp3", mimeType: "audio/mpeg" },
    });
  });
  it.each([
    { ...metadata, audioBase64: "ID3-secret" },
    { ...metadata, voice: { ...metadata.voice, audioBase64: "ID3-secret" } },
    { ...metadata, voice: { ...metadata.voice, fileUrl: "https://signed-secret.invalid" } },
    { ...metadata, voice: { ...metadata.voice, transcript: "not part of the mirror contract" } },
    { ...metadata, voice: { ...metadata.voice, fileId: 401 } },
    { ...metadata, voice: { ...metadata.voice, fileName: "\u0000.mp3" } },
    { ...metadata, voice: { ...metadata.voice, mimeType: "audio/wav" } },
    { ...metadata, voice: { ...metadata.voice, durationMs: -1 } },
    { ...metadata, voice: { ...metadata.voice, durationMs: 1.25 } },
    { ...metadata, voice: { ...metadata.voice, durationMs: 300001 } },
    { messageType: "VOICE" },
    { voice: metadata.voice },
  ])("rejects bytes, credentials and malformed voice metadata before persistence", (value) => {
    expect(() => validateMirror(input(value), identity)).toThrow();
  });
  it("persists the voice reference and request identity in the history JSON", async () => {
    let saved: Record<string, unknown> = {};
    const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
      if (sql.startsWith("INSERT INTO byai.byai_message (")) {
        const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",");
        saved = Object.fromEntries(columns.map((column, index) => [column, parameters[index]]));
      }
      return [];
    });
    await new MirrorInputWriter({ query }, identity.enterpriseId).insertInput(input());
    expect(saved.message_content).toBe("[语音消息]");
    expect(JSON.parse(saved.metadata as string)).toEqual({
      ...metadata,
      clientRequestId: "client",
    });
    expect(saved.persist_hash).toBe(input().payloadHash);
    expect(saved.metadata).not.toContain("audioBase64");
  });
  it("refuses transient voice bytes even when the writer is invoked directly", async () => {
    const query = vi.fn(async () => []);
    await expect(
      new MirrorInputWriter({ query }, identity.enterpriseId).insertInput(
        input({ ...metadata, voice: { ...metadata.voice, audioBase64: "secret" } }),
      ),
    ).rejects.toThrow("INVALID_MIRROR");
    expect(query).not.toHaveBeenCalled();
  });
});
