import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { sessionRoutes } from "../src/interfaces/http/session-routes.js";
import type { SessionQueries } from "../src/application/session-queries.js";
import type { HistoryService } from "../src/application/history.js";

async function setup(denied?: string) {
  const app = Fastify();
  const children = vi.fn(async () => ({
    list: [{ sessionId: "51" }],
    total: 1,
    pageNum: 1,
    pageSize: 100,
  }));
  const access = vi.fn(async (_actor: string, id: string) => {
    if (id === denied) throw new Error("denied");
    return {
      sessionId: id,
      parentSessionId: id === "51" ? "50" : "40",
      state: "GROUP_TASK",
      objectId: "12",
    };
  });
  sessionRoutes(
    app,
    { children } as unknown as SessionQueries,
    { access } as unknown as HistoryService,
  );
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/sessions/50/children?pageNum=1&pageSize=100",
    headers: { "x-actor-user-id": "8" },
  });
  await app.close();
  return { response, children, access };
}

describe("task child session route", () => {
  it("authorizes parent and every child and preserves navigation metadata", async () => {
    const { response, access } = await setup();
    expect(response.statusCode).toBe(200);
    expect(access.mock.calls).toEqual([
      ["8", "50"],
      ["8", "51"],
    ]);
    expect(response.json().list[0]).toMatchObject({
      sessionId: "51",
      parentSessionId: "50",
      objectId: "12",
      state: "GROUP_TASK",
    });
  });
  it("does not query children of an inaccessible parent", async () => {
    const { response, children } = await setup("50");
    expect(response.statusCode).not.toBe(200);
    expect(children).not.toHaveBeenCalled();
  });
  it("does not expose an inaccessible child", async () => {
    const { response } = await setup("51");
    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain('"sessionId":"51"');
  });
});
