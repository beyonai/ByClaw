import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { config } from "./fixtures.js";
import { humanTaskRoutes } from "../src/interfaces/http/human-task-routes.js";
describe("human task internal transport", () => {
  it("passes the authenticated actor header without accepting actor fields in the body", async () => {
    const app = Fastify();
    const call = vi.fn(async () => ({ items: [] }));
    humanTaskRoutes(app, { call });
    const body = { relation: "ALL", actor: "999" };
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/group-human-tasks/list",
      headers: { "x-actor-user-id": "20" },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(call).toHaveBeenCalledWith("20", "list", body);
    await app.close();
  });
  it("rejects missing actor and array bodies before executing", async () => {
    const app = Fastify();
    const call = vi.fn(async () => ({}));
    humanTaskRoutes(app, { call });
    await app.inject({ method: "POST", url: "/internal/v1/group-human-tasks/list", payload: {} });
    await app.inject({
      method: "POST",
      url: "/internal/v1/group-human-tasks/list",
      headers: { "x-actor-user-id": "20" },
      payload: [],
    });
    expect(call).not.toHaveBeenCalled();
    await app.close();
  });
  it.each(["proposalSender", "counts", "groupList"])(
    "requires internal service authentication for %s and treats it as a read action",
    async (action) => {
      const call = vi.fn(async () => ({ senderType: "AGENT", senderId: "31" }));
      const app = createApp(
        { ...config, transport: "http" },
        {
          humanTasks: { call },
          commands: {},
          history: {},
          sessions: {},
          schema: {},
          ready: () => true,
          connected: () => true,
          provisioned: () => true,
          schemaState: () => ({}),
          health: () => ({}),
          requireExecution: async () => {
            throw Error("execution disabled");
          },
        } as unknown as HttpServices,
        undefined,
        { logger: false },
      );
      const headers = {
        "x-enterprise-id": "10",
        "x-tenant-generation": "7",
        "x-actor-user-id": "20",
      };
      const request = {
        method: "POST" as const,
        url: `/internal/v1/group-human-tasks/${action}`,
        payload: { sourceTaskSessionId: "610" },
      };
      try {
        const denied = await app.inject({ ...request, headers });
        expect(denied.statusCode).toBe(401);
        expect(call).not.toHaveBeenCalled();
        const allowed = await app.inject({
          ...request,
          headers: { ...headers, authorization: `Bearer ${config.internalToken}` },
        });
        expect(allowed.statusCode).toBe(200);
        expect(allowed.json()).toEqual({ senderType: "AGENT", senderId: "31" });
      } finally {
        await app.close();
      }
    },
  );
});
