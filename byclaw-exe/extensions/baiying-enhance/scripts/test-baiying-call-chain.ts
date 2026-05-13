/**
 * Smoke `baiying_call` the same way OpenClaw does: tool factory → execute()
 * with `resource_id` + `query` + channel session (required by baiying_call).
 *
 * Run (package root):
 *   pnpm exec tsx scripts/test-baiying-call-chain.ts [resourceId] [channelSessionId] [query...]
 *
 * Example (matching production case):
 *   pnpm exec tsx scripts/test-baiying-call-chain.ts \
 *     10036261 10049627 "鲸智智能体平台是什么？"
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBaiyingCallToolFactory } from "../src/baiying-call-tool.js";
import { AgentRegistryState } from "../src/agent-state.js";
import { resolveBundledBaiyingResourcesDir } from "../src/plugin-paths.js";
import type { AdaptedManagedAgent } from "../src/agent-adapter.js";
import { isRecord } from "../src/executor/types.js";

const AGENT_ID = process.argv[2] ?? "10036261";
const CHANNEL_SESSION_ID = process.argv[3] ?? "10049627";
const QUERY =
  process.argv.slice(4).join(" ").trim() || "鲸智智能体平台是什么？";

async function loadAgentFromSnapshot(resourceId: string): Promise<AdaptedManagedAgent | null> {
  const resourcesDir = resolveBundledBaiyingResourcesDir();
  const fp = path.join(resourcesDir, "agent", `AGENT_${resourceId}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(fp, "utf8"));
  } catch {
    console.error(`[error] cannot read snapshot: ${fp}`);
    return null;
  }
  if (!isRecord(raw)) return null;
  const meta = isRecord(raw.metaContent) ? raw.metaContent : {};
  const agentSseUrl = typeof meta.agentSseUrl === "string" ? meta.agentSseUrl.trim() : "";
  const integrationType =
    typeof meta.agentType === "string"
      ? meta.agentType.trim()
      : typeof meta.agent_type === "string"
        ? String(meta.agent_type).trim()
        : "";
  const name =
    typeof raw.resourceName === "string" ? raw.resourceName : `agent-${resourceId}`;
  return {
    sourceKey: resourceId,
    agentId: `baiying-agent-${resourceId}`,
    providerKey: "",
    modelRef: "",
    allowSpawnFrom: ["main"],
    listEntry: {
      id: `baiying-agent-${resourceId}`,
      name,
      identity: { name },
      tools: { alsoAllow: ["baiying_call"] },
    },
    systemPrompt: "You are a helpful assistant.",
    ...(agentSseUrl ? { agentSseUrl, integrationType: integrationType || undefined } : {}),
  };
}

async function main(): Promise<void> {
  const resourcesDir = resolveBundledBaiyingResourcesDir();
  const agent = await loadAgentFromSnapshot(AGENT_ID);
  if (!agent?.agentSseUrl) {
    console.error("[error] snapshot missing metaContent.agentSseUrl");
    process.exitCode = 1;
    return;
  }

  const registry = new AgentRegistryState();
  registry.replaceAll([agent]);
  const factory = createBaiyingCallToolFactory({
    registry,
    executorPath: resourcesDir,
    agentConfigDir: path.join(resourcesDir, "agent"),
  });

  const tool = factory({
    agentId: agent.agentId,
    sessionKey: "agent:main:main",
    channel_session_id: CHANNEL_SESSION_ID,
  });
  if (!tool) {
    console.error("[error] tool factory returned null (agentId / registry)");
    process.exitCode = 1;
    return;
  }

  console.log(`[config] executorPath(resources)=${resourcesDir}`);
  console.log(
    `[config] agentId=${agent.agentId} resource_id=${AGENT_ID} channel-session-id=${CHANNEL_SESSION_ID}`,
  );
  console.log(
    `[config] payload=${JSON.stringify({
      _: true,
      resource_id: AGENT_ID,
      query: QUERY,
    })}`,
  );

  const t0 = Date.now();
  const result = await tool.execute("smoke-tool-call", {
    _: true,
    resource_id: AGENT_ID,
    query: QUERY,
  });
  const ms = Date.now() - t0;
  console.log(`[result] elapsed=${ms}ms`);
  console.log(JSON.stringify(result, null, 2).slice(0, 6000));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
