import { describe, expect, it } from "vitest";
import {
  AttachmentInputError,
  normalizeRunAttachments,
  resolveAttachmentSelection,
  toSafeAttachmentSummary,
} from "../src/attachments.js";

describe("normalizeRunAttachments", () => {
  it("maps by-framework file fields onto RunAttachment and ignores fileIp", () => {
    const result = normalizeRunAttachments(
      [
        {
          fileId: "123",
          fileName: "report.xlsx",
          fileType: "application/vnd.openxmlformats",
          fileSize: 1024,
          fileUrl: "https://files/report.xlsx",
          filePath: "/data/report.xlsx",
          datasetId: "ds-1",
          sourceType: "byai-file",
          useType: "content",
          fileIp: "10.0.0.1",
        },
      ],
      "by-framework",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "123",
      name: "report.xlsx",
      mediaType: "application/vnd.openxmlformats",
      size: 1024,
      url: "https://files/report.xlsx",
      path: "/data/report.xlsx",
      datasetId: "ds-1",
      sourceType: "byai-file",
      useType: "content",
      provenance: "by-framework",
    });
  });

  it("accepts HTTP canonical fields and tags provenance", () => {
    const result = normalizeRunAttachments(
      [{ id: "a", name: "note.txt", mediaType: "text/plain", size: 12 }],
      "http",
    );
    expect(result).toEqual([
      {
        id: "a",
        name: "note.txt",
        mediaType: "text/plain",
        size: 12,
        provenance: "http",
      },
    ]);
  });

  it("falls back to attachment-{index} for missing id and name", () => {
    const result = normalizeRunAttachments([{}], "http");
    expect(result[0].id).toBe("attachment-0");
    expect(result[0].name).toBe("attachment-0");
  });

  it("deduplicates by id, keeping the first occurrence", () => {
    const result = normalizeRunAttachments(
      [
        { id: "dup", name: "first" },
        { id: "dup", name: "second" },
        { id: "other", name: "third" },
      ],
      "http",
    );
    expect(result.map((a) => a.name)).toEqual(["first", "third"]);
  });

  it("keeps distinct auto-generated ids for two id-less attachments", () => {
    const result = normalizeRunAttachments(
      [{ name: "a" }, { name: "b" }],
      "http",
    );
    expect(result.map((a) => a.id)).toEqual(["attachment-0", "attachment-1"]);
  });

  it("omits size when not provided", () => {
    const result = normalizeRunAttachments([{ id: "a", name: "n" }], "http");
    expect("size" in result[0]).toBe(false);
  });

  it("throws on non-array input", () => {
    expect(() => normalizeRunAttachments({} as unknown as never[], "http")).toThrow(
      AttachmentInputError,
    );
  });

  it("throws when exceeding the per-Run limit", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, name: "n" }));
    expect(() => normalizeRunAttachments(many, "http")).toThrow(
      AttachmentInputError,
    );
  });

  it("throws on a non-object element", () => {
    expect(() =>
      normalizeRunAttachments(["nope"] as unknown as never[], "http"),
    ).toThrow(AttachmentInputError);
  });

  it("throws on a non-string text field", () => {
    expect(() =>
      normalizeRunAttachments([{ id: 123, name: "n" }], "http"),
    ).toThrow(AttachmentInputError);
  });

  it("throws on invalid size (negative, float, NaN, string)", () => {
    for (const bad of [-1, 1.5, NaN, "12"]) {
      expect(() =>
        normalizeRunAttachments(
          [{ id: "a", name: "n", size: bad }] as never,
          "http",
        ),
      ).toThrow(AttachmentInputError);
    }
  });

  it("throws when a string field exceeds its length limit", () => {
    const long = "x".repeat(501);
    expect(() =>
      normalizeRunAttachments([{ id: "a", name: long }], "http"),
    ).toThrow(AttachmentInputError);
  });
});

describe("toSafeAttachmentSummary", () => {
  it("keeps id/name/mediaType/size and strips url/path/datasetId/sourceType/useType", () => {
    const [attachment] = normalizeRunAttachments(
      [
        {
          id: "a",
          name: "n",
          mediaType: "text/plain",
          size: 5,
          url: "https://x",
          path: "/p",
          datasetId: "ds",
          sourceType: "s",
          useType: "u",
        },
      ],
      "http",
    );
    const summary = toSafeAttachmentSummary([attachment])[0];
    expect(summary).toEqual({ id: "a", name: "n", mediaType: "text/plain", size: 5 });
    expect("url" in summary).toBe(false);
    expect("path" in summary).toBe(false);
    expect("datasetId" in summary).toBe(false);
  });
});

describe("resolveAttachmentSelection", () => {
  const attachments = normalizeRunAttachments(
    [
      { id: "a", name: "a" },
      { id: "b", name: "b" },
      { id: "c", name: "c" },
    ],
    "by-framework",
  );

  it("defaults to all attachments when attachmentIds is undefined", () => {
    expect(resolveAttachmentSelection(attachments, undefined).map((a) => a.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns an empty set when an explicit empty array is passed", () => {
    expect(resolveAttachmentSelection(attachments, [])).toEqual([]);
  });

  it("returns only the requested ids preserving order", () => {
    expect(resolveAttachmentSelection(attachments, ["c", "a"]).map((a) => a.id)).toEqual([
      "c",
      "a",
    ]);
  });

  it("rejects unknown ids", () => {
    expect(() => resolveAttachmentSelection(attachments, ["a", "ghost"])).toThrow(
      AttachmentInputError,
    );
  });
});
