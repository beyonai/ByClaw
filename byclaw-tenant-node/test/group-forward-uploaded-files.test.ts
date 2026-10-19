import { describe, expect, it } from "vitest";
import { bindAttachments } from "../src/infrastructure/persistence/group-forward-commit.js";
import {
  relatedResourceAttachments,
  messageAttachments,
} from "../src/application/history/attachments.js";
import type {
  ForwardAttachment,
  ForwardItem,
  ForwardSourceManifest,
  TargetLease,
} from "../src/application/group-forward-types.js";

const lease = { targetId: "200", targetSessionId: "20" } as TargetLease;
const item = {
  itemId: "300",
  selectedMessageId: "101",
  selectedMergedCard: false,
  sourceMessageId: "101",
  ordinal: 0,
  content: "{{old}} file",
  speaker: { type: "USER", id: "7", name: "sender" },
  createdAt: "2026-10-19T00:00:00Z",
  resourceList: [
    { id: "old", resourceId: "source", resourceName: "a.txt", resourceType: "COMMON_FILE" },
  ],
  attachments: [],
} as ForwardItem;
const manifest = {
  attachments: [
    {
      targetId: "200",
      itemId: "300",
      attachmentId: "slot",
      sourceId: "proof",
      referenceKeys: ["old"],
    },
  ],
} as ForwardSourceManifest;
function bind(file: Partial<ForwardAttachment>) {
  return bindAttachments(
    item,
    manifest,
    {
      attempts: [
        {
          sourceId: "proof",
          state: "VERIFIED",
          object: {
            itemId: "300",
            attachmentId: "slot",
            size: 3,
            uploadedFile: { fileName: "a(1).txt", mediaType: "text/plain", ...file },
          } as any,
        },
      ],
    },
    lease,
  );
}
describe("ordinary uploaded files in forwarding", () => {
  it("uses a real conversation file and replaces the source token", () => {
    const result = bind({
      fileId: "700",
      filePath: "/.sessions/20/a(1).txt",
      fileUrl: "/commonFile/preview?target",
    });
    expect(result.content).toBe("{{COMMON_FILE_700}} file");
    expect(result.resourceList[0]?.resourceId).toBe("/by/.sessions/20/a(1).txt");
    expect(result.attachments[0]?.fileUrl).toBe("/commonFile/preview?target");
    expect(JSON.stringify(result)).not.toMatch(
      /targetAttachmentId|forward-attachments|"attachmentId"/,
    );
  });
  it("supports cloud upload results without a fileId and keeps target selectors", () => {
    const result = bind({
      fileId: null,
      filePath: "/group-forward-files/20/a.txt",
      cloudResourceId: "40",
    });
    expect(result.resourceList[0]?.resourceType).toBe("KG_DOC_FILE");
    expect(JSON.parse(result.resourceList[0]?.resourceCode ?? "{}")).toEqual({
      datasetId: "40",
      directoryPath: "/group-forward-files/20/a.txt",
    });
    expect(result.content).toBe(`{{${result.resourceList[0]?.id}}} file`);
  });
  it("timeline keeps normal upload URLs and published cloud fields", () => {
    const source = {
      sessionId: "20",
      messageId: "400",
      metadata: {
        scene: "GROUP_CHAT",
        kind: "FORWARD_SINGLE",
        forward: { resourceMode: "SNAPSHOT_ONLY" },
        files: [{ fileName: "cloud.pdf", filePath: "/target/cloud.pdf", cloudResourceId: "40" }],
      },
      relatedResources: {
        files: [
          {
            fileId: "700",
            fileName: "a.txt",
            filePath: "/.sessions/20/a.txt",
            fileUrl: "/commonFile/preview?target",
          },
        ],
      },
    };
    expect(relatedResourceAttachments(source)[0]?.fileUrl).toBe("/commonFile/preview?target");
    expect(messageAttachments(source)).toHaveLength(2);
    source.metadata.kind = "FORWARD_MERGED";
    expect(messageAttachments(source)).toEqual([]);
  });
});
