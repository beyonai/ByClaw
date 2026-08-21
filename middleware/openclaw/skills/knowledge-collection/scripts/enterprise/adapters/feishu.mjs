import crypto from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { runCli } from '../shared/cli-runner.mjs';
import { SOURCE_IDENTITY, handledOutcome } from '../shared/status-model.mjs';

const identity = SOURCE_IDENTITY.feishu;
const title = 'Feishu Minutes Transcript';

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function commandEnvironment(dependencies) {
  const env = { ...process.env, ...(dependencies.env || {}) };
  if (typeof env.LARK_HOME !== 'string' || !env.LARK_HOME.trim()) {
    throw new Error('LARK_HOME is required for Feishu collection');
  }
  return { ...env, HOME: env.LARK_HOME };
}

function markdown(content, url) {
  return `---\ntitle: ${JSON.stringify(title)}\nsource: "fws"\nsource_url: ${JSON.stringify(url)}\ncollection_filters: {}\n---\n\n${content.trim()}\n`;
}

function item({ minuteToken, url, rawArtifacts, status, reason, markdownPath = null, sanitizedPath = null }) {
  return {
    itemId: `fws-minute-${crypto.createHash('sha256').update(minuteToken).digest('hex').slice(0, 16)}`,
    title,
    sourceUrl: url,
    sourceItemId: minuteToken,
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: {},
    rawArtifacts,
    materialization: {
      status,
      markdownPath,
      sanitizedPath,
      pendingArtifactCleanup: [],
      reason,
    },
  };
}

function canonical(url) {
  return {
    title,
    url,
    author: '',
    publishTime: '',
    markdown: 'sanitized/items/transcript.md',
    fileName: 'sanitized/items/transcript.md',
  };
}

async function persistBundle(writer, { url, inventory, canonicalItems, sourceMetadata, collectionStatus }) {
  await writer.writeCollectionBundle({
    title,
    source: identity.source,
    backend: identity.backend,
    url,
    filters: {},
    inventory,
    canonicalItems,
    sourceMetadata,
    ...(collectionStatus ? { collectionStatus } : {}),
  });
}

async function markdownFilesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await markdownFilesBelow(path));
    } else if (entry.isFile() && ['.md', '.markdown'].includes(extname(entry.name).toLowerCase())) {
      const stat = await lstat(path);
      if (stat.isFile() && !stat.isSymbolicLink()) files.push(path);
    }
  }
  return files;
}

function cliEvidence(result) {
  return {
    exitCode: result?.exitCode ?? null,
    stdout: result?.stdout ?? '',
    stderr: result?.stderr ?? '',
    failure: result?.failure ? {
      code: result.failure.code,
      message: result.failure.message,
    } : null,
  };
}

async function persistIncomplete(writer, outputDir, { minuteToken, url, rawArtifacts, reason, partial, stage, evidence }) {
  const artifacts = [...rawArtifacts];
  if (evidence) {
    const evidencePath = `raw/failed-${artifacts.length + 1}.json`;
    await writer.writeJson(evidencePath, evidence);
    artifacts.push(evidencePath);
  }
  artifacts.push('raw/metadata.json');
  await writer.writeJson('raw/metadata.json', {
    backend: identity.backend,
    resourceKind: 'minutes',
    collectionStatus: partial ? 'partial' : 'failed',
    stage,
    reason,
    rawArtifacts: artifacts,
  });
  const inventory = [item({
    minuteToken,
    url,
    rawArtifacts: artifacts,
    status: partial ? 'pending' : 'failed',
    reason,
  })];
  await persistBundle(writer, {
    url,
    inventory,
    canonicalItems: [],
    sourceMetadata: { ...identity, resourceKind: 'minutes', stage, reason },
    ...(partial ? { collectionStatus: 'partial' } : {}),
  });
  return {
    ...handledOutcome(identity.connector, partial ? 'partial' : 'failed', outputDir, {
      discovered: 1,
      [partial ? 'pending' : 'failed']: 1,
    }),
    reason,
  };
}

