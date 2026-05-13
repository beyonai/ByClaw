import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaiyingExecutor } from "../src/executor/executor.js";
import { resolveBundledBaiyingResourcesDir } from "../src/plugin-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const TOOLKIT_ID = process.argv[2] ?? "10001395";
const RESOURCE_ID = process.argv[3] ?? "10000129";
const UPLOAD_FILE = path.resolve(process.argv[4] ?? path.join(repoRoot, "README.md"));
const FILE_PATH_IN_KB = process.argv[5] ?? "/README.md";

function mustRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const resourcesDir = resolveBundledBaiyingResourcesDir();
  const executor = new BaiyingExecutor({ resourcesDir });

  console.log(`[config] resourcesDir=${resourcesDir}`);
  console.log(`[config] toolkitId=${TOOLKIT_ID} resourceId=${RESOURCE_ID}`);
  console.log(`[config] uploadFile=${UPLOAD_FILE}`);
  console.log(`[config] filePath=${FILE_PATH_IN_KB}`);

  const desc = await executor.describe({
    capabilityId: TOOLKIT_ID,
    resourceType: "TOOLKIT",
  });
  if (!desc.success) {
    console.error("[describe:error]", JSON.stringify(desc, null, 2));
    process.exitCode = 1;
    return;
  }

  const actions = Array.isArray(mustRecord(desc.data).actions) ? (mustRecord(desc.data).actions as unknown[]) : [];
  const uploadAction = actions
    .map((item) => mustRecord(item))
    .find((action) => String(action.url ?? "").includes("/knowledgeItems/importByResourceId"));

  if (!uploadAction) {
    console.error("[error] 未找到上传 action（url 包含 /knowledgeItems/importByResourceId）");
    console.error("[actions]", JSON.stringify(actions, null, 2));
    process.exitCode = 1;
    return;
  }

  const actionName = String(uploadAction.name ?? "");
  if (!actionName) {
    console.error("[error] 上传 action 缺少 name");
    process.exitCode = 1;
    return;
  }
  console.log(`[action] name=${actionName} url=${String(uploadAction.url ?? "")}`);

  const result = await executor.execute({
    capabilityId: TOOLKIT_ID,
    resourceType: "TOOLKIT",
    action: actionName,
    payload: {
      parameters: {
        resourceId: RESOURCE_ID,
        filePath: FILE_PATH_IN_KB,
        fileDescription: "uploaded by test-toolkit-upload.ts",
        fileContent: UPLOAD_FILE,
      },
    },
  });

  console.log("[result]");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
