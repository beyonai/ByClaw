#!/usr/bin/env node

import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_WECOM_POLLS = 12;

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

async function chmodPrivate(path) {
  await chmod(path, PRIVATE_DIRECTORY_MODE);
}

async function writePrivate(path, content) {
  await writeFile(path, content, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  await chmod(path, PRIVATE_FILE_MODE);
}

async function writePrivateJson(path, value) {
  await writePrivate(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(bin, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun(stdout);
      } else {
        reject(new Error(`command failed with exit ${code}: ${stderr.trim() || 'no error output'}`));
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
  return `---\ntitle: ${title}\nsource: ${source}\nsource_url: ${url}\ncollection_filters: {}\n---\n\n${content.trim()}\n`;
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
  await makeDirectory(root);
  await Promise.all([makeDirectory(rawDir), makeDirectory(markdownDir), makeDirectory(sanitizedDir), makeDirectory(itemDir)]);

  const bin = process.env.WECOM_CLI_BIN || 'wecom-cli';
  const exportResult = parseWecomEnvelope(await run(bin, ['doc', 'smartpage_export_task', JSON.stringify({ url, content_type: 1 })]));
  await writePrivateJson(resolve(rawDir, 'export-task.json'), exportResult.outer);
  const taskId = exportResult.business.task_id;
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error('wecom-cli export response has no task_id');
  }

  let content;
  for (let poll = 1; poll <= MAX_WECOM_POLLS; poll += 1) {
    const pollResult = parseWecomEnvelope(await run(bin, ['doc', 'smartpage_get_export_result', JSON.stringify({ task_id: taskId })]));
    await writePrivateJson(resolve(rawDir, `poll-${poll}.json`), pollResult.outer);
    if (pollResult.business.task_done === true) {
      content = pollResult.business.content;
      break;
    }
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('wecom-cli export did not finish with non-empty content');
  }

  const normalized = markdown(content, url, 'Exported WeCom Smartpage', 'wecom');
  await Promise.all([
    writePrivate(resolve(markdownDir, 'document.md'), normalized),
    writePrivate(resolve(itemDir, 'document.md'), normalized),
    writePrivateJson(resolve(rawDir, 'metadata.json'), { backend: 'wecom-cli', taskId }),
    writePrivateJson(resolve(sanitizedDir, 'metadata.json'), {
      backend: 'wecom-cli',
      backendCliVersion: process.env.WECOM_CLI_VERSION || 'unknown',
      scope: 'bot-visible',
      taskId,
      partial: false,
    }),
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
  await makeDirectory(root);
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
  await Promise.all([
    writePrivate(resolve(markdownDir, 'transcript.md'), normalized),
    writePrivate(resolve(itemDir, 'transcript.md'), normalized),
    writePrivateJson(resolve(rawDir, 'metadata.json'), { backend: 'lark-cli' }),
    writePrivateJson(resolve(sanitizedDir, 'metadata.json'), {
      backend: 'lark-cli',
      backendCliVersion: process.env.LARK_CLI_VERSION || 'unknown',
      partial: false,
      transcriptFile: 'raw/minutes/cli-created-file',
    }),
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
