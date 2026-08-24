#!/usr/bin/env node
/**
 * knowledge-collection.mjs — 知识采集一体化 CLI(单一入口)。
 *
 * 统一分派三类命令:
 *   研究维度   init / plan / branch / aggregate / report      (research-state.mjs)
 *   采集维度   collect / inspect / run / cleanup / unlock-stale /
 *              set-retention / rewrite-image-links / export-views   (collection-state.mjs)
 *   平台维度   list-kb / upload-doc / upload-images / upload-resource /
 *              normalize / ingest / store / enterprise ...   (ingest.mjs / enterprise-collection.mjs)
 *
 * 状态: 单一文件 <session-dir>/session.json(task + research + collection)。
 * 输出契约: stdout 单个 JSON 对象(默认缩进;--compact 输出单行);失败输出
 *           { ok:false, error } 且退出码 1。
 * 帮助: `knowledge-collection.mjs help`、`... <command> --help`。
 */
'use strict';

import { executeLocalCommand } from './command-router.mjs';
import { delegatePlatformCommand } from './platform-delegate.mjs';

const VERSION = '2.1.0';

function render(value, compact = false) {
  process.stdout.write(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
}

function defineCommand(spec) {
  return spec;
}

const COMMAND_SPECS = {
  'public-discover': defineCommand({
    group: 'discovery',
    title: '并行运行 SearXNG 与 hot-discovery，持久化并合并公共 URL 候选',
    args: {
      '--session-dir': '必填。已由 init 创建的会话目录',
      '--query': '必填。公共互联网检索词',
      '--category': '可选。SearXNG 类别，默认 general；同值传给 hot-discovery，后者额外补 general',
      '--language': '可选。SearXNG 语言，默认 all',
      '--pageno': '可选。SearXNG 页码，默认 1',
      '--max-results': '可选。SearXNG 结果上限，默认 20',
      '--timeout': '可选。SearXNG 超时秒数，默认 15',
      '--time-range': '可选。SearXNG 时间范围：day | week | month | year',
      '--tiers': '可选。hot-discovery 档位，默认 1,2,3',
      '--limit': '可选。每个 hot-discovery 适配器的结果上限，默认 20',
    },
    example: 'knowledge-collection.mjs public-discover --session-dir /tmp/kc1 --query "DeepSeek Harness" --category it --language zh-CN',
  }),
  init: defineCommand({
    group: 'research',
    title: '创建研究/采集会话骨架与 session.json',
    args: {
      '--session-dir': '必填。会话目录(必须不存在或为空)',
      '--query': '必填。研究问题或采集任务描述',
      '--mode': 'collection(默认) | research。research 要求 report 交付后才允许整体清理',
      '--breadth': '正整数,默认 3;每层分支数',
      '--depth': '正整数,默认 2;最大递归层数',
      '--concurrency': '正整数,默认 2;同层并发上限',
      '--max-context-words': '正整数,默认 25000',
      '--deadline-minutes': '可选。正整数;超时后禁止登记非失败分支',
      '--max-branches': '可选。正整数;研究分支总数上限',
      '--max-sources-per-branch': '可选。正整数;单分支来源数上限',
      '--max-search-rounds': '可选。正整数;检索轮数上限',
      '--source-scope': 'JSON 数组;默认 ["public-internet"]. 可选 public-internet、dingtalk、feishu、wecom、ima',
      '--materialization-target': 'candidates | selected(默认) | all。all 表示所有请求正文必须物化或如实标记失败/待处理',
      '--started-at': '可选。ISO 时间;缺省为当前时间',
      '--collection-result-input-file': '可选。预置 canonical collection-result.json',
      '--metadata-input-file': '可选。预置 collection metadata',
    },
    example: 'knowledge-collection.mjs init --session-dir /tmp/kc1 --query "研究问题" --depth 2 --deadline-minutes 10',
  }),
  plan: defineCommand({
    group: 'research',
    title: '记录初始检索、follow-ups、合并起始查询与三通道覆盖表',
    args: {
      '--session-dir': '必填',
      '--initial-search': 'JSON 数组,必填(初始检索记录)',
      '--channels': '必填。JSON 对象;三个发现通道 builtin-routing / searxng / hot-discovery 逐个表态,'
        + '{"<通道>":{"state":"used|unavailable|not-applicable","reason":"非 used 时必填,须具体"}}。'
        + '漏一个即报错;reason 笼统(如「跳过」「不适用」)或短于 8 字符即报错',
      '--followups': 'JSON 数组,可选',
      '--combined-query': '文本,可选',
    },
    example: 'knowledge-collection.mjs plan --session-dir /tmp/kc1 --initial-search \'["arxiv", "github"]\''
      + ' --channels \'{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},'
      + '"hot-discovery":{"state":"unavailable","reason":"images 维度无免登录热度源"}}\' --combined-query "combined"',
  }),
  branch: defineCommand({
    group: 'research',
    title: '登记一个研究分支(learnings/citations 必须可回溯到 inventory)',
    args: {
      '--session-dir': '必填',
      '--level': '必填。>=1 且 <= depth',
      '--query': '必填。分支查询',
      '--research-goal': 'status 非 failed 时必填',
      '--learnings': 'JSON 字符串数组',
      '--citations': 'JSON 对象;value 必须是 inventory itemId 或 sourceUrl',
      '--followups': 'JSON 字符串数组',
      '--sources': 'JSON URL/URI 数组;必须已登记在 inventory',
      '--context': 'JSON 字符串数组',
      '--search-queries': 'JSON 数组;{query,skill,engine,resultCount,status}',
      '--status': 'done | pending | failed(默认 done)',
      '--reason': 'status=failed 时必填',
      '--id': '可选。稳定分支 ID',
      '--parent-id': '可选。父分支 ID',
    },
    example: 'knowledge-collection.mjs branch --session-dir /tmp/kc1 --level 1 --query "arXiv 论文" --citations \'{"item-1":"item-1"}\' --sources \'["https://arxiv.org/abs/..."]\' --status done',
  }),
  aggregate: defineCommand({
    group: 'research',
    title: '去重 learnings/sources 并裁剪 context',
    args: { '--session-dir': '必填' },
    example: 'knowledge-collection.mjs aggregate --session-dir /tmp/kc1',
  }),
  report: defineCommand({
    group: 'research',
    title: '校验并标记报告完成,渲染 research-tree.md',
    args: {
      '--session-dir': '必填',
      '--report-path': '可选。默认 <session-dir>/report.md;必须在会话目录内',
      '--stop-reason': '可选。未达到配置 depth 而提前停止的原因',
      '--allow-incomplete': '可选布尔。显式允许不完整报告',
    },
    example: 'knowledge-collection.mjs report --session-dir /tmp/kc1',
  }),
  collect: defineCommand({
    group: 'collection',
    title: '登记执行器抓取结果并物化(不执行抓取)',
    args: {
      '--session-dir': '必填',
      '--item-json-file': '必填。位于 .post-processing-inputs/ 内的 payload',
      '--dry-run': '可选。仅校验,不持久化',
    },
    example: 'knowledge-collection.mjs collect --session-dir /tmp/kc1 --item-json-file /tmp/kc1/.post-processing-inputs/items.json',
  }),
  inspect: defineCommand({
    group: 'collection',
    title: '读取会话与续跑状态(默认只读)',
    args: {
      '--session-dir': '必填',
      '--operation': '可选。ingest | organize | external',
      '--target-json': '可选。JSON 目标对象',
      '--drain-pending': '可选。显式清理 pendingArtifactCleanup 中的旧工作副本',
      '--full': '可选。返回完整 metadata 与 collectionResult',
    },
    example: 'knowledge-collection.mjs inspect --session-dir /tmp/kc1 --operation ingest --target-json \'{"kind":"knowledge-base","id":"kb-1","path":"/kb"}\'',
  }),
  run: defineCommand({
    group: 'collection',
    title: '登记一次后处理运行结果(只登记,不执行下游)',
    args: {
      '--session-dir': '必填',
      '--run-json-file': '必填。位于 .post-processing-inputs/ 内的 run payload',
      '--dry-run': '可选。仅校验,不持久化',
      '--full': '可选。返回完整 metadata',
    },
    example: 'knowledge-collection.mjs run --session-dir /tmp/kc1 --run-json-file /tmp/kc1/.post-processing-inputs/run.json',
  }),
  cleanup: defineCommand({
    group: 'collection',
    title: '按 run 状态清理会话(研究模式要求 report 已交付)',
    args: {
      '--session-dir': '必填',
      '--run-id': '必填',
      '--dry-run': '可选。只计算清理方案,不删除',
      '--full': '可选。返回完整 metadata 与 collectionResult',
      '--archive-deliverables': '可选。整体清理前把 report.md/research-tree.md 复制到 <session>.delivered/',
    },
    example: 'knowledge-collection.mjs cleanup --session-dir /tmp/kc1 --run-id run-1',
  }),
  'unlock-stale': defineCommand({
    group: 'collection',
    title: '仅在锁持有 PID 已不存在时回收残留锁',
    args: { '--session-dir': '必填' },
    example: 'knowledge-collection.mjs unlock-stale --session-dir /tmp/kc1',
  }),
  'set-retention': defineCommand({
    group: 'collection',
    title: '设置是否保留会话工作副本',
    args: {
      '--session-dir': '必填',
      '--keep': '必填。true | false',
      '--dry-run': '可选。只返回将写入的值',
    },
    example: 'knowledge-collection.mjs set-retention --session-dir /tmp/kc1 --keep true',
  }),
  'rewrite-image-links': defineCommand({
    group: 'collection',
    title: '改写 sanitized 正文中的本地图片链接',
    args: {
      '--session-dir': '必填',
      '--resource-id': '会话空间模式必填',
      '--link-map-file': '持久化模式必填(二选一)',
      '--item-id': '可重复。只改写指定 inventory item;缺省为全部',
      '--item-ids': '逗号分隔的 itemId 列表',
      '--base-url': '可选 http/https origin',
      '--workspace-root': '可选。回退工作区根',
      '--language': '默认 zh-CN',
      '--dry-run': '只统计不写盘',
    },
    example: 'knowledge-collection.mjs rewrite-image-links --session-dir /tmp/kc1 --link-map-file /tmp/kc1/.post-processing-inputs/image-link-map.json --item-ids item-1,item-2',
  }),
  'export-views': defineCommand({
    group: 'collection',
    title: '由 session.json 生成 sanitized/metadata.json 与 collection-result.json',
    args: { '--session-dir': '必填' },
    example: 'knowledge-collection.mjs export-views --session-dir /tmp/kc1',
  }),
  'crawl-seed': defineCommand({
    group: 'crawl',
    title: '用发现结果建立/扩充待爬队列(不取内容)',
    args: {
      '--session-dir': '必填',
      '--urls-file': '必填。含 URL 的文件;接受 sitemap XML(<loc>)、Markdown 链接或裸 URL',
      '--scope-prefix': '可选。同域/同路径前缀白名单,超出范围的 URL 丢弃',
      '--max-pages': '可选。正整数;frontier 容量上限,超出部分记为 overCap',
      '--depth': '可选。正整数,默认 1;记录本次允许的最大层数',
    },
    example: "knowledge-collection.mjs crawl-seed --session-dir /tmp/kc1 --urls-file /tmp/sitemap.md --scope-prefix https://docs.example.com/ --max-pages 40",
  }),
  'crawl-next': defineCommand({
    group: 'crawl',
    title: '取出待抓 URL 交给来源执行器(只读)',
    args: {
      '--session-dir': '必填',
      '--limit': '可选。正整数,默认 10;单批返回上限',
    },
    example: 'knowledge-collection.mjs crawl-next --session-dir /tmp/kc1 --limit 5',
  }),
  'crawl-mark': defineCommand({
    group: 'crawl',
    title: '登记一批抓取结果(pending → fetched/failed/skipped)',
    args: {
      '--session-dir': '必填',
      '--mark-json-file': '必填。位于 .post-processing-inputs/ 内;{results:[{url,status,itemId?,reason?}]}',
    },
    example: 'knowledge-collection.mjs crawl-mark --session-dir /tmp/kc1 --mark-json-file /tmp/kc1/.post-processing-inputs/mark.json',
  }),
  'crawl-status': defineCommand({
    group: 'crawl',
    title: '查看 frontier 计数与范围配置',
    args: { '--session-dir': '必填' },
    example: 'knowledge-collection.mjs crawl-status --session-dir /tmp/kc1',
  }),
  status: defineCommand({
    group: 'summary',
    title: '会话综合状态(研究 + 采集 + warnings)',
    args: {
      '--session-dir': '必填',
      '--full': '可选。返回完整 task/research 摘要与 collection 详情',
    },
    example: 'knowledge-collection.mjs status --session-dir /tmp/kc1',
  }),
  'list-kb': defineCommand({
    group: 'platform',
    title: '列出知识库(委派 ingest.mjs,无需 session)',
    args: { '--help': '查看 ingest.mjs 完整参数' },
    example: 'knowledge-collection.mjs list-kb --help',
  }),
  'upload-doc': defineCommand({
    group: 'platform',
    title: '直传文档(委派 ingest.mjs)',
    args: { '--help': '查看 ingest.mjs 完整参数' },
    example: 'knowledge-collection.mjs upload-doc --help',
  }),
  'upload-images': defineCommand({
    group: 'platform',
    title: '上传正文图片并生成链接映射(委派 ingest.mjs)',
    args: { '--help': '查看 ingest.mjs 完整参数' },
    example: 'knowledge-collection.mjs upload-images --help',
  }),
  'upload-resource': defineCommand({
    group: 'platform',
    title: '上传资源(委派 ingest.mjs)',
    args: { '--help': '查看 ingest.mjs 完整参数' },
    example: 'knowledge-collection.mjs upload-resource --help',
  }),
  normalize: defineCommand({
    group: 'platform',
    title: '规范化正文(委派 ingest.mjs)',
    args: { '--help': '查看 ingest.mjs 完整参数' },
    example: 'knowledge-collection.mjs normalize --help',
  }),
  ingest: defineCommand({
    group: 'platform',
    title: '导入/存储(委派 ingest.mjs)',
    args: { '--help': '查看 ingest.mjs 完整参数' },
    example: 'knowledge-collection.mjs ingest --help',
  }),
  store: defineCommand({
    group: 'platform',
    deprecated: true,
    title: '已废弃,请使用 ingest',
    args: {},
    example: 'knowledge-collection.mjs ingest --help',
  }),
  enterprise: defineCommand({
    group: 'platform',
    title: '企业来源采集: search | search-all | materialize | resource | resume-resource；兼容 wecom-smartpage | feishu-minutes(委派 enterprise-collection.mjs)',
    args: { '<subcommand>': 'search、search-all、materialize、resource、resume-resource、wecom-smartpage 或 feishu-minutes' },
    example: 'knowledge-collection.mjs enterprise search --source dingtalk --query "季度计划" --output-dir /tmp/enterprise',
  }),
};

const GLOBAL_FLAGS = new Set(['help', 'compact', 'pretty']);
const LEGACY_ALIASES = new Map([
  ['init-session', 'init'],
  ['mark-materialized', 'collect'],
  ['record-run', 'run'],
]);

const SCHEMA = {
  absolutePath: { type: 'string', format: 'absolute-path' },
  sessionDir: { type: 'string', format: 'absolute-path' },
  file: { type: 'string', format: 'file-path' },
  inputFile: { type: 'string', format: 'post-processing-input-file' },
  jsonArray: { type: 'array', cliEncoding: 'json', items: { type: 'string' } },
  jsonObject: { type: 'object', cliEncoding: 'json' },
  boolean: { type: 'boolean' },
  positiveInteger: { type: 'integer', minimum: 1 },
};

const COMMAND_SCHEMA_OVERRIDES = {
  'public-discover': {
    required: ['session-dir', 'query'],
    properties: {
      'session-dir': SCHEMA.sessionDir,
      query: { type: 'string', minLength: 1 },
      category: { type: 'string', default: 'general' },
      language: { type: 'string', default: 'all' },
      pageno: { ...SCHEMA.positiveInteger, default: 1 },
      'max-results': { ...SCHEMA.positiveInteger, default: 20 },
      timeout: { type: 'number', minimum: 0.001, default: 15 },
      'time-range': { type: 'string', enum: ['day', 'week', 'month', 'year'] },
      tiers: { type: 'string', default: '1,2,3' },
      limit: { ...SCHEMA.positiveInteger, default: 20 },
    },
  },
  init: {
    required: ['session-dir', 'query'],
    properties: {
      'session-dir': SCHEMA.sessionDir,
      query: { type: 'string', minLength: 1 },
      mode: { type: 'string', enum: ['collection', 'research'], default: 'collection' },
      breadth: { ...SCHEMA.positiveInteger, default: 3 },
      depth: { ...SCHEMA.positiveInteger, default: 2 },
      concurrency: { ...SCHEMA.positiveInteger, default: 2 },
      'max-context-words': { ...SCHEMA.positiveInteger, default: 25000 },
      'deadline-minutes': SCHEMA.positiveInteger,
      'max-branches': SCHEMA.positiveInteger,
      'max-sources-per-branch': SCHEMA.positiveInteger,
      'max-search-rounds': SCHEMA.positiveInteger,
      'source-scope': {
        type: 'array', minItems: 1, uniqueItems: true, default: ['public-internet'], cliEncoding: 'json',
        items: { type: 'string', enum: ['public-internet', 'dingtalk', 'feishu', 'wecom', 'ima'] },
      },
      'materialization-target': { type: 'string', enum: ['candidates', 'selected', 'all'], default: 'selected' },
      'started-at': { type: 'string', format: 'date-time' },
      'collection-result-input-file': SCHEMA.file,
      'metadata-input-file': SCHEMA.file,
    },
  },
  plan: {
    required: ['session-dir', 'initial-search', 'channels'],
    properties: {
      'session-dir': SCHEMA.sessionDir,
      'initial-search': SCHEMA.jsonArray,
      channels: SCHEMA.jsonObject,
      followups: SCHEMA.jsonArray,
      'combined-query': { type: 'string', minLength: 1 },
    },
  },
  branch: {
    required: ['session-dir', 'level', 'query'],
    properties: {
      'session-dir': SCHEMA.sessionDir,
      level: SCHEMA.positiveInteger,
      query: { type: 'string', minLength: 1 },
      'research-goal': { type: 'string', minLength: 1 },
      learnings: SCHEMA.jsonArray,
      citations: SCHEMA.jsonObject,
      followups: SCHEMA.jsonArray,
      sources: { ...SCHEMA.jsonArray, items: { type: 'string', minLength: 1, format: 'url-or-source-uri' } },
      context: SCHEMA.jsonArray,
      'search-queries': { type: 'array', cliEncoding: 'json', items: { type: 'object' } },
      status: { type: 'string', enum: ['done', 'pending', 'failed'], default: 'done' },
      reason: { type: 'string', minLength: 1 },
      id: { type: 'string', minLength: 1 },
      'parent-id': { type: 'string', minLength: 1 },
    },
    allOf: [
      { if: { required: ['status'], properties: { status: { const: 'failed' } } }, then: { required: ['reason'] } },
      { if: { required: ['status'], properties: { status: { enum: ['done', 'pending'] } } }, then: { required: ['research-goal'] } },
      { if: { not: { required: ['status'] } }, then: { required: ['research-goal'] } },
    ],
  },
  aggregate: { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir } },
  report: {
    required: ['session-dir'],
    properties: {
      'session-dir': SCHEMA.sessionDir,
      'report-path': { type: 'string', format: 'path-within-session' },
      'stop-reason': { type: 'string', minLength: 1 },
      'allow-incomplete': { ...SCHEMA.boolean, default: false },
    },
  },
  collect: { required: ['session-dir', 'item-json-file'], properties: { 'session-dir': SCHEMA.sessionDir, 'item-json-file': SCHEMA.inputFile, 'dry-run': SCHEMA.boolean } },
  inspect: { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir, operation: { type: 'string', enum: ['ingest', 'organize', 'external'] }, 'target-json': SCHEMA.jsonObject, 'drain-pending': SCHEMA.boolean, full: SCHEMA.boolean } },
  run: { required: ['session-dir', 'run-json-file'], properties: { 'session-dir': SCHEMA.sessionDir, 'run-json-file': SCHEMA.inputFile, 'dry-run': SCHEMA.boolean, full: SCHEMA.boolean } },
  cleanup: { required: ['session-dir', 'run-id'], properties: { 'session-dir': SCHEMA.sessionDir, 'run-id': { type: 'string', minLength: 1 }, 'dry-run': SCHEMA.boolean, full: SCHEMA.boolean, 'archive-deliverables': SCHEMA.boolean } },
  'unlock-stale': { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir } },
  'set-retention': { required: ['session-dir', 'keep'], properties: { 'session-dir': SCHEMA.sessionDir, keep: SCHEMA.boolean, 'dry-run': SCHEMA.boolean } },
  'rewrite-image-links': {
    required: ['session-dir'],
    properties: {
      'session-dir': SCHEMA.sessionDir, 'resource-id': { type: 'string', minLength: 1 }, 'link-map-file': SCHEMA.inputFile,
      'item-id': { type: 'array', cliEncoding: 'repeatable', items: { type: 'string', minLength: 1 } },
      'item-ids': { type: 'array', cliEncoding: 'comma-separated', items: { type: 'string', minLength: 1 } },
      'base-url': { type: 'string', format: 'http-origin' }, 'workspace-root': SCHEMA.absolutePath,
      language: { type: 'string', default: 'zh-CN' }, 'dry-run': SCHEMA.boolean,
    },
    oneOf: [{ required: ['resource-id'] }, { required: ['link-map-file'] }],
  },
  'export-views': { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir } },
  'crawl-seed': { required: ['session-dir', 'urls-file'], properties: { 'session-dir': SCHEMA.sessionDir, 'urls-file': SCHEMA.file, 'scope-prefix': { type: 'string', format: 'http-url' }, 'max-pages': SCHEMA.positiveInteger, depth: { ...SCHEMA.positiveInteger, default: 1 } } },
  'crawl-next': { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir, limit: { ...SCHEMA.positiveInteger, default: 10 } } },
  'crawl-mark': { required: ['session-dir', 'mark-json-file'], properties: { 'session-dir': SCHEMA.sessionDir, 'mark-json-file': SCHEMA.inputFile } },
  'crawl-status': { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir } },
  status: { required: ['session-dir'], properties: { 'session-dir': SCHEMA.sessionDir, full: SCHEMA.boolean } },
};

