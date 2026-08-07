#!/usr/bin/env node

import crypto from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEFAULT_MAX_WECOM_POLLS = 12;
const DEFAULT_CLI_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CLI_OUTPUT_BYTES = 10 * 1024 * 1024;
const SENSITIVE_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function requireValue(values, key) {
  const value = values[key]?.trim();
  if (!value) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

async function makeDirectory(path) {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmodPrivate(path);
}

async function createOutputRoot(root) {
  await mkdir(dirname(root), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  try {
    await mkdir(root, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`--output-dir must not already exist: ${root}`);
    }
    throw error;
  }
  await chmodPrivate(root);
}

async function chmodPrivate(path) {
  await chmod(path, PRIVATE_DIRECTORY_MODE);
}

async function writePrivate(path, content) {
  await writeFile(path, content, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  await chmod(path, PRIVATE_FILE_MODE);
}

async function writePrivateJson(path, value) {
  await writePrivate(path, `${JSON.stringify(sanitizeSensitive(value), null, 2)}\n`);
}

function sanitizeSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeSensitive);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
      || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(sanitizeSensitive(parsed));
        }
      } catch {}
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeSensitive(item),
  ]));
}

function positiveEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function run(bin, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const timeoutMs = positiveEnv('KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS', DEFAULT_CLI_TIMEOUT_MS);
    const maxOutputBytes = positiveEnv('KNOWLEDGE_COLLECTION_MAX_CLI_OUTPUT_BYTES', DEFAULT_MAX_CLI_OUTPUT_BYTES);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolveRun(value);
      }
    }

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(new Error(`command output exceeds ${maxOutputBytes} bytes`));
      } else {
        stdout += chunk;
      }
    });
    child.stderr.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(new Error(`command output exceeds ${maxOutputBytes} bytes`));
      } else {
        stderr += chunk;
      }
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        finish(null, stdout);
      } else {
        finish(new Error(`command failed with exit ${code}`));
      }
    });
  });
}

function parseWecomEnvelope(stdout) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    throw new Error('wecom-cli returned invalid JSON');
  }
  const text = outer?.result?.content?.find((item) => typeof item?.text === 'string')?.text;
  if (!text) {
    throw new Error('wecom-cli JSON-RPC response has no result.content[].text');
  }
  let business;
  try {
    business = JSON.parse(text);
  } catch {
    throw new Error('wecom-cli result.content[].text is not valid business JSON');
  }
  if (business.errcode !== 0) {
    throw new Error(`wecom-cli business errcode ${business.errcode}`);
  }
  return { outer, business };
}

function markdown(content, url, title, source) {
  const yamlScalar = (value) => JSON.stringify(String(value ?? ''));
  return `---\ntitle: ${yamlScalar(title)}\nsource: ${yamlScalar(source)}\nsource_url: ${yamlScalar(url)}\ncollection_filters: {}\n---\n\n${content.trim()}\n`;
}

function collectionMetadata({ itemId, title, url, sourceItemId, sourceSkill, backend, rawArtifacts, markdownPath, sanitizedPath, sourceMetadata, collectionStatus = 'complete', materializationStatus = 'materialized', materializationReason = null }) {
  return {
    schemaVersion: '1.0',
    storage: { fallback: false },
    collection: {
      status: collectionStatus,
      items: [{
        itemId,
        title,
        sourceUrl: url,
        sourceItemId,
        sourceSkill,
        backend,
        collectionFilters: {},
        rawArtifacts,
        materialization: {
          status: materializationStatus,
          markdownPath: materializationStatus === 'materialized' ? markdownPath : null,
          sanitizedPath: materializationStatus === 'materialized' ? sanitizedPath : null,
          reason: materializationReason,
        },
      }],
    },
    retention: { auditRequired: false, userRequested: false },
    postProcessing: { runs: [] },
    sourceMetadata,
  };
}

