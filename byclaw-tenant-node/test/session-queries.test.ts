import { describe, expect, it, vi } from "vitest";
import { SessionQueries } from "../src/application/session-queries.js";
import { SqlSessionRepository } from "../src/infrastructure/persistence/session-repository.js";
import type { SqlSession } from "../src/application/database-ports.js";
import Fastify from "fastify";
import { sessionRoutes } from "../src/interfaces/http/session-routes.js";
import type { HistoryService } from "../src/application/history.js";

describe("tenant session query", () => {
  it("loads child sessions after authorizing their parent", async () => {
    const list = vi.fn(async () => ({
      list: [{ sessionId: "51", parentSessionId: "50" }],
      total: 1,
    }));
    const access = vi.fn(async (_actor: string, sessionId: string) => ({
      sessionId,
      ...(sessionId === "51" ? { parentSessionId: "50" } : {}),
    }));
    const sessionExtensions = vi.fn(async () => []);
    const app = Fastify();
    sessionRoutes(app, new SessionQueries({ list }), {
      access,
      sessionExtensions,
    } as unknown as HistoryService);
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/sessions/50/children/query",
      headers: { "x-actor-user-id": "8" },
      payload: { pageNum: 1, pageSize: 20 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().list).toEqual([
      { sessionId: "51", parentSessionId: "50", sessionExts: [] },
    ]);
    expect(access).toHaveBeenCalledWith("8", "50");
    expect(list).toHaveBeenCalledWith("8", 1, 20, "", ["h_as"], undefined, undefined, "50");
    await app.close();
  });
  it("binds tenant, actor and parent when reading private task children", async () => {
    const sql = vi.fn(async () => []);
    const query = new SessionQueries(new SqlSessionRepository({ query: sql }, "123"));
    await query.children("8", "8011237409000000345", 2, 50);
    expect(sql).toHaveBeenCalledTimes(2);
    for (const [statement, params] of sql.mock.calls) {
      expect(statement).toContain("enterprise_id=$1 AND creator_id=$2 AND parent_session_id=$3");
      expect(statement).toContain(
        "NOT IN('CLOSED','GROUP_CHAT_ROUTING','GROUP_TASK_CANDIDATE','GROUP_CHAT_DISPATCH')",
      );
      expect(params.slice(0, 3)).toEqual(["123", "8", "8011237409000000345"]);
    }
    expect(sql.mock.calls[1][1]).toEqual(["123", "8", "8011237409000000345", 50, 50]);
  });
  it("filters agent history inside the tenant and actor boundary", async () => {
    const sql = vi.fn(async () => []);
    const query = new SessionQueries(new SqlSessionRepository({ query: sql }, "123"));
    await query.list("8", { pageNum: 1, pageSize: 5, agentId: "42" });
    for (const [statement, params] of sql.mock.calls) {
      expect(statement).toContain("object_id");
      expect(statement).toContain("mem_obj_type='AGENT'");
      expect(params).toContain("42");
      expect(params.slice(0, 2)).toEqual(["123", "8"]);
    }
  });
  it("passes requested chat types to the repository", async () => {
    const list = vi.fn(async () => ({ list: [], total: 0, pageNum: 1, pageSize: 20 }));
    const query = new SessionQueries({ list });
    await query.list("8", { pageNum: 1, pageSize: 20, sessionTypes: ["h_h", "hs_as"] });
    expect(list).toHaveBeenCalledWith("8", 1, 20, "", ["h_h", "hs_as"]);
    await expect(query.list("8", { sessionTypes: ["foreign"] })).rejects.toThrow(
      "INVALID_SESSION_TYPES",
    );
  });

  it("passes a project filter to both page and count queries", async () => {
    const sql = vi.fn(async () => []);
    const repository = new SqlSessionRepository({ query: sql } as unknown as SqlSession, "123");
    const query = new SessionQueries(repository);
    await query.list("8", { pageNum: 1, pageSize: 5, projectId: "-1" });
    expect(sql).toHaveBeenCalledTimes(2);
    for (const [statement, params] of sql.mock.calls) {
      expect(statement).toContain("project_id::text=$5");
      expect(params[4]).toBe("-1");
    }
    await expect(query.list("8", { projectId: "-2" })).rejects.toThrow();
  });

  it("binds enterprise, actor and type filters in both count and page SQL", async () => {
    const query = vi.fn(async () => []);
    const repository = new SqlSessionRepository({ query } as unknown as SqlSession, "123");
    await repository.list("8", 1, 20, "hello", ["h_h", "hs_as"]);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain("enterprise_id=$1");
      expect(sql).toContain("mem_obj_id=$2");
      expect(sql).toContain("session_type=ANY($4::text[])");
      expect(params.slice(0, 4)).toEqual(["123", "8", "%hello%", ["h_h", "hs_as"]]);
    }
  });
});
