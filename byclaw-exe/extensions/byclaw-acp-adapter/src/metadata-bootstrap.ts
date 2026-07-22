import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BUNDLE } from "./constants.js";
import type { MetadataBootstrapContract } from "./types.js";

const PRECEDENCE = [
  "system-and-safety",
  "metadata-business-rules",
  "user-query",
  "model-defaults",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertMetadataBootstrapContractShape(
  value: unknown,
): asserts value is MetadataBootstrapContract {
  if (!isRecord(value)) {
    throw new MetadataBootstrapError("bootstrap contract must be an object");
  }
  if (typeof value.bootstrapId !== "string" || typeof value.runDir !== "string") {
    throw new MetadataBootstrapError("bootstrap contract bootstrapId and runDir are required");
  }
  if (!Array.isArray(value.precedence) || !value.precedence.every((item) => typeof item === "string")) {
    throw new MetadataBootstrapError("bootstrap contract precedence must be a string array");
  }
  if (!isRecord(value.metadata)) {
    throw new MetadataBootstrapError("bootstrap contract metadata is required");
  }
  if (
    typeof value.metadata.path !== "string" ||
    typeof value.metadata.sha256 !== "string" ||
    typeof value.metadata.bytes !== "number"
  ) {
    throw new MetadataBootstrapError("bootstrap contract metadata path, sha256, and bytes are required");
  }
  if (!isRecord(value.query) || typeof value.query.path !== "string") {
    throw new MetadataBootstrapError("bootstrap contract query path is required");
  }
  if (!isRecord(value.planBundle) || typeof value.planBundle.path !== "string") {
    throw new MetadataBootstrapError("bootstrap contract plan bundle path is required");
  }
  if (!isRecord(value.receipt) || typeof value.receipt.path !== "string") {
    throw new MetadataBootstrapError("bootstrap contract receipt path is required");
  }
}

export class MetadataBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataBootstrapError";
  }
}

export function metadataBootstrapFailureResponse(params: {
  error: unknown;
  requesterSessionKey: string;
  sessionId: string;
}) {
  return {
    success: false,
    error_code: "ACP_METADATA_BOOTSTRAP_INVALID",
    error: params.error instanceof Error ? params.error.message : String(params.error),
    target: {
      requester_session_key: params.requesterSessionKey,
      session_id: params.sessionId,
    },
  };
}

function metadataDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertNonEmptyText(content: string, label: string): void {
  if (!content.trim()) {
    throw new MetadataBootstrapError(`${label} is empty`);
  }
}

function assertPathInsideRunDir(runDir: string, targetPath: string, label: string): void {
  const root = path.resolve(runDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new MetadataBootstrapError(`${label} must be a file inside bootstrap runDir`);
  }
}

