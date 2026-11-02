import { describe, expect, it } from "vitest";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { config } from "./fixtures.js";
import { forwardFixture } from "./support/forward-pg-fixture.js";

describe.skipIf(!process.env.FORWARD_TEST_PG)("text forwarding through owning HTTP routes", () => {
  it("publishes and replays without any worker lease or copy HTTP calls", async () => {
    const f = await forwardFixture();
    const app = createApp(
      { ...config, enterpriseId: "1", tenantId: "1" },
      {
        forwards: f.store,
        connected: () => true,
        ready: () => true,
        provisioned: () => true,
        schemaState: () => ({}),
        health: () => ({}),
      } as unknown as HttpServices,
      undefined,
      { verifyClient: () => {}, logger: false },
    );
    try {
      const request = {
        method: "POST" as const,
        url: "/internal/v1/group-chats/10/forward-requests",
        headers: { "x-enterprise-id": "1", "x-tenant-generation": "7", "x-actor-user-id": "30" },
        payload: {
          clientRequestId: "http-text",
          mode: "SINGLE",
          messageIds: ["101"],
          targetSessionIds: ["20"],
        },
      };
      const response = await app.inject(request);
      expect(response.statusCode, response.body).toBe(202);
      const result = response.json();
      expect(result.state).toBe("SUCCEEDED");
      expect(result.targets[0].messageIds).toHaveLength(1);
      expect((await app.inject(request)).json()).toEqual(result);
      const messages = await f.sql(
        "SELECT message_content FROM byai.byai_message WHERE message_id=$1",
        [result.targets[0].messageIds[0]],
      );
      expect(messages[0].message_content).toBe("first");
      const work = await f.store.discoverWork(null, 20, result.requestId);
      expect(work.candidates).toHaveLength(1);
      expect(work.candidates[0].deliveryOnly).toBe(true);
      expect(
        await f.sql(
          "SELECT target_id FROM byai.byai_group_chat_forward_target WHERE pending_delivery=TRUE AND lease_until IS NULL",
        ),
      ).toHaveLength(1);
    } finally {
      await app.close();
      await f.close();
    }
  });
});
