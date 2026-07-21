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

export class MetadataBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataBootstrapError";
  }
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
  clientInstructionsPath: string;
  queryPath: string;
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
    clientInstructions: {
      path: path.resolve(params.clientInstructionsPath),
      required: true,
    },
    query: {
      path: path.resolve(params.queryPath),
      readAfterBootstrap: true,
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
  if (contract.protocolVersion !== BUNDLE.metadataBootstrapProtocolVersion) {
    throw new MetadataBootstrapError(
      `unsupported metadata bootstrap protocol version: ${contract.protocolVersion}`,
    );
  }
  if (contract.policy !== "fail-closed") {
    throw new MetadataBootstrapError("metadata bootstrap policy must be fail-closed");
  }
  assertNonEmptyText(contract.bootstrapId, "bootstrapId");
  for (const [label, filePath] of [
    ["metadata.md", contract.metadata.path],
    ["client instructions", contract.clientInstructions.path],
    ["query.md", contract.query.path],
    ["bootstrap receipt", contract.receipt.path],
  ] as const) {
    assertPathInsideRunDir(contract.runDir, filePath, label);
  }
  const metadataContent = readRequiredText(contract.metadata.path, "metadata.md");
  assertMetadataMatches(contract, metadataContent);
  readRequiredText(contract.clientInstructions.path, "client instructions");
  readRequiredText(contract.query.path, "query.md");
  return metadataContent;
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
    "Before bootstrap status is READY, do not read the user query, plan business work, invoke subagents, modify business files, or produce business conclusions.",
    `Bootstrap id: ${contract.bootstrapId}`,
    `Bootstrap contract: ${path.join(contract.runDir, BUNDLE.bootstrapContractFileName)}`,
    `Authoritative metadata: ${contract.metadata.path}`,
    `Expected metadata bytes: ${contract.metadata.bytes}`,
    `Expected metadata sha256: ${contract.metadata.sha256}`,
    `Bootstrap receipt: ${contract.receipt.path}`,
    "Read metadata.md from byte 0 through EOF, even when a file-reading tool truncates its first response.",
    "Verify the on-disk byte count and SHA-256 before treating bootstrap as READY.",
    "Treat the complete metadata document as the business-rule manual. Do not rely on a fixed list of known headings.",
    "Follow metadata instructions to load all referenced resources required for this task, including future resource types unknown to this adapter.",
    "Write bootstrap-receipt.json with READY or BLOCKED, integrity evidence, acknowledged rules, loaded referenced resources, and blockers.",
    "If any mandatory rule or referenced resource cannot be loaded, write BLOCKED and do not access the query.",
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
