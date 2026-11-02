import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authorizePublicSource } from './discovery-authorization.mjs';
import { assertExternalSessionWriteAllowed } from './probe-state.mjs';
import { assertNoSensitiveKeys, isInside, loadSession, requireString } from './session.mjs';

const SOURCE_URL = 'https://channels.weixin.qq.com/platform/statistic/post';
const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BASE_COMMANDS = ['overview', 'trend', 'sources', 'posts'];
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

function safeFile(root, candidate) {
  if (!isInside(root, candidate) || !fs.existsSync(candidate)) throw new Error('STATISTICS_PATH_INVALID: 文件不存在或越界');
  for (let current = candidate; ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('STATISTICS_SYMLINK: 路径不能包含符号链接');
    if (current === root) break;
  }
  if (!fs.statSync(candidate).isFile() || !isInside(fs.realpathSync(root), fs.realpathSync(candidate))) {
    throw new Error('STATISTICS_PATH_INVALID: 必须是受控普通文件');
  }
  return fs.readFileSync(candidate);
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error('STATISTICS_PATH_INVALID: 输出目录不能是符号链接或文件');
    }
  }
}

function readDataset(paths, rawRoot, entry) {
  const file = path.resolve(paths.root, requireString(entry.artifact, 'results.artifact'));
  const content = safeFile(rawRoot, file);
  if (content.length !== entry.size || digest(content) !== entry.sha256) throw new Error('STATISTICS_INTEGRITY: 来源 JSON 哈希或长度变化');
  const value = JSON.parse(content.toString('utf8'));
  if (!Array.isArray(value)) throw new Error('STATISTICS_INCOMPLETE: 来源结果必须为 JSON 数组');
  assertNoSensitiveKeys(value, 'statistics');
  return { ...entry, data: value };
}

function validateResults(datasets) {
  for (const command of BASE_COMMANDS) {
    if (datasets.filter(entry => entry.command === command).length !== 1) {
      throw new Error(`STATISTICS_INCOMPLETE: ${command} 必须有且只有一份结果`);
    }
  }
  if (datasets.some(entry => ![...BASE_COMMANDS, 'post-detail'].includes(entry.command))) throw new Error('STATISTICS_INCOMPLETE: 未知来源命令');
  if (datasets.find(entry => entry.command === 'overview').data.length !== 1) throw new Error('STATISTICS_INCOMPLETE: overview 结果缺失');
  const posts = datasets.find(entry => entry.command === 'posts').data;
  const ids = posts.map(post => post?.id);
  if (ids.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('STATISTICS_INCOMPLETE: post ID 必须是唯一数字字符串');
  }
  const details = datasets.filter(entry => entry.command === 'post-detail');
  if (details.length !== ids.length || new Set(details.map(entry => entry.postId)).size !== ids.length) {
    throw new Error('STATISTICS_INCOMPLETE: 视频样本详情不完整');
  }
  for (const detail of details) {
    if (!ids.includes(detail.postId) || detail.data.length !== 1 || detail.data[0]?.id !== detail.postId
      || !Array.isArray(detail.data[0]?.data_details)) throw new Error('STATISTICS_INCOMPLETE: 视频详情身份或数据详情不匹配');
  }
}

