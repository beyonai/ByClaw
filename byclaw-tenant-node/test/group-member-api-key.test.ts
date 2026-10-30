import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import type { HistoryService } from "../src/application/history.js";
import { historyRoutes } from "../src/interfaces/http/data-routes.js";

it("uses the authenticated actor header for the internal group credential route", async () => {
  const groupMemberApiKey = vi.fn(async () => ({ api_key: "member-key" }));
  const app = Fastify();
  historyRoutes(app, { groupMemberApiKey } as unknown as HistoryService);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/internal/v1/group-chats/30/member-api-key?userId=99",
      headers: { "x-actor-user-id": "20" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ api_key: "member-key" });
    expect(groupMemberApiKey).toHaveBeenCalledExactlyOnceWith("20", "30");
  } finally {
    await app.close();
  }
});