function commandSchema() {
  const commands = {};
  for (const [name, spec] of Object.entries(COMMAND_SPECS)) {
    if (spec.group === 'platform') {
      const childScript = name === 'enterprise' ? 'enterprise-collection.mjs' : 'ingest.mjs';
      commands[name] = {
        type: 'delegated-command',
        delegatedTo: {
          script: `scripts/${childScript}`,
          schemaCommand: `node scripts/${childScript} command-schema`,
          command: name,
        },
        ...(spec.deprecated ? { deprecated: true } : {}),
      };
      continue;
    }
    const override = COMMAND_SCHEMA_OVERRIDES[name];
    if (!override) {
      throw new Error(`命令 ${name} 缺少 machine-readable schema`);
    }
    commands[name] = {
      type: 'object',
      additionalProperties: false,
      required: override.required,
      properties: override.properties,
      schemaComplete: true,
      ...(override.allOf ? { allOf: override.allOf } : {}),
      ...(override.oneOf ? { oneOf: override.oneOf } : {}),
      ...(spec.deprecated ? { deprecated: true } : {}),
    };
  }
  return {
    ok: true,
    name: 'knowledge-collection',
    schemaVersion: '1.0',
    cli: { flagStyle: '--kebab-case', jsonArrayEncoding: 'JSON string array' },
    commands,
  };
}

