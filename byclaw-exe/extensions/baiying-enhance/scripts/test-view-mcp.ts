/**
 * End-to-end smoke test for a VIEW resource via the MCP path.
 *
 * Target view:  10036113  (resourceCode: `scene_enterprise_analysis21`,
 *               resourceName: `ads分析联合视图2`)
 * Query:        `亦庄各类级别企业的分布情况`
 *
 * What this exercises:
 *   1. `BaiyingExecutor.execute()` for a VIEW resource that does NOT have a
 *      local snapshot file — i.e. it has to fall through to
 *      `buildDirectCapabilityStub` and then pick up the MCP URL from the
 *      datacloud service-discovery key `byai_gateway:sd:instances:byclaw-datacloud`.
 *   2. Ontology headers (`x-tool-list-mode=per_object`, `x-view-id=<code>`).
 *   3. The live MCP handshake: `initialize` → `notifications/initialized` →
 *      `tools/list` → `tools/call` (typically the tool is
 *      `unified_data_query`, see `byclaw-data/tests/test_mcp_tools_list_headers.py`).
 *
 * Prereqs:
 *   - Redis reachable (`REDIS_*` env vars; see `readRedisConfig()` in doc-shared).
 *   - The datacloud-data-service instance is registered under the key above.
 *
 * Run:
 *   pnpm tsx scripts/test-view-mcp.ts
 */

import { BaiyingExecutor } from "../src/executor/executor.js";
import {
  resetDatacloudMcpUrlCache,
  resolveDatacloudMcpServerUrl,
} from "../src/executor/datacloud-mcp-url.js";
import { isRecord } from "../src/executor/types.js";

const VIEW_ID = "10036113";
const VIEW_RESOURCE_CODE = "scene_enterprise_analysis21";
const VIEW_NAME = "ads分析联合视图2";
const QUERY = "亦庄各类级别企业的分布情况";

// Identity headers the ontology layer sets via env (mirrors how the runtime
// agent is configured). USER_CODE / BAIYING_SESSION feed X-User-Id / X-Session-Id.
if (!process.env.USER_CODE) process.env.USER_CODE = "0027024710";
if (!process.env.BAIYING_SESSION) process.env.BAIYING_SESSION = "view-mcp-smoke";

// Default resources dir — the VIEW has no local snapshot so this mostly
// serves to let BaiyingExecutor initialise without warnings.
const RESOURCES_DIR = new URL("../resources/", import.meta.url).pathname;

