/**
 * One-shot AGENT execute from local snapshot JSON.
 *
 * Run (from this package root):
 *   pnpm exec tsx scripts/test-agent-one-shot.ts [agentNumericId] [query...]
 *
 * Example:
 *   pnpm exec tsx scripts/test-agent-one-shot.ts 10036261 "鲸智智能体平台是什么？"
 *
 * OpenClaw 插件默认与脚本一致：使用扩展包内 `resources/`（见 `index.ts` + `plugin-paths.ts`）。
 * 可选：指定其它快照根目录（例如独立同步目录）：
 *   BAIYING_RESOURCES_DIR=/path/to/resources pnpm exec tsx scripts/test-agent-one-shot.ts …
 */

import path from "node:path";
import { BaiyingExecutor } from "../src/executor/executor.js";
import { isRecord } from "../src/executor/types.js";
import { resolveBundledBaiyingResourcesDir } from "../src/plugin-paths.js";

function resolveResourcesDir(): string {
  const fromEnv = process.env.BAIYING_RESOURCES_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return resolveBundledBaiyingResourcesDir();
}

const RESOURCES_DIR = resolveResourcesDir();

const AGENT_ID = process.argv[2] ?? "10036261";
const QUERY =
  process.argv.slice(3).join(" ").trim() || "鲸智智能体平台是什么？";

async function main(): Promise<void> {
  const executor = new BaiyingExecutor({ resourcesDir: RESOURCES_DIR });
  const t0 = Date.now();
  const result = await executor.execute({
    capabilityId: AGENT_ID,
    resourceType: "AGENT",
    payload: { query: QUERY },
  });
  const ms = Date.now() - t0;
  console.log(`[config] resourcesDir=${RESOURCES_DIR}`);
  if (process.env.BAIYING_RESOURCES_DIR?.trim()) {
    console.log("[config] source=BAIYING_RESOURCES_DIR");
  } else {
    console.log("[config] source=resolveBundledBaiyingResourcesDir() (extension resources/)");
  }
  console.log(`[config] agent_id=${AGENT_ID} query=${JSON.stringify(QUERY)}`);
  console.log(`[result] elapsed=${ms}ms success=${result.success}`);
  if (!result.success) {
    console.log(`[error] ${JSON.stringify(result, null, 2)}`);
    process.exitCode = 1;
    return;
  }
  const data = isRecord(result.data) ? result.data : {};
  const content = typeof data.content === "string" ? data.content : "";
  console.log(`[answer]\n${content || "<empty>"}`);
  const events = data.events;
  if (Array.isArray(events)) {
    console.log(`[meta] sse_events=${events.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