function parseArgs(argv) {
  const args = {};
  const positionals = [];
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      if (command === null) {
        command = token;
      } else {
        positionals.push(token);
      }
      continue;
    }
    let key = token.slice(2);
    let inlineValue;
    const eqIndex = key.indexOf('=');
    if (eqIndex > -1) {
      inlineValue = key.slice(eqIndex + 1);
      key = key.slice(0, eqIndex);
    }
    if (!key) {
      throw new Error(`非法参数: ${token}`);
    }
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith('--') && next !== '--')) {
        value = true;
      } else {
        value = next;
        index += 1;
      }
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  }
  return { command, args, positionals };
}

function allowedFlags(command) {
  const canonical = LEGACY_ALIASES.get(command) || command;
  const spec = COMMAND_SPECS[canonical];
  if (!spec || ['platform'].includes(spec.group)) {
    return null;
  }
  const flags = new Set([...GLOBAL_FLAGS]);
  for (const raw of Object.keys(spec.args)) {
    const name = raw.replace(/^<.*>$/, '').startsWith('--') ? raw.slice(2) : raw;
    flags.add(name);
  }
  return flags;
}

function validateFlags(command, args) {
  const flags = allowedFlags(command);
  if (!flags) {
    return;
  }
  for (const [key] of Object.entries(args)) {
    if (!flags.has(key)) {
      throw new Error(`未知参数 --${key}${COMMAND_SPECS[command] ? '' : ''};请运行 \`knowledge-collection.mjs ${command} --help\``);
    }
  }
}

