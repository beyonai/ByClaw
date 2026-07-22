const baseUrl = process.env.BYCLAW_SUPER_URL ?? "http://127.0.0.1:3000";
const agentId = process.env.SMOKE_AGENT_ID;
const token = process.env.BEYOND_TOKEN;

if (!agentId) {
  throw new Error("SMOKE_AGENT_ID is required");
}

const threadResponse = await fetch(`${baseUrl}/v1/threads`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    tenantId: process.env.SMOKE_TENANT_ID ?? "smoke",
    userCode: process.env.SMOKE_USER_CODE ?? "smoke",
    userName: "Smoke Test",
  }),
});
if (!threadResponse.ok) {
  throw new Error(`Create thread failed: ${threadResponse.status} ${await threadResponse.text()}`);
}
const thread = (await threadResponse.json()) as { id: string };
const headers: Record<string, string> = { "content-type": "application/json" };
if (token) {
  headers["Beyond-Token"] = token;
}
const runResponse = await fetch(`${baseUrl}/v1/threads/${thread.id}/runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    message: process.env.SMOKE_MESSAGE ?? "请简要介绍你的专业能力。",
    agentList: [
      {
        agentId,
        agentCode: process.env.SMOKE_AGENT_CODE,
        agentName: process.env.SMOKE_AGENT_NAME ?? "Smoke Agent",
        description: "Agent selected by the live smoke test",
      },
    ],
  }),
});
if (!runResponse.ok) {
  throw new Error(`Create run failed: ${runResponse.status} ${await runResponse.text()}`);
}
const run = (await runResponse.json()) as { runId: string; eventsUrl: string };
const eventResponse = await fetch(`${baseUrl}${run.eventsUrl}`, {
  headers: { accept: "text/event-stream" },
});
if (!eventResponse.ok || !eventResponse.body) {
  throw new Error(`Open event stream failed: ${eventResponse.status}`);
}
const body = await eventResponse.text();
if (!body.includes("event: run.completed")) {
  throw new Error(`Run did not complete successfully:\n${body}`);
}
process.stdout.write(`Smoke run completed: ${run.runId}\n`);