async function persistWecomFailure(root, url, reason) {
  const rawDir = resolve(root, 'raw');
  const sanitizedDir = resolve(root, 'sanitized');
  const itemId = `wecom-smartpage-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
  await Promise.all([
    writePrivateJson(resolve(rawDir, 'metadata.json'), {
      backend: 'wecom-cli',
      failed: true,
      stage: 'export-task',
      reason,
    }),
    writePrivateJson(resolve(sanitizedDir, 'metadata.json'), collectionMetadata({
      itemId,
      title: 'Exported WeCom Smartpage',
      url,
      sourceItemId: url,
      sourceSkill: 'wecomcli',
      backend: 'wecom-cli',
      rawArtifacts: ['raw/metadata.json'],
      markdownPath: null,
      sanitizedPath: null,
      collectionStatus: 'failed',
      materializationStatus: 'failed',
      materializationReason: reason,
      sourceMetadata: { backend: 'wecom-cli', stage: 'export-task', reason },
    })),
    writePrivateJson(resolve(root, 'collection-result.json'), {
      schemaVersion: '1.0',
      title: 'Exported WeCom Smartpage',
      source: 'wecom',
      backend: 'wecom-cli',
      url,
      filters: {},
      items: [],
    }),
  ]);
}

async function collectWecomSmartpage(values) {
  const url = requireValue(values, 'url');
  const outputDir = requireValue(values, 'output-dir');
  if (!isAbsolute(outputDir)) {
    throw new Error('--output-dir must be an absolute path');
  }
  const root = resolve(outputDir);
  const rawDir = resolve(root, 'raw');
  const markdownDir = resolve(root, 'markdown');
  const sanitizedDir = resolve(root, 'sanitized');
  const itemDir = resolve(sanitizedDir, 'items');
  await createOutputRoot(root);
  await Promise.all([makeDirectory(rawDir), makeDirectory(markdownDir), makeDirectory(sanitizedDir), makeDirectory(itemDir)]);

  const bin = process.env.WECOM_CLI_BIN || 'wecom-cli';
  let exportResult;
  try {
    exportResult = parseWecomEnvelope(await run(bin, ['doc', 'smartpage_export_task', JSON.stringify({ url, content_type: 1 })]));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await persistWecomFailure(root, url, reason);
    throw error;
  }
  await writePrivateJson(resolve(rawDir, 'export-task.json'), exportResult.outer);
  const taskId = exportResult.business.task_id;
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error('wecom-cli export response has no task_id');
  }

  let content;
  let completedPoll;
  let failureReason = '';
  const rawArtifacts = ['raw/export-task.json'];
  const maxPolls = positiveEnv('KNOWLEDGE_COLLECTION_MAX_WECOM_POLLS', DEFAULT_MAX_WECOM_POLLS);
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    try {
      const pollResult = parseWecomEnvelope(await run(bin, ['doc', 'smartpage_get_export_result', JSON.stringify({ task_id: taskId })]));
      await writePrivateJson(resolve(rawDir, `poll-${poll}.json`), pollResult.outer);
      rawArtifacts.push(`raw/poll-${poll}.json`);
      if (pollResult.business.task_done === true) {
        content = pollResult.business.content;
        completedPoll = poll;
        break;
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  if (typeof content !== 'string' || !content.trim()) {
    failureReason ||= `export did not finish after ${maxPolls} polls`;
    await writePrivateJson(resolve(rawDir, 'metadata.json'), {
      backend: 'wecom-cli',
      taskId,
      partial: true,
      lastPoll: completedPoll || maxPolls,
      reason: failureReason,
    });
    await writePrivateJson(resolve(sanitizedDir, 'metadata.json'), collectionMetadata({
      itemId: `wecom-smartpage-${taskId}`,
      title: 'Exported WeCom Smartpage',
      url,
      sourceItemId: taskId,
      sourceSkill: 'wecomcli',
      backend: 'wecom-cli',
      rawArtifacts,
      markdownPath: null,
      sanitizedPath: null,
      collectionStatus: 'partial',
      materializationStatus: 'pending',
      materializationReason: failureReason,
      sourceMetadata: {
        backend: 'wecom-cli',
        taskId,
        lastPoll: completedPoll || maxPolls,
        reason: failureReason,
      },
    }));
    await writePrivateJson(resolve(root, 'collection-result.json'), {
      schemaVersion: '1.0',
      title: 'Exported WeCom Smartpage',
      source: 'wecom',
      backend: 'wecom-cli',
      url,
      filters: {},
      items: [],
    });
    throw new Error('wecom-cli export did not finish with non-empty content');
  }

  const normalized = markdown(content, url, 'Exported WeCom Smartpage', 'wecom');
  await Promise.all([
    writePrivate(resolve(markdownDir, 'document.md'), normalized),
    writePrivate(resolve(itemDir, 'document.md'), normalized),
    writePrivateJson(resolve(rawDir, 'metadata.json'), { backend: 'wecom-cli', taskId }),
    writePrivateJson(resolve(sanitizedDir, 'metadata.json'), collectionMetadata({
      itemId: `wecom-smartpage-${taskId}`,
      title: 'Exported WeCom Smartpage',
      url,
      sourceItemId: taskId,
      sourceSkill: 'wecomcli',
      backend: 'wecom-cli',
      rawArtifacts: ['raw/export-task.json', `raw/poll-${completedPoll}.json`],
      markdownPath: 'markdown/document.md',
      sanitizedPath: 'sanitized/items/document.md',
      sourceMetadata: {
        backend: 'wecom-cli',
        backendCliVersion: process.env.WECOM_CLI_VERSION || 'unknown',
        scope: 'bot-visible',
        taskId,
      },
    })),
  ]);
  await writePrivateJson(resolve(root, 'collection-result.json'), {
    schemaVersion: '1.0',
    title: 'Exported WeCom Smartpage',
    source: 'wecom',
    backend: 'wecom-cli',
    url,
    filters: {},
    items: [{
      title: 'Exported WeCom Smartpage',
      url,
      author: '',
      publishTime: '',
      markdown: 'sanitized/items/document.md',
      fileName: 'sanitized/items/document.md',
    }],
  });
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesBelow(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function collectFeishuMinutes(values) {
  const minuteToken = requireValue(values, 'minute-token');
  const url = requireValue(values, 'url');
  const outputDir = requireValue(values, 'output-dir');
  if (!isAbsolute(outputDir)) {
    throw new Error('--output-dir must be an absolute path');
  }
  const root = resolve(outputDir);
  const rawDir = resolve(root, 'raw');
  const minutesDir = resolve(rawDir, 'minutes');
  const markdownDir = resolve(root, 'markdown');
  const sanitizedDir = resolve(root, 'sanitized');
  const itemDir = resolve(sanitizedDir, 'items');
  await createOutputRoot(root);
  await Promise.all([
    makeDirectory(rawDir),
    makeDirectory(minutesDir),
    makeDirectory(markdownDir),
    makeDirectory(sanitizedDir),
    makeDirectory(itemDir),
  ]);

  const stdout = await run(process.env.LARK_CLI_BIN || 'lark-cli', [
    'minutes', '+detail', '--minute-tokens', minuteToken, '--transcript',
    '--output-dir', minutesDir, '--as', 'user', '--format', 'json',
  ]);
  let detail;
  try {
    detail = JSON.parse(stdout);
  } catch {
    throw new Error('lark-cli returned invalid JSON');
  }
  if (detail.ok !== true) {
    throw new Error('lark-cli did not report success');
  }
  await writePrivateJson(resolve(rawDir, 'detail.json'), detail);

  const transcripts = await filesBelow(minutesDir);
  if (transcripts.length !== 1) {
    throw new Error(`expected one CLI-created transcript file, found ${transcripts.length}`);
  }
  const transcriptPath = transcripts[0];
  await chmod(transcriptPath, PRIVATE_FILE_MODE);
  const transcript = await readFile(transcriptPath, 'utf8');
  if (!transcript.trim()) {
    throw new Error('CLI-created transcript file is empty');
  }
  const title = 'Feishu Minutes Transcript';
  const normalized = markdown(transcript, url, title, 'fws');
  const transcriptRelativePath = relative(root, transcriptPath).split(sep).join('/');
  await Promise.all([
    writePrivate(resolve(markdownDir, 'transcript.md'), normalized),
    writePrivate(resolve(itemDir, 'transcript.md'), normalized),
    writePrivateJson(resolve(rawDir, 'metadata.json'), { backend: 'lark-cli' }),
    writePrivateJson(resolve(sanitizedDir, 'metadata.json'), collectionMetadata({
      itemId: `fws-minute-${minuteToken}`,
      title,
      url,
      sourceItemId: minuteToken,
      sourceSkill: 'fws',
      backend: 'lark-cli',
      rawArtifacts: ['raw/detail.json', transcriptRelativePath],
      markdownPath: 'markdown/transcript.md',
      sanitizedPath: 'sanitized/items/transcript.md',
      sourceMetadata: {
        backend: 'lark-cli',
        backendCliVersion: process.env.LARK_CLI_VERSION || 'unknown',
        transcriptFile: transcriptRelativePath,
      },
    })),
  ]);
  await writePrivateJson(resolve(root, 'collection-result.json'), {
    schemaVersion: '1.0',
    title,
    source: 'fws',
    backend: 'lark-cli',
    url,
    filters: {},
    items: [{
      title,
      url,
      author: '',
      publishTime: '',
      markdown: 'sanitized/items/transcript.md',
      fileName: 'sanitized/items/transcript.md',
    }],
  });
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === 'wecom-smartpage') {
    await collectWecomSmartpage(values);
    return;
  }
  if (command === 'feishu-minutes') {
    await collectFeishuMinutes(values);
    return;
  }
  if (!command) {
    throw new Error(`unsupported command: ${command || '(missing)'}`);
  }
  throw new Error(`unsupported command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