async function collectFeishuMinutes(request, dependencies) {
  const outputDir = request?.outputDir;
  const minuteToken = typeof request?.minuteToken === 'string' ? request.minuteToken.trim() : '';
  const url = typeof request?.url === 'string' ? request.url.trim() : '';
  let writer;
  try {
    writer = await createArtifactWriter(outputDir);
  } catch (error) {
    return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: reasonOf(error) };
  }
  if (request?.resourceKind !== 'minutes' || !minuteToken || !url) {
    return persistIncomplete(writer, outputDir, {
      minuteToken: minuteToken || 'unknown',
      url: url || 'feishu://invalid',
      rawArtifacts: [],
      reason: request?.resourceKind !== 'minutes' ? 'resourceKind must be minutes' : 'minuteToken and url are required',
      partial: false,
      stage: 'request',
    });
  }

  const minutesDir = writer.absolute('raw/minutes');
  await mkdir(minutesDir, { recursive: true, mode: 0o700 });
  await chmod(minutesDir, 0o700);
  const bin = dependencies.bin || 'lark-cli';
  let env;
  try {
    env = commandEnvironment(dependencies);
  } catch (error) {
    return persistIncomplete(writer, outputDir, {
      minuteToken, url, rawArtifacts: [], reason: reasonOf(error), partial: false, stage: 'authentication',
    });
  }
  let detail;
  try {
    const result = await runCli(bin, [
      'minutes', '+detail', '--minute-tokens', minuteToken, '--transcript',
      '--output-dir', minutesDir, '--as', 'user', '--format', 'json',
    ], { env });
    if (result.failure || result.exitCode !== 0) {
      return persistIncomplete(writer, outputDir, {
        minuteToken, url, rawArtifacts: [],
        reason: result.failure ? `lark-cli failed to start: ${result.failure.code || result.failure.message}` : `lark-cli command failed with exit ${result.exitCode}`,
        partial: false, stage: 'detail', evidence: cliEvidence(result),
      });
    }
    try {
      detail = JSON.parse(result.stdout);
    } catch {
      return persistIncomplete(writer, outputDir, {
        minuteToken, url, rawArtifacts: [], reason: 'lark-cli returned invalid JSON',
        partial: false, stage: 'detail', evidence: cliEvidence(result),
      });
    }
    if (detail?.ok !== true) {
      return persistIncomplete(writer, outputDir, {
        minuteToken, url, rawArtifacts: [], reason: 'lark-cli did not report success',
        partial: false, stage: 'detail', evidence: cliEvidence(result),
      });
    }
  } catch (error) {
    return persistIncomplete(writer, outputDir, {
      minuteToken, url, rawArtifacts: [], reason: reasonOf(error), partial: false, stage: 'detail',
      evidence: { error: reasonOf(error) },
    });
  }

  await writer.writeJson('raw/detail.json', detail);
  const rawArtifacts = ['raw/detail.json'];
  const transcripts = await markdownFilesBelow(minutesDir);
  for (const path of transcripts) await chmod(path, 0o600);
  const transcriptArtifacts = transcripts.map((path) => relative(resolve(outputDir), path).split(sep).join('/'));
  rawArtifacts.push(...transcriptArtifacts);
  if (transcripts.length !== 1) {
    return persistIncomplete(writer, outputDir, {
      minuteToken, url, rawArtifacts,
      reason: `expected one CLI-created Markdown transcript file, found ${transcripts.length}`,
      partial: true, stage: 'transcript',
    });
  }
  const transcript = await readFile(transcripts[0], 'utf8');
  if (!transcript.trim()) {
    return persistIncomplete(writer, outputDir, {
      minuteToken, url, rawArtifacts, reason: 'CLI-created transcript file is empty', partial: true, stage: 'transcript',
    });
  }

  const normalized = markdown(transcript, url);
  await Promise.all([
    writer.writeText('markdown/transcript.md', normalized),
    writer.writeText('sanitized/items/transcript.md', normalized),
    writer.writeJson('raw/metadata.json', {
      backend: identity.backend,
      resourceKind: 'minutes',
      sourceItemId: minuteToken,
    }),
  ]);
  rawArtifacts.push('raw/metadata.json');
  const inventory = [item({
    minuteToken, url, rawArtifacts, status: 'materialized', reason: null,
    markdownPath: 'markdown/transcript.md', sanitizedPath: 'sanitized/items/transcript.md',
  })];
  await persistBundle(writer, {
    url,
    inventory,
    canonicalItems: [canonical(url)],
    sourceMetadata: {
      ...identity,
      resourceKind: 'minutes',
      sourceItemId: minuteToken,
      ...(request.legacyMode ? { backendCliVersion: env.LARK_CLI_VERSION || 'unknown' } : {}),
      transcriptFile: transcriptArtifacts[0],
    },
  });
  return handledOutcome(identity.connector, 'complete', outputDir, { discovered: 1, materialized: 1 });
}

async function unsupportedSearch({ outputDir, query }) {
  const writer = await createArtifactWriter(outputDir);
  await persistBundle(writer, {
    url: 'feishu://search', inventory: [], canonicalItems: [],
    sourceMetadata: { ...identity, capability: 'search', unsupported: true, query: typeof query === 'string' ? query : '' },
  });
  return handledOutcome(identity.connector, 'unsupported_capability', outputDir);
}

export function createFeishuAdapter(dependencies = {}) {
  return {
    connector: identity.connector,
    capabilities: () => ({ search: false, resource: true }),
    search: (request) => unsupportedSearch(request),
    collectResource: (request) => collectFeishuMinutes(request, dependencies),
  };
}
