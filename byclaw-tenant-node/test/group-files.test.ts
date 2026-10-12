import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { HistoryService, type HistoryRepository, type Row } from "../src/application/history.js";
import { historyRoutes } from "../src/interfaces/http/data-routes.js";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";
import type { SqlSession } from "../src/application/database-ports.js";

function setup() {
  const stored: Row[] = [];
  const messages = vi.fn(async (filter: any) => {
    const before = filter.filePage?.before;
    const inclusive = filter.filePage?.inclusive;
    return stored
      .filter(
        (row) =>
          !before ||
          (inclusive
            ? BigInt(row.messageId) <= BigInt(before)
            : BigInt(row.messageId) < BigInt(before)),
      )
      .sort((a, b) => Number(BigInt(b.messageId) - BigInt(a.messageId)))
      .slice(0, filter.limit);
  });
  const repo = {
    session: vi.fn(async () => ({ enterpriseId: "10", sessionType: "hs_as" })),
    member: vi.fn(async () => ({ memObjId: "20" })),
    messages,
  } as unknown as HistoryRepository;
  return { stored, repo, messages, service: new HistoryService("10", repo) };
}
const row = (id: string, ...ids: string[]): Row => ({
  messageId: id,
  sessionId: "30",
  createTime: new Date(Number(id)),
  relatedResources: {
    files: ids.map((fileId) => ({
      fileId,
      fileName: fileId + ".md",
      filePath: "/uploads/" + fileId,
    })),
  },
});

describe("group file pagination", () => {
  it("fills fixed file pages and resumes inside a message", async () => {
    const { stored, service } = setup();
    expect(typeof service.files).toBe("function");
    stored.push(row("100", "a", "b", "c"), row("50", "d", "e"));
    const first = await service.files("20", "30", 2);
    expect(first.files.map((f) => f.attachment.fileId)).toEqual(["a", "b"]);
    expect(first.files[0]?.attachment.filePath).toBe("/uploads/a");
    expect(first.hasMore).toBe(true);
    stored.push(row("200", "new"));
    const second = await service.files("20", "30", 2, first.nextCursor!);
    expect(second.files.map((f) => f.attachment.fileId)).toEqual(["c", "d"]);
    const last = await service.files("20", "30", 2, second.nextCursor!);
    expect(last.files.map((f) => f.attachment.fileId)).toEqual(["e"]);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });
  it("preserves task preview fields and skips malformed attachments", async () => {
    const { stored, service } = setup();
    expect(typeof service.files).toBe("function");
    const message = row("100", "image");
    message.relatedResources.files.push({});
    message.metadata = {
      scene: "GROUP_CHAT",
      kind: "TASK_RESULT",
      files: [{ fileName: "report.md", filePath: "/cloud/report.md", cloudResourceId: "700" }, {}],
    };
    stored.push(message);
    const page = await service.files("20", "30", 2);
    expect(page.files).toHaveLength(2);
    expect(page.files[1]?.attachment).toMatchObject({
      filePath: "/cloud/report.md",
      cloudResourceId: "700",
    });
    expect(page.hasMore).toBe(false);
  });
  it("continues scanning sparse candidate batches until the page is full", async () => {
    const { stored, service, messages } = setup();
    expect(typeof service.files).toBe("function");
    stored.push(...Array.from({ length: 100 }, (_, i) => row(String(i + 100))));
    stored.push(row("50", "a", "b", "c"));
    const page = await service.files("20", "30", 2);
    expect(page.files).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(messages).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid sizes, foreign cursors and nonmembers before querying", async () => {
    const { service, repo, messages } = setup();
    expect(typeof service.files).toBe("function");
    for (const size of [0, 51])
      await expect(service.files("20", "30", size)).rejects.toThrow("INVALID_PAGE");
    for (const value of [
      "!",
      Buffer.from("1:31:100:0").toString("base64url"),
      Buffer.from("1:30:100:-1").toString("base64url"),
    ])
      await expect(service.files("20", "30", 2, value)).rejects.toThrow("INVALID_CURSOR");
    vi.mocked(repo.member).mockResolvedValue(null);
    await expect(service.files("20", "30", 2)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(messages).not.toHaveBeenCalled();
  });
  it("reads only attachment columns and scopes the SQL to its tenant", async () => {
    const query = vi.fn(async () => []);
    const repo = new SqlHistoryRepository({ query } as unknown as SqlSession, "10");
    await repo.messages({
      sessionId: "30",
      filePage: { before: "9007199254740993", inclusive: true },
      limit: 100,
    });
    const [sql, parameters] = query.mock.calls[0]! as unknown as [string, unknown[]];
    expect(sql).not.toContain("SELECT m.*");
    expect(sql).not.toContain("message_content");
    expect(sql).toContain("m.recalled_at IS NULL");
    expect(sql).toContain("s.enterprise_id=$1");
    expect(sql).toContain("NULLS LAST");
    expect(sql).toContain("(m.create_time,m.message_id)<=");
    expect(parameters).toEqual(["10", "30", "9007199254740993", 100]);
  });
  it("exposes the internal GET endpoint with pageSize and cursor", async () => {
    const app = Fastify();
    const files = vi.fn(async () => ({ files: [], pageSize: 2, hasMore: false, nextCursor: null }));
    historyRoutes(app, { files } as unknown as HistoryService);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/internal/v1/group-chats/30/files?pageSize=2&cursor=test",
        headers: { "x-actor-user-id": "20" },
      });
      expect(response.statusCode).toBe(200);
      expect(files).toHaveBeenCalledWith("20", "30", 2, "test");
    } finally {
      await app.close();
    }
  });
});