function commandHelp(command) {
  const canonical = LEGACY_ALIASES.get(command) || command;
  const spec = COMMAND_SPECS[canonical];
  if (!spec) {
    return { ok: false, error: `未知命令: ${command}`, commands: Object.keys(COMMAND_SPECS) };
  }
  return {
    ok: true,
    command: canonical,
    title: spec.title,
    group: spec.group,
    deprecated: Boolean(spec.deprecated),
    args: spec.args,
    example: spec.example,
    legacyAlias: [...LEGACY_ALIASES.entries()].find(([, target]) => target === canonical)?.[0] || undefined,
  };
}

function help() {
  const groups = {};
  for (const [name, spec] of Object.entries(COMMAND_SPECS)) {
    (groups[spec.group] ||= []).push({ name, title: spec.title, deprecated: Boolean(spec.deprecated) });
  }
  return {
    ok: true,
    name: 'knowledge-collection',
    version: VERSION,
    stateFile: '<session-dir>/session.json (schemaVersion 2.0, task+research+collection 一体化)',
    output: '默认缩进 JSON;--compact 输出单行 JSON',
    usage: 'knowledge-collection.mjs <command> [options]',
    commandsByGroup: groups,
    legacyAliases: Object.fromEntries(LEGACY_ALIASES),
    next: '运行 `knowledge-collection.mjs <command> --help` 查看命令参数与示例',
  };
}

