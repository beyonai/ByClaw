#!/usr/bin/env node
import assert from "node:assert/strict";
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
  const expectedReplyLanguage = testCase.request.replyLanguage ?? testCase.request.language ?? "zh_CN";
  const expectedByaiSessionId = testCase.request.sessionId;
  const expectedSessionRoot = `${SESSION_FILES_ROOT}/${expectedByaiSessionId}`;

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
  assert.equal(bundle.clientType, fixture.config.defaultAcpClientType, `${testCase.name} clientType mismatch`);
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
      path.join(PATHS.byclawDir, PATHS.acpRunsDir, PATHS.clientDirNames.claudeCode),
    ),
    `${testCase.name} shared directory should use .byclaw/acp-runs/claudeCode`,
  );
  assert.ok(
    sharedContext.sharedDir.endsWith(
      path.join(PATHS.byclawDir, PATHS.acpRunsDir, PATHS.clientDirNames.claudeCode, expectedByaiSessionId),
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
  assert.match(metadata, /skillDocPath/u, `${testCase.name} metadata should include absolute skillDocPath`);
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

async function assertMetadataBootstrapProtocol() {
  const {
    createMetadataBootstrapContract,
    renderMetadataFirstDelegationContent,
    validateMetadataBootstrapContract,
  } = await loadMetadataBootstrap();
  const runDir = path.join(workspaceRoot, "metadata-bootstrap-protocol");
  const clientsDir = path.join(runDir, "clients");
  const metadataPath = path.join(runDir, "metadata.md");
  const queryPath = path.join(runDir, "query.md");
  const clientInstructionsPath = path.join(clientsDir, "claude-code.md");
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

  const contract = createMetadataBootstrapContract({
    bootstrapId: "bootstrap-fixture",
    runDir,
    metadataPath,
    metadataContent,
    clientInstructionsPath,
    queryPath,
    receiptPath,
  });
  assert.equal(contract.policy, "fail-closed");
  assert.equal(contract.metadata.readMode, "complete-to-eof");
  assert.equal(contract.metadata.bytes, Buffer.byteLength(metadataContent));
  assert.equal(contract.metadata.sha256.length, 64);
  assert.equal(contract.query.readAfterBootstrap, true);
  assert.equal(contract.receipt.requiredStatus, "READY");
  assert.doesNotThrow(() => validateMetadataBootstrapContract(contract));

  const content = renderMetadataFirstDelegationContent({ contract, metadataContent });
  assert.match(content, /read[^\n]*EOF/iu);
  assert.match(content, /referenced resources/iu);
  assert.match(content, /bootstrap-receipt\.json/u);
  assert.match(content, /Future Business Rule/u);
  assert.ok(
    content.indexOf("Future Business Rule") < content.indexOf("<USER_QUERY_ACCESS>"),
    "unknown future metadata rules must appear before query access",
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

    // byclawCallAcpAgent delegation content: reuses plan.task, which embeds the
    // user query plus the on-disk shared-context file paths that the remote ACP
    // agent reads. Structured bundle data travels via files, not inline.
    const callAgentContent = buildCallAgentContentFromPlan(plan);
    assert.equal(
      callAgentContent,
      plan.task,
      `${testCase.name} call-agent content should equal plan.task`,
    );
    assert.match(callAgentContent, /query\.md/u, `${testCase.name} call-agent content should point to query.md`);
    assert.match(
      callAgentContent,
      /metadata\.md/u,
      `${testCase.name} call-agent content should point to metadata.md`,
    );
    assert.match(
      callAgentContent,
      /plan-bundle\.json/u,
      `${testCase.name} call-agent content should point to plan-bundle.json`,
    );

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
