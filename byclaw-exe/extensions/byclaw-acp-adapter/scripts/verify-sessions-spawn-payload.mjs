#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { ACP, DEFAULTS, PACKAGE, PATHS } from "./constants.mjs";
import { fixture } from "../tests/fixtures/sessions-spawn-payload.fixture.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(rootDir, ".tmp", "test-bundles");
const workspaceRoot = path.join(os.tmpdir(), "byclaw-acp-adapter-sessions-spawn-payload");
const FIXTURE_LINKED_SKILL_ID = "910001";
const SESSION_FILES_ROOT = "/by/.sessions";

function selectedKinds() {
  const explicit = process.argv.find((arg) => arg.startsWith("--kinds="));
  if (!explicit) {
    return null;
  }
  return new Set(
    explicit
      .slice("--kinds=".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findAgent(snapshot, id) {
  const agent = snapshot.agents.find((item) => item.id === id);
  assert.ok(agent, `fixture agent ${id} was not found`);
  return agent;
}

function expectedLinkedSkill(skill) {
  const skillPath = skill.skillPath;
  const skillDocPath = skill.skillDocObjectKey || (skillPath ? path.join(skillPath, "SKILL.md") : undefined);
  return {
    id: skill.id,
    name: skill.name,
    code: skill.code,
    description: skill.description,
    skillPath,
    skillDocPath,
    skillDocObjectKey: skillDocPath,
    skillType: skill.skillType,
    pathResolution: {
      source: "skillPath",
      exists: false,
      skillDocExists: false,
    },
  };
}

function assertAgentModelMaps(params) {
  const { plan, expectedAgentIds, snapshot, agentModels } = params;

  assert.ok(agentModels, `${plan.kind} bundle.agentModels is missing`);
  assert.equal(agentModels.version, 1, `${plan.kind} agentModels.version mismatch`);
  assert.equal(
    agentModels.runtime,
    ACP.nativeSubagentsRuntime,
    `${plan.kind} agentModels.runtime mismatch`,
  );
  assert.ok(Array.isArray(agentModels.agents), `${plan.kind} agentModels.agents is not an array`);
  assert.equal(
    agentModels.agents.length,
    expectedAgentIds.length,
    `${plan.kind} agentModels.agents length mismatch`,
  );

  for (const agentId of expectedAgentIds) {
    const expected = findAgent(snapshot, agentId);
    const byId = agentModels.byByclawAgentId?.[agentId];
    assert.ok(byId, `${plan.kind} agentModels.byByclawAgentId.${agentId} is missing`);

    const listItem = agentModels.agents.find((item) => item.byclawAgentId === agentId);
    assert.ok(listItem, `${plan.kind} agentModels.agents entry for ${agentId} is missing`);
    assert.ok(listItem.modelConfig, `${plan.kind} agents entry ${agentId}.modelConfig is missing`);
    assert.equal(
      listItem.modelConfig.modelName,
      expected.modelConfig.modelName,
      `${plan.kind} agents entry ${agentId}.modelConfig.modelName mismatch`,
    );
    assert.equal(
      listItem.modelConfig.providerApi,
      expected.modelConfig.providerApi,
      `${plan.kind} agents entry ${agentId}.modelConfig.providerApi mismatch`,
    );
    assert.equal(
      listItem.modelConfig.baseUrl,
      expected.modelConfig.baseUrl,
      `${plan.kind} agents entry ${agentId}.modelConfig.baseUrl mismatch`,
    );
    assert.equal(listItem.model, expected.model, `${plan.kind} agents entry ${agentId}.model mismatch`);
    assert.deepEqual(
      listItem.linkedSkills ?? [],
      (expected.linkedSkills ?? []).map(expectedLinkedSkill),
      `${plan.kind} agents entry ${agentId}.linkedSkills mismatch`,
    );

    const byNative = agentModels.byNativeSubagentId?.[listItem.nativeSubagentId];
    assert.ok(
      byNative,
      `${plan.kind} agentModels.byNativeSubagentId.${listItem.nativeSubagentId} is missing`,
    );
    assert.equal(
      byNative.byclawAgentId,
      agentId,
      `${plan.kind} byNativeSubagentId.${listItem.nativeSubagentId}.byclawAgentId mismatch`,
    );
  }
}

function assertSessionsSpawnPayload(params) {
  const { plan, testCase, snapshot } = params;
  const payload = plan.sessionsSpawn;
  const coordinator = findAgent(snapshot, testCase.expectedCoordinatorId);
  const expectedAcpAgentId = testCase.expectedAcpAgentId ?? coordinator.acpAgentId;
  const bundlePath = payload.bundle?.path;
  assert.equal(
    plan.kind,
    testCase.expectedKind || testCase.request.kind,
    `${testCase.name} plan.kind mismatch`,
  );
  assert.equal(plan.id, testCase.expectedId || testCase.request.id, `${testCase.name} plan.id mismatch`);
  assert.ok(bundlePath, `${testCase.name} sessionsSpawn.bundle.path is missing`);
  assert.ok(fs.existsSync(bundlePath), `${testCase.name} bundle file does not exist`);
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const agentModels = bundle.agentModels;
  const sharedContext = bundle.sharedContext;
  const bootstrapContractPath = sharedContext.bootstrapContractPath;
  const expectedReplyLanguage = testCase.request.replyLanguage ?? testCase.request.language ?? "zh_CN";
  const expectedByaiSessionId = testCase.request.sessionId;
  const expectedSessionRoot = `${SESSION_FILES_ROOT}/${expectedByaiSessionId}`;
  const expectedClientType = testCase.expectedClientType ?? fixture.config.defaultAcpClientType;
  const expectedClientDirName =
    expectedClientType === "codex" ? PATHS.clientDirNames.codex : PATHS.clientDirNames.claudeCode;

  assert.equal(payload.runtime, ACP.runtime, `${testCase.name} sessionsSpawn.runtime mismatch`);
  assert.equal(payload.agentId, expectedAcpAgentId, `${testCase.name} sessionsSpawn.agentId mismatch`);
  assert.equal(payload.streamTo, ACP.streamTo, `${testCase.name} sessionsSpawn.streamTo mismatch`);
  assert.equal(payload.mode, ACP.mode, `${testCase.name} sessionsSpawn.mode mismatch`);
  assert.equal(payload.model, coordinator.model, `${testCase.name} sessionsSpawn.model mismatch`);
  assert.equal(
    payload.modelConfig?.modelName,
    coordinator.modelConfig.modelName,
    `${testCase.name} sessionsSpawn.modelConfig.modelName mismatch`,
  );
  assert.equal(
    payload.modelConfig?.providerApi,
    coordinator.modelConfig.providerApi,
    `${testCase.name} sessionsSpawn.modelConfig.providerApi mismatch`,
  );
  assert.equal(
    payload.agentModels,
    undefined,
    `${testCase.name} sessionsSpawn.agentModels should be stored in the shared bundle file`,
  );
  assert.equal(plan.replyLanguage, expectedReplyLanguage, `${testCase.name} plan.replyLanguage mismatch`);
  assert.equal(
    bundle.responseLanguage?.language,
    expectedReplyLanguage,
    `${testCase.name} bundle.responseLanguage.language mismatch`,
  );
  assert.equal(bundle.sessionId, expectedByaiSessionId, `${testCase.name} bundle.sessionId mismatch`);
  assert.equal(
    bundle.byaiChannelSessionId,
    expectedByaiSessionId,
    `${testCase.name} bundle.byaiChannelSessionId mismatch`,
  );
  assert.equal(
    bundle.fixedWorkSpecs?.sessionFiles?.byaiChannelSessionId,
    expectedByaiSessionId,
    `${testCase.name} fixedWorkSpecs byaiChannelSessionId mismatch`,
  );
  assert.equal(
    bundle.fixedWorkSpecs?.sessionFiles?.sessionRoot,
    expectedSessionRoot,
    `${testCase.name} fixedWorkSpecs sessionRoot mismatch`,
  );
  assert.equal(
    plan.metadata.responseLanguage?.language,
    expectedReplyLanguage,
    `${testCase.name} metadata.responseLanguage.language mismatch`,
  );
  assert.equal(
    plan.metadata.fixedWorkSpecs?.sessionFiles?.sessionRoot,
    expectedSessionRoot,
    `${testCase.name} metadata fixedWorkSpecs sessionRoot mismatch`,
  );
  assert.ok(sharedContext, `${testCase.name} bundle.sharedContext is missing`);
  assert.ok(sharedContext.bootstrapId, `${testCase.name} sharedContext.bootstrapId is missing`);
  assert.ok(sharedContext.runDir, `${testCase.name} sharedContext.runDir is missing`);
  assert.ok(
    sharedContext.runDir.startsWith(path.join(sharedContext.sharedDir, "runs")),
    `${testCase.name} runDir must be isolated below sharedDir/runs`,
  );
  assert.ok(bootstrapContractPath, `${testCase.name} bootstrap contract path is missing`);
  assert.ok(fs.existsSync(bootstrapContractPath), `${testCase.name} bootstrap contract is missing`);
  assert.ok(
    sharedContext.bootstrapReceiptPath.startsWith(sharedContext.runDir),
    `${testCase.name} bootstrap receipt must be scoped to runDir`,
  );
  assert.equal(bundle.clientType, expectedClientType, `${testCase.name} clientType mismatch`);
  assert.equal(sharedContext.sessionId, expectedByaiSessionId, `${testCase.name} sharedContext.sessionId mismatch`);
  assert.equal(
    sharedContext.byaiChannelSessionId,
    expectedByaiSessionId,
    `${testCase.name} sharedContext.byaiChannelSessionId mismatch`,
  );
  assert.equal(
    sharedContext.sessionFilesRoot,
    expectedSessionRoot,
    `${testCase.name} sharedContext.sessionFilesRoot mismatch`,
  );
  assert.ok(fs.existsSync(sharedContext.queryPath), `${testCase.name} query.md is missing`);
  assert.ok(fs.existsSync(sharedContext.metadataPath), `${testCase.name} metadata.md is missing`);
  assert.ok(
    fs.existsSync(sharedContext.clientInstructionsPath),
    `${testCase.name} client instructions are missing`,
  );
  assert.equal(sharedContext.bundlePath, bundlePath, `${testCase.name} sharedContext.bundlePath mismatch`);
  assert.ok(
    sharedContext.sharedDir.includes(
      path.join(PATHS.byclawDir, PATHS.acpRunsDir, expectedClientDirName),
    ),
    `${testCase.name} shared directory should use .byclaw/acp-runs/${expectedClientDirName}`,
  );
  assert.ok(
    sharedContext.sharedDir.endsWith(
      path.join(PATHS.byclawDir, PATHS.acpRunsDir, expectedClientDirName, expectedByaiSessionId),
    ),
    `${testCase.name} shared directory should end with the byai-channel session id`,
  );
  assert.match(payload.task, /query\.md/u, `${testCase.name} task should point to query.md`);
  assert.match(payload.task, /metadata\.md/u, `${testCase.name} task should point to metadata.md`);
  assert.match(payload.task, /clientInstructions/u, `${testCase.name} task should point to client instructions`);
  assert.match(payload.task, /回复语言: zh_CN/u, `${testCase.name} task should include reply language`);
  assert.match(
    payload.task,
    new RegExp(`byaiChannelSessionId: ${expectedByaiSessionId}`, "u"),
    `${testCase.name} task should include byai-channel session id`,
  );
  assert.match(
    payload.task,
    new RegExp(expectedSessionRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    `${testCase.name} task should include session files root`,
  );
  const metadata = fs.readFileSync(sharedContext.metadataPath, "utf8");
  const query = fs.readFileSync(sharedContext.queryPath, "utf8");
  const clientInstructions = fs.readFileSync(sharedContext.clientInstructionsPath, "utf8");
  const bootstrapContract = JSON.parse(fs.readFileSync(bootstrapContractPath, "utf8"));
  assert.equal(bootstrapContract.bootstrapId, sharedContext.bootstrapId);
  assert.equal(bootstrapContract.runDir, sharedContext.runDir);
  assert.equal(bootstrapContract.metadata.path, sharedContext.metadataPath);
  assert.equal(bootstrapContract.metadata.bytes, Buffer.byteLength(metadata));
  assert.equal(
    bootstrapContract.metadata.sha256,
    createHash("sha256").update(metadata, "utf8").digest("hex"),
    `${testCase.name} metadata sha256 mismatch`,
  );
  assert.equal(bootstrapContract.metadata.readMode, "complete-to-eof");
  assert.equal(bootstrapContract.query.readAfterBootstrap, true);
  assert.equal(bootstrapContract.receipt.requiredStatus, "READY");
  assert.match(query, /Reply language: zh_CN/u, `${testCase.name} query should include reply language`);
  assert.match(metadata, /responseLanguage/u, `${testCase.name} metadata should include responseLanguage`);
  assert.match(metadata, /Fixed Work Specs/u, `${testCase.name} metadata should include fixed work specs`);
  assert.match(metadata, /Session Files/u, `${testCase.name} metadata should include Session Files policy`);
  assert.match(
    metadata,
    new RegExp(expectedSessionRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    `${testCase.name} metadata should include session files root`,
  );
  assert.match(
    clientInstructions,
    /Reply language: zh_CN/u,
    `${testCase.name} client instructions should include reply language`,
  );
  assert.match(
    clientInstructions,
    /Fixed Work Specs/u,
    `${testCase.name} client instructions should include fixed work specs`,
  );
  assert.match(
    clientInstructions,
    new RegExp(expectedSessionRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    `${testCase.name} client instructions should include session files root`,
  );
  assert.match(metadata, /linkedSkills/u, `${testCase.name} metadata should include mounted linkedSkills`);
  const expectedLinkedSkillCount = testCase.expectedAgentIds.reduce(
    (count, agentId) => count + (findAgent(snapshot, agentId).linkedSkills?.length ?? 0),
    0,
  );
  assert.equal(bundle.linkedSkills.length, expectedLinkedSkillCount, `${testCase.name} linkedSkills count mismatch`);
  if (expectedLinkedSkillCount > 0) {
    assert.match(metadata, /skillDocPath/u, `${testCase.name} metadata should include absolute skillDocPath`);
  } else {
    assert.doesNotMatch(metadata, /"skillDocPath"/u, `${testCase.name} metadata must not invent skillDocPath`);
  }
  assert.match(
    metadata,
    /Every Linked Skill[^\n]*mandatory bootstrap input/iu,
    `${testCase.name} metadata should make every Linked Skill mandatory bootstrap input`,
  );
  assert.match(
    metadata,
    /Do not copy, install, symlink, or materialize[^\n]*public[^\n]*skill directories/iu,
    `${testCase.name} metadata should forbid public skill-directory materialization`,
  );
  assert.match(
    clientInstructions,
    /every Linked Skill[^\n]*skillDocPath[^\n]*EOF/iu,
    `${testCase.name} client instructions should load every Linked Skill from skillDocPath to EOF`,
  );
  assert.match(
    clientInstructions,
    /Do not copy, install, symlink, or materialize[^\n]*public[^\n]*skill directories/iu,
    `${testCase.name} client instructions should forbid public skill-directory materialization`,
  );
  for (const publicSkillDir of [".claude/skills", ".agents/skills", ".codex/skills"]) {
    assert.match(metadata, new RegExp(publicSkillDir.replace(".", "\\."), "u"));
    assert.match(clientInstructions, new RegExp(publicSkillDir.replace(".", "\\."), "u"));
  }
  assert.match(
    clientInstructions,
    /apply every loaded Linked Skill[^\n]*trigger conditions[^\n]*does not count as using/iu,
    `${testCase.name} client instructions should require actual use of triggered Linked Skills`,
  );
  if (expectedClientType === "codex") {
    assert.match(clientInstructions, /## Codex/u, `${testCase.name} should use Codex instructions`);
    assert.match(clientInstructions, /\.agents\/skills/u);
    assert.match(clientInstructions, /\.codex\/skills/u);
  } else {
    assert.match(clientInstructions, /## Claude Code/u, `${testCase.name} should use Claude Code instructions`);
    assert.match(clientInstructions, /\.claude\/skills/u);
  }
  if (testCase.expectedAgentIds.includes("900002")) {
    assert.ok(
      bundle.linkedSkills.some((skill) => skill.id === FIXTURE_LINKED_SKILL_ID),
      `${testCase.name} bundle.linkedSkills should include fixture skill ${FIXTURE_LINKED_SKILL_ID}`,
    );
  }
  for (const agentId of testCase.expectedAgentIds) {
    assert.match(metadata, new RegExp(`"byclawAgentId":\\s*"${agentId}"`, "u"));
  }
  assert.deepEqual(
    plan.metadata.agentModels,
    agentModels,
    `${testCase.name} metadata.agentModels and bundle.agentModels diverged`,
  );
  assertAgentModelMaps({
    plan,
    expectedAgentIds: testCase.expectedAgentIds,
    snapshot,
    agentModels,
  });
}

async function loadPlanner() {
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  const outfile = path.join(bundleDir, "planner.bundle.mjs");
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "planner.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: PACKAGE.nodeTarget,
    packages: "external",
    logLevel: "silent",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function loadMetadataBootstrap() {
  const entryPoint = path.join(rootDir, "src", "metadata-bootstrap.ts");
  assert.ok(fs.existsSync(entryPoint), "metadata bootstrap module is missing");
  const outfile = path.join(bundleDir, "metadata-bootstrap.bundle.mjs");
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: PACKAGE.nodeTarget,
    packages: "external",
    logLevel: "silent",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function loadCallAcpAgentTool() {
  const outfile = path.join(bundleDir, "call-acp-agent-tool.bundle.mjs");
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "call-acp-agent-tool.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: PACKAGE.nodeTarget,
    packages: "external",
    logLevel: "silent",
    plugins: [
      {
        name: "openclaw-routing-test-stub",
        setup(build) {
          build.onResolve({ filter: /^openclaw\/plugin-sdk\/routing$/ }, () => ({
            path: "openclaw-routing-test-stub",
            namespace: "byclaw-test",
          }));
          build.onLoad({ filter: /.*/, namespace: "byclaw-test" }, () => ({
            contents: "export function isSubagentSessionKey() { return false; }",
          }));
        },
      },
    ],
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function assertCallAcpAgentToolFailsClosed(snapshot) {
  const { createByclawCallAcpAgentTool } = await loadCallAcpAgentTool();
  let executorCallCount = 0;
  const environmentKeys = [
    "USER_CODE",
    "LANGFUSE_BASE_URL",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "OPENCLAW_STATE_DIR",
  ];
  const savedEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.USER_CODE = "metadata-bootstrap-test";
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  process.env.OPENCLAW_STATE_DIR = "/dev/null/openclaw-state";
  try {
    const config = {
      ...jsonClone(fixture.config),
      defaultCwd: path.join(workspaceRoot, "call-tool-fail-closed"),
      sqlitePath: path.join(workspaceRoot, "call-tool-fail-closed", "state.sqlite"),
    };
    const tool = createByclawCallAcpAgentTool({
      config,
      registry: {
        snapshot: async () => jsonClone(snapshot),
      },
      executeViaCallAgent: async () => {
        executorCallCount += 1;
        return { success: true };
      },
    })({
      sessionKey: "agent:main:metadata-bootstrap-test",
      channelSessionId: "metadata-bootstrap-test-session",
      channelTraceId: "a".repeat(32),
      langfuseParentObservationId: "b".repeat(16),
    });
    const result = await tool.execute("metadata-bootstrap-test-call", {
      kind: "agent",
      id: "900002",
      input: "protected query",
    });
    assert.equal(result.error_code, "ACP_METADATA_BOOTSTRAP_INVALID");
    assert.match(result.error, /metadata bootstrap materialization failed/iu);
    assert.equal(executorCallCount, 0, "bootstrap failure must not call the remote executor");
  } finally {
    for (const key of environmentKeys) {
      const value = savedEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function assertCallAcpAgentToolDispatchesBootstrap(snapshot) {
  const { createByclawCallAcpAgentTool } = await loadCallAcpAgentTool();
  let executorInput;
  const environmentKeys = [
    "USER_CODE",
    "LANGFUSE_BASE_URL",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "OPENCLAW_STATE_DIR",
  ];
  const savedEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const defaultCwd = path.join(workspaceRoot, "call-tool-success");
  process.env.USER_CODE = "metadata-bootstrap-success-test";
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  process.env.OPENCLAW_STATE_DIR = path.join(defaultCwd, ".openclaw");
  try {
    const config = {
      ...jsonClone(fixture.config),
      defaultCwd,
      sqlitePath: path.join(defaultCwd, "state.sqlite"),
    };
    const tool = createByclawCallAcpAgentTool({
      config,
      registry: {
        snapshot: async () => jsonClone(snapshot),
      },
      executeViaCallAgent: async (input) => {
        executorInput = input;
        return { success: true };
      },
    })({
      sessionKey: "agent:main:metadata-bootstrap-success-test",
      channelSessionId: "metadata-bootstrap-success-session",
      channelTraceId: "c".repeat(32),
      langfuseParentObservationId: "d".repeat(16),
    });
    const result = await tool.execute("metadata-bootstrap-success-call", {
      kind: "agent",
      id: "900002",
      input: "protected query",
    });
    assert.equal(result.success, true);
    assert.ok(executorInput, "successful call_acp_agent must invoke the remote executor");
    assert.equal(executorInput.payload.cwd, defaultCwd, "call_acp_agent must preserve the planned cwd");
    assert.match(executorInput.content, /every Linked Skill[^\n]*skillDocPath[^\n]*EOF/iu);
    assert.match(executorInput.content, /\.claude\/skills/u);
    assert.match(executorInput.content, /\.agents\/skills/u);
    assert.match(executorInput.content, /\.codex\/skills/u);
    assert.ok(
      executorInput.content.search(/every Linked Skill[^\n]*skillDocPath[^\n]*EOF/iu) <
        executorInput.content.indexOf("<USER_QUERY_ACCESS>"),
      "call_acp_agent must send Linked Skills bootstrap before query access",
    );
  } finally {
    for (const key of environmentKeys) {
      const value = savedEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function assertMetadataBootstrapProtocol() {
  const {
    createMetadataBootstrapContract,
    loadMetadataBootstrapContract,
    metadataBootstrapFailureResponse,
    renderMetadataFirstDelegationContent,
    validateMetadataBootstrapContract,
  } = await loadMetadataBootstrap();
  const runDir = path.join(workspaceRoot, "runs", "metadata-bootstrap-protocol");
  const clientsDir = path.join(runDir, "clients");
  const metadataPath = path.join(runDir, "metadata.md");
  const queryPath = path.join(runDir, "query.md");
  const clientInstructionsPath = path.join(clientsDir, "claude-code.md");
  const planBundlePath = path.join(runDir, "plan-bundle.json");
  const receiptPath = path.join(runDir, "bootstrap-receipt.json");
  const metadataContent = [
    "# ByClaw ACP Metadata",
    "",
    "## Future Business Rule",
    "",
    "This heading is intentionally unknown to the adapter and must remain authoritative.",
    "",
  ].join("\n");
  fs.mkdirSync(clientsDir, { recursive: true });
  fs.writeFileSync(metadataPath, metadataContent, "utf8");
  fs.writeFileSync(queryPath, "# Query\n\nprivate user query\n", "utf8");
  fs.writeFileSync(clientInstructionsPath, "# Client Instructions\n", "utf8");
  fs.writeFileSync(planBundlePath, '{"fixture":true}\n', "utf8");

  const contract = createMetadataBootstrapContract({
    bootstrapId: path.basename(runDir),
    runDir,
    metadataPath,
    metadataContent,
    clientInstructionsPath,
    queryPath,
    planBundlePath,
    receiptPath,
  });
  assert.equal(contract.policy, "fail-closed");
  assert.equal(contract.metadata.readMode, "complete-to-eof");
  assert.equal(contract.metadata.bytes, Buffer.byteLength(metadataContent));
  assert.equal(contract.metadata.sha256.length, 64);
  assert.equal(contract.query.readAfterBootstrap, true);
  assert.equal(contract.planBundle.path, planBundlePath);
  assert.equal(contract.planBundle.required, true);
  assert.equal(contract.receipt.requiredStatus, "READY");
  assert.doesNotThrow(() => validateMetadataBootstrapContract(contract));
  const contractPath = path.join(runDir, "bootstrap-contract.json");
  fs.writeFileSync(contractPath, JSON.stringify(contract), "utf8");
  assert.equal(loadMetadataBootstrapContract(contractPath).contract.bootstrapId, contract.bootstrapId);
  const outsideContractPath = path.join(workspaceRoot, "outside-bootstrap-contract.json");
  fs.writeFileSync(outsideContractPath, JSON.stringify(contract), "utf8");
  assert.throws(
    () => loadMetadataBootstrapContract(outsideContractPath),
    /contract.*runDir/iu,
    "bootstrap contract file must be inside its declared runDir",
  );
  const tamperedContract = jsonClone(contract);
  tamperedContract.query.readAfterBootstrap = false;
  assert.throws(
    () => validateMetadataBootstrapContract(tamperedContract),
    /query.*bootstrap/iu,
    "runtime contract validation must reject bypassing metadata bootstrap",
  );
  const malformedContract = jsonClone(contract);
  delete malformedContract.metadata;
  assert.throws(
    () => validateMetadataBootstrapContract(malformedContract),
    /contract.*metadata/iu,
    "malformed JSON contracts must fail with a bootstrap validation error",
  );
  const precedenceTamperedContract = jsonClone(contract);
  precedenceTamperedContract.precedence.reverse();
  assert.throws(
    () => validateMetadataBootstrapContract(precedenceTamperedContract),
    /precedence/iu,
    "business-rule precedence must not be mutable",
  );
  const escapedPlanBundleContract = jsonClone(contract);
  escapedPlanBundleContract.planBundle.path = path.join(workspaceRoot, "outside-plan-bundle.json");
  fs.writeFileSync(escapedPlanBundleContract.planBundle.path, "{}\n", "utf8");
  assert.throws(
    () => validateMetadataBootstrapContract(escapedPlanBundleContract),
    /plan bundle.*runDir/iu,
    "plan bundle must stay inside the bootstrap runDir",
  );
  fs.rmSync(planBundlePath);
  assert.throws(
    () => validateMetadataBootstrapContract(contract),
    /plan bundle.*cannot be read/iu,
    "missing plan bundle must block bootstrap validation",
  );
  fs.writeFileSync(planBundlePath, '{"fixture":true}\n', "utf8");

  const content = renderMetadataFirstDelegationContent({ contract, metadataContent });
  assert.match(content, /read[^\n]*EOF/iu);
  assert.match(content, /referenced resources/iu);
  assert.match(content, /bootstrap-receipt\.json/u);
  assert.match(content, /do not read query\.md or plan-bundle\.json/iu);
  assert.match(content, /Future Business Rule/u);
  assert.ok(
    content.indexOf("Future Business Rule") < content.indexOf("<USER_QUERY_ACCESS>"),
    "unknown future metadata rules must appear before query access",
  );
  assert.equal(
    typeof metadataBootstrapFailureResponse,
    "function",
    "call_acp_agent must export its metadata bootstrap fail-closed response helper",
  );
  assert.deepEqual(
    metadataBootstrapFailureResponse({
      error: new Error("metadata digest mismatch"),
      requesterSessionKey: "agent:main:test",
      sessionId: "session-test",
    }),
    {
      success: false,
      error_code: "ACP_METADATA_BOOTSTRAP_INVALID",
      error: "metadata digest mismatch",
      target: {
        requester_session_key: "agent:main:test",
        session_id: "session-test",
      },
    },
  );
}

async function main() {
  assert.equal(
    DEFAULTS.aimodelResolverProtocolVersion,
    1,
    "Baiying aimodel secret resolver currently accepts protocolVersion=1",
  );
  assert.notEqual(
    DEFAULTS.protocolVersion,
    DEFAULTS.aimodelResolverProtocolVersion,
    "Gateway WebSocket protocol version and aimodel resolver protocol version must stay separate",
  );

  const selected = selectedKinds();
  await assertMetadataBootstrapProtocol();
  const { createByclawAcpPlan, buildCallAgentContentFromPlan } = await loadPlanner();
  assert.equal(
    typeof buildCallAgentContentFromPlan,
    "function",
    "planner should export buildCallAgentContentFromPlan for the byclawCallAcpAgent tool",
  );
  const snapshot = jsonClone(fixture.snapshot);
  await assertCallAcpAgentToolFailsClosed(snapshot);
  await assertCallAcpAgentToolDispatchesBootstrap(snapshot);
  const cases = fixture.requestCases.filter((item) => !selected || selected.has(item.name));

  assert.ok(cases.length > 0, "no request cases selected");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const summaries = [];
  for (const testCase of cases) {
    const request = {
      ...testCase.request,
      sessionId: testCase.request.sessionId || `byai-session-${testCase.name}`,
    };
    const effectiveTestCase = {
      ...testCase,
      request,
    };
    const cwd = path.join(workspaceRoot, testCase.name);
    const config = {
      ...jsonClone(fixture.config),
      ...(testCase.config ? jsonClone(testCase.config) : {}),
      defaultCwd: cwd,
      sqlitePath: path.join(cwd, "state.sqlite"),
    };
    const plan = createByclawAcpPlan({
      config,
      snapshot,
      request,
    });
    assertSessionsSpawnPayload({ plan, testCase: effectiveTestCase, snapshot });
    const rawInput = typeof request.input === "string" ? request.input : JSON.stringify(request.input ?? {});
    assert.ok(
      !plan.task.includes(rawInput),
      `${testCase.name} bootstrap task must not expose the raw query before metadata bootstrap`,
    );

    if (testCase.name === "agent") {
      const duplicatePlan = createByclawAcpPlan({ config, snapshot, request });
      const firstBundle = JSON.parse(fs.readFileSync(plan.sessionsSpawn.bundle.path, "utf8"));
      const duplicateBundle = JSON.parse(fs.readFileSync(duplicatePlan.sessionsSpawn.bundle.path, "utf8"));
      assert.notEqual(
        firstBundle.sharedContext.runDir,
        duplicateBundle.sharedContext.runDir,
        "same-session plans must use different immutable run directories",
      );
      assert.ok(
        firstBundle.sharedContext.clientInstructionsPath &&
          fs.readFileSync(firstBundle.sharedContext.clientInstructionsPath, "utf8").indexOf("metadata.md") <
            fs.readFileSync(firstBundle.sharedContext.clientInstructionsPath, "utf8").indexOf("query.md"),
        "client instructions must require metadata before query access",
      );
      const substitutedPlan = jsonClone(plan);
      substitutedPlan.sessionsSpawn.bundle.bootstrapContractPath =
        duplicateBundle.sharedContext.bootstrapContractPath;
      assert.throws(
        () => buildCallAgentContentFromPlan(substitutedPlan),
        /contract.*(runDir|bootstrapId|path)|plan.*contract/iu,
        "call-agent dispatch must reject a self-consistent contract from another run",
      );
    }

    // byclawCallAcpAgent delegation content validates and inlines metadata as
    // an authoritative business-rule manual before it permits query access.
    const callAgentContent = buildCallAgentContentFromPlan(plan);
    assert.notEqual(
      callAgentContent,
      plan.task,
      `${testCase.name} call-agent content should be a metadata-first envelope`,
    );
    assert.match(callAgentContent, /query\.md/u, `${testCase.name} call-agent content should point to query.md`);
    assert.match(
      callAgentContent,
      /metadata\.md/u,
      `${testCase.name} call-agent content should point to metadata.md`,
    );
    assert.match(callAgentContent, /bootstrap-contract\.json/u);
    assert.match(callAgentContent, /bootstrap-receipt\.json/u);
    assert.match(callAgentContent, /complete metadata document/iu);
    assert.match(callAgentContent, /referenced resources/iu);
    assert.match(
      callAgentContent,
      /every Linked Skill[^\n]*skillDocPath[^\n]*EOF/iu,
      `${testCase.name} call-agent content should load every Linked Skill before query access`,
    );
    assert.match(
      callAgentContent,
      /Do not copy, install, symlink, or materialize[^\n]*public[^\n]*skill directories/iu,
      `${testCase.name} call-agent content should forbid public skill-directory materialization`,
    );
    assert.match(
      callAgentContent,
      /apply every loaded Linked Skill[^\n]*trigger conditions[^\n]*does not count as using/iu,
      `${testCase.name} call-agent content should require actual use of triggered Linked Skills`,
    );
    assert.ok(
      callAgentContent.indexOf("<METADATA_BUSINESS_RULE_MANUAL>") <
        callAgentContent.indexOf("<USER_QUERY_ACCESS>"),
      `${testCase.name} metadata manual must precede query access`,
    );
    assert.ok(
      callAgentContent.search(/every Linked Skill[^\n]*skillDocPath[^\n]*EOF/iu) <
        callAgentContent.indexOf("<USER_QUERY_ACCESS>"),
      `${testCase.name} Linked Skills bootstrap must precede query access`,
    );
    assert.ok(
      !callAgentContent.includes(rawInput),
      `${testCase.name} call-agent bootstrap must not inline the raw query`,
    );

    if (testCase.name === "agent") {
      const tamperedPlan = createByclawAcpPlan({ config, snapshot, request });
      const tamperedBundle = JSON.parse(fs.readFileSync(tamperedPlan.sessionsSpawn.bundle.path, "utf8"));
      fs.appendFileSync(tamperedBundle.sharedContext.metadataPath, "\nmetadata changed after planning\n", "utf8");
      assert.throws(
        () => buildCallAgentContentFromPlan(tamperedPlan),
        /metadata.*mismatch/iu,
        "call-agent dispatch must reject changed metadata",
      );
    }

    summaries.push({
      kind: testCase.name,
      id: plan.id,
      model: plan.sessionsSpawn.model,
      hasModelConfig: Boolean(plan.sessionsSpawn.modelConfig),
      bundlePath: plan.sessionsSpawn.bundle.path,
      sessionsSpawnBytes: Buffer.byteLength(JSON.stringify(plan.sessionsSpawn)),
      agentModelCount: plan.metadata.agentModels.agents.length,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: summaries,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