function renderStatistics(executor, datasets) {
  const title = '微信视频号统计数据';
  const sections = [
    '---', `title: ${JSON.stringify(title)}`, 'source: public-internet',
    `source_url: ${JSON.stringify(executor.sourceUrl)}`, 'collection_filters: {}', '---', '',
    `# ${title}`, '',
    `本材料为最近 ${executor.days} 天的统计数据。视频列表最多采集 ${executor.limit} 条，详情覆盖本次返回的视频样本。`,
    '这是结构化数据材料，正文粒度为 unknown。原始 JSON 中的字符串 ID、零、null 和负数按来源结果保留。', '',
  ];
  for (const entry of datasets) {
    const json = JSON.stringify(entry.data, null, 2);
    const longestFence = Math.max(0, ...(json.match(/`+/g) || []).map(match => match.length));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    sections.push(`## ${entry.command}${entry.postId ? ` · ${entry.postId}` : ''}`, '', `${fence}json`, json, fence, '');
  }
  return `${sections.join('\n')}\n`;
}

export function runWeixinChannelsMaterialize(paths, args) {
  const startedAt = performance.now();
  const itemId = requireString(args['item-id'], '--item-id');
  if (!ITEM_ID.test(itemId)) throw new Error('--item-id 格式无效');
  const { session } = loadSession(paths, { persistMigration: false });
  assertExternalSessionWriteAllowed(paths, 'materialize-weixin-channels');
  if (!session.task.sourceScope?.includes('public-internet')) throw new Error('SOURCE_SCOPE_DENIED: 未授权公共网站来源');
  if (session.task.requiredContentGranularity === 'full-text') throw new Error('统计数据不能满足 full-text 全文任务');
  if (session.task.materializationTarget === 'candidates') throw new Error('统计物化不适用于 candidates 任务');
  const relative = `raw/bycli/weixin-channels/${itemId}/executor-result.json`;
  const file = path.resolve(requireString(args['executor-result-file'], '--executor-result-file'));
  if (file !== path.join(paths.root, relative)) throw new Error('STATISTICS_PATH_INVALID: 必须使用当前条目的受控执行结果');
  const rawRoot = path.join(paths.root, 'raw/bycli/weixin-channels', itemId);
  const content = safeFile(paths.root, file);
  const receipt = session.task.weixinChannelsAcquisitions?.find(entry => entry.itemId === itemId && entry.artifact === relative);
  if (!receipt) throw new Error('ACQUISITION_NOT_REGISTERED: 未登记受控统计采集回执');
  if (receipt.sha256 !== digest(content)) throw new Error('STATISTICS_INTEGRITY: 采集回执哈希变化');
  const executor = JSON.parse(content.toString('utf8'));
  assertNoSensitiveKeys(executor, 'executorResult');
  if (executor.schemaVersion !== '1.0' || executor.executor !== 'bycli' || executor.adapter !== 'weixin-channels'
    || executor.status !== 'saved' || executor.exitCode !== 0 || executor.itemId !== itemId
    || executor.sourceUrl !== SOURCE_URL || receipt.sourceUrl !== SOURCE_URL
    || !Number.isInteger(executor.days) || executor.days < 1 || executor.days > 366
    || !Number.isInteger(executor.limit) || executor.limit < 1 || executor.limit > 100
    || !Array.isArray(executor.results)) throw new Error('STATISTICS_INCOMPLETE: 采集结果未确认成功');
  const authorization = authorizePublicSource(session.task.discoveryGate, executor.sourceUrl);
  if (authorization?.origin !== 'user-provided') throw new Error('SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: 统计 URL 必须已由 init 授权');
  const datasets = executor.results.map(entry => readDataset(paths, rawRoot, entry));
  validateResults(datasets);
  const markdownPath = `markdown/items/${itemId}/index.md`;
  const sanitizedPath = `sanitized/items/${itemId}/index.md`;
  const payloadRelative = `.collection-inputs/weixin-channels-${itemId}.json`;
  for (const output of [markdownPath, sanitizedPath, payloadRelative]) {
    if (fs.existsSync(path.join(paths.root, output))) throw new Error('MATERIALIZATION_CONFLICT: 目标文件已存在');
  }
  for (const directory of [`markdown/items/${itemId}`, `sanitized/items/${itemId}`, '.collection-inputs']) {
    ensureDirectory(paths.root, directory);
  }
  const markdown = renderStatistics(executor, datasets);
  const payload = {
    schemaVersion: '1.0', itemId, source: 'public-internet', sourceSkill: 'bycli', backend: 'bycli', sourceUrl: executor.sourceUrl,
    rawArtifacts: [relative, ...datasets.map(entry => entry.artifact)], contentGranularity: 'unknown',
    media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null },
    markdownPath, sanitizedPath,
    sourceMetadata: { adapter: 'weixin-channels', days: executor.days, limit: executor.limit,
      commandCount: datasets.length, postCount: datasets.find(entry => entry.command === 'posts').data.length,
      detailCount: datasets.filter(entry => entry.command === 'post-detail').length },
    canonicalItem: { title: '微信视频号统计数据', url: executor.sourceUrl, author: '', publishTime: '',
      markdown: sanitizedPath, fileName: sanitizedPath },
  };
  const created = [];
  try {
    for (const [relativeOutput, contents] of [
      [markdownPath, markdown], [sanitizedPath, markdown],
      [payloadRelative, `${JSON.stringify(payload, null, 2)}\n`],
    ]) {
      const absolute = path.join(paths.root, relativeOutput);
      const descriptor = fs.openSync(absolute, 'wx', 0o600);
      const output = { absolute, identity: null, contents: Buffer.from(contents) };
      created.push(output);
      try {
        output.identity = fs.fstatSync(descriptor);
        fs.writeFileSync(descriptor, contents);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    // Roll back only unchanged files this call created, leaving raw and existing user files intact.
    for (const output of created.reverse()) {
      try {
        const identity = fs.lstatSync(output.absolute);
        const bytes = safeFile(paths.root, output.absolute);
        if (identity.dev === output.identity?.dev && identity.ino === output.identity?.ino
          && bytes.length <= output.contents.length && bytes.equals(output.contents.subarray(0, bytes.length))) {
          fs.unlinkSync(output.absolute);
        }
      } catch { /* Preserve changed or inaccessible files for inspection. */ }
    }
    throw error;
  }
  return { ok: true, action: 'materialize-weixin-channels', itemId,
    materialization: { status: 'materialized', contentGranularity: 'unknown', markdownPath, sanitizedPath },
    collectPayloadPath: path.join(paths.root, payloadRelative), timing: { totalMs: Math.round(performance.now() - startedAt) } };
}
