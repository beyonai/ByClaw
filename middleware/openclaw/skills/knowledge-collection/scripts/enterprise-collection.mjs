#!/usr/bin/env node

import { createFeishuAdapter } from './enterprise/adapters/feishu.mjs';
import { createWecomAdapter } from './enterprise/adapters/wecom.mjs';
import { dispatchEnterprise } from './enterprise/dispatcher.mjs';
import { isAbsolute } from 'node:path';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'help') {
      values.help = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function requireValue(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function requireAbsoluteOutputDir(values) {
  const outputDir = requireValue(values, 'output-dir');
  if (!isAbsolute(outputDir)) throw new Error('--output-dir must be an absolute path');
  return outputDir;
}

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  return {
    ok: true,
    name: 'knowledge-collection-enterprise',
    usage: 'knowledge-collection.mjs enterprise search|resource [options]',
    defaults: 'search defaults: limit 50, concurrency 4, cursor null, metadata-only false',
    commands: {
      search: '--source dingtalk|feishu|wecom --query <query> --output-dir <absolute-path> [--limit 1..500] [--concurrency 1..16] [--cursor <cursor>] [--metadata-only true|false]',
      resource: '--source dingtalk|feishu|wecom --url <http(s)-url> --output-dir <absolute-path> [--minute-token <token> for feishu]',
      legacy: 'wecom-smartpage and feishu-minutes remain supported',
    },
  };
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help' || values.help === true || values.help === 'true') {
    render(help());
    return;
  }
  if (command === 'wecom-smartpage') {
    const url = requireValue(values, 'url');
    const outputDir = requireAbsoluteOutputDir(values);
    const outcome = await createWecomAdapter({
      bin: process.env.WECOM_CLI_BIN || 'wecom-cli',
      env: process.env,
    }).collectResource({ url, outputDir, resourceKind: 'smartpage', legacyMode: true });
    if (outcome.status !== 'complete') throw new Error(outcome.reason || outcome.status);
    return;
  }
  if (command === 'feishu-minutes') {
    const minuteToken = requireValue(values, 'minute-token');
    const url = requireValue(values, 'url');
    const outputDir = requireAbsoluteOutputDir(values);
    const outcome = await createFeishuAdapter({
      bin: process.env.LARK_CLI_BIN || 'lark-cli',
      env: process.env,
    }).collectResource({ resourceKind: 'minutes', minuteToken, url, outputDir, legacyMode: true });
    if (outcome.status !== 'complete') throw new Error(outcome.reason || outcome.status);
    return;
  }
  if (command === 'search' || command === 'resource') {
    render(await dispatchEnterprise(command, values));
    return;
  }
  throw new Error(`unsupported command: ${command || '(missing)'}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