function preview(text: string, max = 1200): string {
  if (!text) return "<empty>";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…(+${trimmed.length - max}chars)` : trimmed;
}

async function checkDatacloudUrl(): Promise<string> {
  console.log("[sd] probing Redis for datacloud MCP URL…");
  resetDatacloudMcpUrlCache();
  const url = await resolveDatacloudMcpServerUrl({ force: true });
  if (url) {
    console.log(`[sd] datacloud MCP URL = ${url}`);
  } else {
    console.log(
      "[sd] ✘ datacloud MCP URL lookup returned empty. " +
        "Check Redis connectivity and `byai_gateway:sd:instances:byclaw-datacloud`.",
    );
  }
  return url;
}

async function runOnce(action?: string): Promise<void> {
  const label = action ? `execute(${action})` : "execute(auto-pick-tool)";
  console.log(`\n======== ${label} ========`);
  const executor = new BaiyingExecutor({ resourcesDir: RESOURCES_DIR });
  const t0 = Date.now();
  const result = await executor.execute({
    capabilityId: VIEW_ID,
    resourceType: "VIEW",
    action,
    payload: {
      // Tool arguments. `unified_data_query` on the datacloud MCP requires
      // `question` (natural-language query). We pass it through `parameters`
      // (the canonical key used by `extractBackendParameters`).
      parameters: {
        question: QUERY,
      },
      // Inject the resourceCode into selected_resource so that
      // buildDirectCapabilityStub can populate mcp.resource_code →
      // buildOntologyMcpHeaders() → header `x-view-id` = <code>.
      resource_context: {
        selected_resource: {
          resourceId: VIEW_ID,
          resourceName: VIEW_NAME,
          resourceBizType: "VIEW",
          resourceCode: VIEW_RESOURCE_CODE,
          resourceDesc: "企业分析联合视图（测试用）",
        },
        openclaw_mcp_headers: {
          "X-Session-Id": process.env.BAIYING_SESSION,
          "X-User-Id": process.env.USER_CODE,
        },
      },
    },
  });

  const elapsed = Date.now() - t0;
  console.log(`[result] elapsed=${elapsed}ms success=${result.success}`);
  if (!result.success) {
    console.log(`[result] error_code=${(result as { error_code?: string }).error_code}`);
    console.log(`[result] error=${(result as { error?: string }).error}`);
    const details = (result as { details?: unknown }).details;
    if (details !== undefined) {
      console.log(`[result] details=${preview(String(details), 600)}`);
    }
    const liveErr = (result as { live_discovery_error?: unknown }).live_discovery_error;
    if (liveErr !== undefined) {
      console.log(`[result] live_discovery_error=${JSON.stringify(liveErr)}`);
    }
    return;
  }

  const data = (result as { data?: unknown }).data;
  const target = (result as { target?: unknown }).target;
  console.log(`[result] target=${JSON.stringify(target)}`);
  // MCP tools/call result is typically `{ content: [{ type: "text", text: ... }], isError?: bool }`
  if (isRecord(data)) {
    const content = (data as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const [i, item] of content.entries()) {
        if (!isRecord(item)) continue;
        const type = String(item.type ?? "");
        const text = typeof item.text === "string" ? item.text : "";
        const json =
          item.type === "json" && item.data !== undefined
            ? JSON.stringify(item.data)
            : "";
        console.log(
          `[result] content[${i}] type=${type} preview=${preview(text || json, 800)}`,
        );
      }
    } else {
      console.log(`[result] data=${preview(JSON.stringify(data), 1500)}`);
    }
  } else {
    console.log(`[result] data=${preview(String(data), 1500)}`);
  }
}

async function describeOnce(): Promise<void> {
  console.log("\n======== describe(VIEW 10036113) ========");
  const executor = new BaiyingExecutor({ resourcesDir: RESOURCES_DIR });
  const t0 = Date.now();
  const result = await executor.describe({
    capabilityId: VIEW_ID,
    resourceType: "VIEW",
    payload: {
      resource_context: {
        selected_resource: {
          resourceId: VIEW_ID,
          resourceName: VIEW_NAME,
          resourceBizType: "VIEW",
          resourceCode: VIEW_RESOURCE_CODE,
          resourceDesc: "企业分析联合视图（测试用）",
        },
      },
    },
  });
  console.log(`[describe] elapsed=${Date.now() - t0}ms success=${result.success}`);
  if (!result.success) {
    console.log(`[describe] error_code=${(result as { error_code?: string }).error_code}`);
    console.log(`[describe] error=${(result as { error?: string }).error}`);
    return;
  }
  const data = (result as { data?: unknown }).data;
  if (isRecord(data)) {
    const resource = (data as { resource?: unknown }).resource;
    const actions = (data as { actions?: unknown }).actions;
    console.log(`[describe] resource=${JSON.stringify(resource)}`);
    if (Array.isArray(actions)) {
      console.log(`[describe] actions (${actions.length}):`);
      for (const a of actions) {
        if (!isRecord(a)) continue;
        console.log(
          `  - ${String(a.name)}  required=${JSON.stringify(a.required_fields)}  ` +
            `desc=${preview(String(a.description ?? ""), 120)}`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `[config] view_id=${VIEW_ID} resource_code=${VIEW_RESOURCE_CODE} ` +
      `query=${JSON.stringify(QUERY)}`,
  );
  console.log(
    `[config] redis=${process.env.REDIS_HOST ?? "(default 10.10.168.204)"}:${process.env.REDIS_PORT ?? "6379"} ` +
      `user_code=${process.env.USER_CODE} baiying_session=${process.env.BAIYING_SESSION}`,
  );

  const datacloudUrl = await checkDatacloudUrl();
  if (!datacloudUrl) {
    console.log(
      "\n[warn] no datacloud URL discovered — executor will still try, but expect " +
        "MCP_SERVER_NOT_FOUND unless mcpServerUrl is injected another way.",
    );
  }

  await describeOnce();
  // The real tool name is discovered live via tools/list (commonly
  // `unified_data_query`). Letting `action` default means the executor
  // picks the single tool if there's exactly one, or errors out with a
  // list — either outcome is informative for smoke testing.
  await runOnce();
}

main()
  .then(() => {
    console.log("\n✔ view-mcp smoke test finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✘ view-mcp smoke test failed:", err);
    process.exit(1);
  });