function compactRequested(args) {
  return args.compact === true || args.compact === 'true' || args.compact === '1';
}

function main() {
  const { command: rawCommand, args, positionals } = parseArgs(process.argv.slice(2));
  const command = rawCommand || 'help';
  if (command === 'help') {
    const target = positionals[0] || (typeof args.query === 'string' ? args.query : null);
    render(target ? commandHelp(target) : help(), compactRequested(args));
    return;
  }
  if (command === 'version' || args.version === true) {
    render({ ok: true, name: 'knowledge-collection', version: VERSION }, compactRequested(args));
    return;
  }
  if (command === 'command-schema') {
    render(commandSchema(), compactRequested(args));
    return;
  }

  // 平台维度:先委派,不得要求 --session-dir;--help 交给子脚本输出真实参数。
  if (delegatePlatformCommand(command, process.argv.slice(2))) {
    return;
  }

  if (args.help === true || args.help === 'true') {
    render(commandHelp(command), compactRequested(args));
    return;
  }

  const canonical = LEGACY_ALIASES.get(command) || command;
  validateFlags(canonical, args);
  if (!COMMAND_SPECS[canonical]) {
    throw new Error(`未知命令: ${command}`);
  }

  render(executeLocalCommand(canonical, args), compactRequested(args));
}

try {
  main();
} catch (error) {
  render({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, false);
  process.exitCode = 1;
}
