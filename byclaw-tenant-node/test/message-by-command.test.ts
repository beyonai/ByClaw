import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryService, type Row } from "../src/application/history.js";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { config } from "./fixtures.js";

const apps: ReturnType<typeof createApp>[] = [];
const headers = { "x-enterprise-id": "10", "x-tenant-generation": "7", "x-actor-user-id": "20" };
const url = (commandId = "evt-001") =>
  `/internal/v1/messages/by-command/${encodeURIComponent(commandId)}`;
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(ready = true) {
  const message: Row = {
    id: "90",
    message_id: "100",
    session_id: "30",
    enterprise_id: "10",
    usage: 1,
    persist_command_id: "evt-001",
    message_content: "hello",
    is_complete: true,
  };
  const session: Row = {
    session_id: "30",
    enterprise_id: "10",
    session_type: "hs_as",
    creator_id: "20",
  };
  const state = { message, session, member: true, task: null as Row | null };
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes("FROM byai.byai_message m"))
      return parameters[1] === message.persist_command_id ? [message] : [];
    if (sql.includes("FROM byai.byai_session_member"))
      return state.member ? [{ mem_obj_id: parameters[1] }] : [];
    if (sql.includes("FROM byai.byai_session WHERE"))
      return parameters[0] === "31"
        ? [{ ...session, session_id: "31", session_type: "hs_as" }]
        : [session];
    if (sql.includes("FROM byai.byai_group_chat_task")) return state.task ? [state.task] : [];
    throw new Error("Unexpected query");
  });
  const history = new HistoryService("10", new SqlHistoryRepository({ query }, "10"));
  const services = {
    history,
    commands: {},
    sessions: {},
    schema: {},
    ready: () => ready,
  } as unknown as HttpServices;
  const app = createApp(config, services, {}, { verifyClient: () => {}, logger: false });
  apps.push(app);
  return { app, query, state };
}

describe("GET message by persistence command", () => {
  it("returns the input message through a tenant-scoped parameterized lookup", async () => {
    const { app, query } = setup();
    const response = await app.inject({ url: url(), headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      messageId: "100",
      sessionId: "30",
      persistCommandId: "evt-001",
      complete: true,
    });
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("s.enterprise_id=$1");
    expect(sql).toContain("m.enterprise_id=$1");
    expect(sql).toContain("m.persist_command_id=$2");
    expect(sql).not.toContain("evt-001");
    expect(parameters).toEqual(["10", "evt-001", 1]);
  });
  it("queries only the latest persisted command of an answer", async () => {
    const { app, state } = setup();
    Object.assign(state.message, {
      usage: 2,
      persist_command_id: "evt-terminal",
      message_content: "answer",
    });
    expect((await app.inject({ url: url("evt-terminal"), headers })).json()).toMatchObject({
      usage: 2,
      messageContent: "answer",
    });
    expect((await app.inject({ url: url("evt-delta-old"), headers })).statusCode).toBe(404);
  });
  it("returns a sanitized 404 when the command has no matching row", async () => {
    const { app } = setup();
    const response = await app.inject({ url: url("missing"), headers });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "RESOURCE_NOT_ACCESSIBLE" } });
  });
  it.each(["bad'id", "x".repeat(65)])(
    "rejects an invalid command ID before querying",
    async (commandId) => {
      const { app, query } = setup();
      const response = await app.inject({ url: url(commandId), headers });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "INVALID_REQUEST_ID" } });
      expect(query).not.toHaveBeenCalled();
    },
  );
  it("requires a real actor even on this diagnostic endpoint", async () => {
    const { app, query } = setup();
    const response = await app.inject({
      url: url(),
      headers: { "x-enterprise-id": "10", "x-tenant-generation": "7" },
    });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("denies a user who is not a member of the message's group", async () => {
    const { app, state } = setup();
    state.member = false;
    expect((await app.inject({ url: url(), headers })).statusCode).toBe(404);
  });
  it("rejects a foreign tenant message even when its session looks accessible", async () => {
    const { app, state } = setup();
    state.message.enterprise_id = "11";
    expect((await app.inject({ url: url(), headers })).statusCode).toBe(404);
  });
  it("checks the owner of a personal session", async () => {
    const { app, state } = setup();
    Object.assign(state.session, { session_type: "h_as", creator_id: "21" });
    expect((await app.inject({ url: url(), headers })).statusCode).toBe(404);
  });
  it("checks the initiator of a private task as well as group membership", async () => {
    const { app, state } = setup();
    state.session.session_type = "h_as";
    state.task = { task_session_id: "30", group_session_id: "31", initiator_user_id: "21" };
    expect((await app.inject({ url: url(), headers })).statusCode).toBe(404);
  });
  it("redacts recalled content and attachments", async () => {
    const { app, state } = setup();
    Object.assign(state.message, {
      recalled_at: new Date(1000),
      related_resources: "private-file",
      metadata: '{"secret":"hidden"}',
      final_content: "private answer",
    });
    const response = await app.inject({ url: url(), headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recalled: true, messageContent: "消息已撤回" });
    expect(response.body).not.toMatch(/private|hidden/);
  });
  it("keeps the query blocked before business readiness", async () => {
    const { app, query } = setup(false);
    expect((await app.inject({ url: url(), headers })).statusCode).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });
});
