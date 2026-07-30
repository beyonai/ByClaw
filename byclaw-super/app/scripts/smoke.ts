const baseUrl = process.env.BYCLAW_SUPER_URL ?? "http://127.0.0.1:3000";
const token = process.env.BEYOND_TOKEN;

if (!token) {
  throw new Error("BEYOND_TOKEN is required");
}

const headers: Record<string, string> = {
  "content-type": "application/json",
  "Beyond-Token": token,
};
const runResponse = await fetch(`${baseUrl}/byclawSuper/v1/sessions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    message: process.env.SMOKE_MESSAGE ?? "请简要介绍你的专业能力。",
  }),
});
if (!runResponse.ok) {
  throw new Error(`Create Run failed: ${runResponse.status} ${await runResponse.text()}`);
}
const run = (await runResponse.json()) as { runId: string; eventsUrl: string };
const eventResponse = await fetch(`${baseUrl}${run.eventsUrl}`, {
  headers: { accept: "text/event-stream", "Beyond-Token": token },
});
if (!eventResponse.ok || !eventResponse.body) {
  throw new Error(`Open event stream failed: ${eventResponse.status}`);
}
const body = await eventResponse.text();
if (!body.includes("event: appStreamResponse")) {
  throw new Error(`Run did not complete successfully:\n${body}`);
}
process.stdout.write(`Smoke Run completed: ${run.runId}\n`);
