import { afterEach, describe, expect, it } from "vitest";
import {
  startTestService,
  type TestService,
} from "./helpers/test-service.js";

const services: TestService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

describe("byclaw-super HTTP/SSE E2E", () => {
  it("reports liveness, readiness and authentication failures over HTTP", async () => {
    const service = await start(false);

    const health = await fetch(`${service.baseUrl}/byclawSuper/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const ready = await fetch(`${service.baseUrl}/byclawSuper/ready`);
    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toMatchObject({
      ready: false,
      pi: { healthy: false, message: "model unavailable" },
    });

    const missingToken = await fetch(`${service.baseUrl}/byclawSuper/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(missingToken.status).toBe(401);

    const invalidToken = await fetch(`${service.baseUrl}/byclawSuper/v1/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Beyond-Token": "invalid-token",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(invalidToken.status).toBe(401);
  });

  it("runs a session through SSE, history, replay and owner isolation", async () => {
    const service = await start();
    const ownerToken = service.token("owner-a");
    const otherToken = service.token("owner-b");

    const createdResponse = await fetch(`${service.baseUrl}/byclawSuper/v1/sessions`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ message: "hello e2e", thinkingLevel: "high" }),
    });
    expect(createdResponse.status).toBe(202);
    const created = (await createdResponse.json()) as {
      sessionId: string;
      runId: string;
      eventsUrl: string;
      thinkingLevel: string;
    };
    expect(created.thinkingLevel).toBe("high");

    const eventsResponse = await fetch(
      `${service.baseUrl}${created.eventsUrl}`,
      { headers: tokenHeaders(ownerToken, { accept: "text/event-stream" }) },
    );
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const events = await eventsResponse.text();
    expect(events).toContain("event: reasoningLogStart");
    expect(events).toContain("event: answerDelta");
    expect(events).toContain("event: appStreamResponse");
    expect(events).toContain('"content":"hello e2e"');
    expect(events).not.toContain(ownerToken);

    const historyResponse = await fetch(
      `${service.baseUrl}/byclawSuper/v1/sessions/${created.sessionId}/messages`,
      { headers: tokenHeaders(ownerToken) },
    );
    expect(historyResponse.status).toBe(200);
    await expect(historyResponse.json()).resolves.toMatchObject({
      sessionId: created.sessionId,
      items: [
        { runId: created.runId, role: "user", content: "hello e2e" },
        {
          runId: created.runId,
          role: "assistant",
          content: "answer:hello e2e",
        },
      ],
    });

    const replayResponse = await fetch(
      `${service.baseUrl}${created.eventsUrl}`,
      {
        headers: tokenHeaders(ownerToken, {
          accept: "text/event-stream",
          "last-event-id": "2",
        }),
      },
    );
    const replay = await replayResponse.text();
    expect(replayResponse.status).toBe(200);
    expect(replay).not.toContain("id: 1\n");
    expect(replay).not.toContain("id: 2\n");
    expect(replay).toContain("event: appStreamResponse");

    for (const path of [
      `/byclawSuper/v1/runs/${created.runId}`,
      `/byclawSuper/v1/runs/${created.runId}/events`,
      `/byclawSuper/v1/sessions/${created.sessionId}/messages`,
    ]) {
      const response = await fetch(`${service.baseUrl}${path}`, {
        headers: tokenHeaders(otherToken),
      });
      expect(response.status).toBe(404);
    }
  });
});

async function start(ready = true): Promise<TestService> {
  const service = await startTestService(ready);
  services.push(service);
  return service;
}

function jsonHeaders(token: string): Record<string, string> {
  return tokenHeaders(token, { "content-type": "application/json" });
}

function tokenHeaders(
  token: string,
  additional: Record<string, string> = {},
): Record<string, string> {
  return { "Beyond-Token": token, ...additional };
}