function readRequiredText(filePath: string, label: string): string {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new MetadataBootstrapError(
      `${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertNonEmptyText(content, label);
  return content;
}

function assertMetadataMatches(
  contract: MetadataBootstrapContract,
  metadataContent: string,
): void {
  assertNonEmptyText(metadataContent, "metadata.md");
  const actualBytes = Buffer.byteLength(metadataContent);
  if (actualBytes !== contract.metadata.bytes) {
    throw new MetadataBootstrapError(
      `metadata.md byte length mismatch: expected ${contract.metadata.bytes}, got ${actualBytes}`,
    );
  }
  const actualSha256 = metadataDigest(metadataContent);
  if (actualSha256 !== contract.metadata.sha256) {
    throw new MetadataBootstrapError(
      `metadata.md sha256 mismatch: expected ${contract.metadata.sha256}, got ${actualSha256}`,
    );
  }
}

export function createMetadataBootstrapContract(params: {
  bootstrapId: string;
  runDir: string;
  metadataPath: string;
  metadataContent: string;
  queryPath: string;
  planBundlePath: string;
  receiptPath: string;
}): MetadataBootstrapContract {
  assertNonEmptyText(params.bootstrapId, "bootstrapId");
  assertNonEmptyText(params.metadataContent, "metadata.md");
  return {
    protocolVersion: BUNDLE.metadataBootstrapProtocolVersion,
    bootstrapId: params.bootstrapId,
    policy: "fail-closed",
    runDir: path.resolve(params.runDir),
    precedence: [...PRECEDENCE],
    metadata: {
      path: path.resolve(params.metadataPath),
      sha256: metadataDigest(params.metadataContent),
      bytes: Buffer.byteLength(params.metadataContent),
      required: true,
      readMode: "complete-to-eof",
    },
    query: {
      path: path.resolve(params.queryPath),
      readAfterBootstrap: true,
    },
    planBundle: {
      path: path.resolve(params.planBundlePath),
      required: true,
    },
    receipt: {
      path: path.resolve(params.receiptPath),
      requiredStatus: "READY",
    },
  };
}

export function validateMetadataBootstrapContract(
  contract: MetadataBootstrapContract,
): string {
  assertMetadataBootstrapContractShape(contract);
  if (contract.protocolVersion !== BUNDLE.metadataBootstrapProtocolVersion) {
    throw new MetadataBootstrapError(
      `unsupported metadata bootstrap protocol version: ${contract.protocolVersion}`,
    );
  }
  if (contract.policy !== "fail-closed") {
    throw new MetadataBootstrapError("metadata bootstrap policy must be fail-closed");
  }
  if (JSON.stringify(contract.precedence) !== JSON.stringify(PRECEDENCE)) {
    throw new MetadataBootstrapError("metadata bootstrap precedence is invalid");
  }
  if (!Number.isSafeInteger(contract.metadata.bytes) || contract.metadata.bytes <= 0) {
    throw new MetadataBootstrapError("metadata bootstrap byte length must be a positive integer");
  }
  if (!/^[a-f0-9]{64}$/u.test(contract.metadata.sha256)) {
    throw new MetadataBootstrapError("metadata bootstrap sha256 must be a lowercase hexadecimal digest");
  }
  if (contract.metadata.required !== true || contract.metadata.readMode !== "complete-to-eof") {
    throw new MetadataBootstrapError("metadata bootstrap must require a complete-to-EOF metadata read");
  }
  if (contract.query.readAfterBootstrap !== true) {
    throw new MetadataBootstrapError("query access before metadata bootstrap is forbidden");
  }
  if (contract.planBundle.required !== true) {
    throw new MetadataBootstrapError("plan bundle must be required by metadata bootstrap");
  }
  if (contract.receipt.requiredStatus !== "READY") {
    throw new MetadataBootstrapError("metadata bootstrap receipt must require READY status");
  }
  assertNonEmptyText(contract.bootstrapId, "bootstrapId");
  if (path.basename(path.resolve(contract.runDir)) !== contract.bootstrapId) {
    throw new MetadataBootstrapError("bootstrap contract runDir must end with bootstrapId");
  }
  if (path.basename(path.dirname(path.resolve(contract.runDir))) !== BUNDLE.runsDirName) {
    throw new MetadataBootstrapError(`bootstrap contract runDir must be inside ${BUNDLE.runsDirName}`);
  }
  for (const [label, filePath] of [
    ["metadata.md", contract.metadata.path],
    ["query.md", contract.query.path],
    ["plan bundle", contract.planBundle.path],
    ["bootstrap receipt", contract.receipt.path],
  ] as const) {
    assertPathInsideRunDir(contract.runDir, filePath, label);
  }
  const metadataContent = readRequiredText(contract.metadata.path, "metadata.md");
  assertMetadataMatches(contract, metadataContent);
  readRequiredText(contract.query.path, "query.md");
  const planBundleContent = readRequiredText(contract.planBundle.path, "plan bundle");
  try {
    const planBundle = JSON.parse(planBundleContent) as unknown;
    if (!isRecord(planBundle)) {
      throw new Error("expected a JSON object");
    }
  } catch (error) {
    throw new MetadataBootstrapError(
      `plan bundle is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return metadataContent;
}

export function loadMetadataBootstrapContract(
  contractPath: string,
  expected?: {
    bootstrapId: string;
    runDir: string;
    planBundlePath: string;
  },
): {
  contract: MetadataBootstrapContract;
  metadataContent: string;
} {
  const contractContent = readRequiredText(contractPath, "bootstrap contract");
  let parsed: unknown;
  try {
    parsed = JSON.parse(contractContent) as unknown;
  } catch (error) {
    throw new MetadataBootstrapError(
      `bootstrap contract is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertMetadataBootstrapContractShape(parsed);
  const contract = parsed;
  assertPathInsideRunDir(contract.runDir, contractPath, "bootstrap contract");
  if (expected) {
    const expectedRunDir = path.resolve(expected.runDir);
    const expectedContractPath = path.join(expectedRunDir, BUNDLE.bootstrapContractFileName);
    if (path.resolve(contractPath) !== expectedContractPath) {
      throw new MetadataBootstrapError("plan bootstrap contract path does not match its runDir");
    }
    if (path.resolve(contract.runDir) !== expectedRunDir) {
      throw new MetadataBootstrapError("bootstrap contract runDir does not match the current plan");
    }
    if (contract.bootstrapId !== expected.bootstrapId) {
      throw new MetadataBootstrapError("bootstrap contract bootstrapId does not match the current plan");
    }
    if (path.resolve(contract.planBundle.path) !== path.resolve(expected.planBundlePath)) {
      throw new MetadataBootstrapError("bootstrap contract plan bundle path does not match the current plan");
    }
  }
  return {
    contract,
    metadataContent: validateMetadataBootstrapContract(contract),
  };
}

export function renderMetadataFirstDelegationContent(params: {
  contract: MetadataBootstrapContract;
  metadataContent: string;
}): string {
  assertMetadataMatches(params.contract, params.metadataContent);
  const { contract } = params;
  return [
    "<BUSINESS_RULE_BOOTSTRAP>",
    "Policy: fail-closed.",
    "Before bootstrap status is READY, do not read query.md or plan-bundle.json, plan business work, invoke subagents, modify business files, or produce business conclusions.",
    `Bootstrap id: ${contract.bootstrapId}`,
    `Bootstrap contract: ${path.join(contract.runDir, BUNDLE.bootstrapContractFileName)}`,
    `Authoritative metadata: ${contract.metadata.path}`,
    `Machine plan bundle (access only after READY): ${contract.planBundle.path}`,
    `Expected metadata bytes: ${contract.metadata.bytes}`,
    `Expected metadata sha256: ${contract.metadata.sha256}`,
    `Bootstrap receipt: ${contract.receipt.path}`,
    "Read metadata.md from byte 0 through EOF, even when a file-reading tool truncates its first response.",
    "Verify the on-disk byte count and SHA-256 before treating bootstrap as READY.",
    "Treat the complete metadata document as the business-rule manual. Do not rely on a fixed list of known headings.",
    "Read every Linked Skill directly from its metadata skillDocPath from byte 0 through EOF before query access.",
    "Do not copy, install, symlink, or materialize Linked Skills into `.claude/skills`, `.agents/skills`, `.codex/skills`, or equivalent public skill directories.",
    "Follow metadata instructions to load all other referenced resources required for this task, including future resource types unknown to this adapter.",
    "Write bootstrap-receipt.json with READY or BLOCKED, integrity evidence, acknowledged rules, every loaded Linked Skill path, loaded referenced resources, and blockers.",
    "If any mandatory rule, Linked Skill, or referenced resource cannot be loaded, write BLOCKED and do not access the query.",
    "After READY, apply every loaded Linked Skill whose trigger conditions match the query; acknowledging or summarizing a skill does not count as using it.",
    "</BUSINESS_RULE_BOOTSTRAP>",
    "",
    "<METADATA_BUSINESS_RULE_MANUAL>",
    params.metadataContent,
    "</METADATA_BUSINESS_RULE_MANUAL>",
    "",
    "<USER_QUERY_ACCESS>",
    `Only after writing a READY receipt may you read and execute: ${contract.query.path}`,
    "Apply every applicable rule from metadata.md while executing the query.",
    "</USER_QUERY_ACCESS>",
  ].join("\n");
}
