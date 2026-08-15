#!/usr/bin/env node
/**
 * knowledge-collection.mjs — 知识采集一体化 CLI(单一入口)。
 *
 * 统一分派三类命令:
 *   研究维度   init / plan / branch / aggregate / report      (research-state.mjs)
 *   采集维度   collect / inspect / run / cleanup / unlock-stale /
 *              set-retention / rewrite-image-links / export-views   (collection-state.mjs)
 *   平台维度   list-kb / upload-doc / upload-images / upload-resource /
 *              normalize / store / enterprise ...                  (ingest.mjs / enterprise-collection.mjs)
 * 状态: 单一文件 <session-dir>/session.json(task + research + collection)。
 * 输出契约: stdout 单行 JSON; 失败输出 { ok:false, error } 且退出码 1。
 */
'use strict';

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cmdInit, cmdPlan, cmdBranch, cmdAggregate, cmdReport, cmdResearchStatus, researchHelp,
} from './research-state.mjs';
import {
  cmdCollect, cmdInspect, cmdRun, cmdCleanup, cmdUnlockStale, cmdSetRetention,
  cmdRewriteImageLinks, cmdExportViews, collectionStatus, collectionHelp,
} from './collection-state.mjs';
import { sessionPaths } from './session.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const command = argv[0];
  const args = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`无法识别的参数: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return { command, args };
}

function delegate(childScript, argv) {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, childScript), ...argv], {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}

function help() {
  return {
    name: 'knowledge-collection',
    stateFile: '<session-dir>/session.json (schemaVersion 2.0, task+research+collection 一体化)',
    commands: {
      // 研究维度
      init: '创建会话骨架与 session.json(--query 必填;可选 --collection-result-input-file / --metadata-input-file)',
      plan: '记录初始搜索(--initial-search JSON --followups JSON --combined-query 文本)',
      branch: '登记一层研究分支(--level N [--id] [--query] [--research-goal] [--learnings JSON] [--citations JSON] [--followups JSON] [--sources JSON] [--context JSON] [--status])',
      aggregate: '去重并裁剪 context',
      report: '标记报告完成并渲染 research-tree.md(--report-path 报告文件路径)',
      // 采集维度
      collect: '登记执行器抓取结果(集合物化;inventory 缺失自动补登;--item-json-file 在 .post-processing-inputs/ 内)',
      inspect: '读取并迁移状态,检测相同 operation + target 的续跑选择',
      run: '追加或更新一次后处理 run(--run-json-file 在 .post-processing-inputs/ 内)',
      cleanup: '按 run 状态执行完整会话或部分工作副本清理(--run-id)',
      'unlock-stale': '仅在锁持有 PID 已不存在时安全回收残留锁',
      'set-retention': '设置是否保留本次会话工作副本(--keep true|false)',
      'rewrite-image-links': '把 sanitized 正文里的本地图片相对链接改写为 fileBrowser 下载 URL',
      'export-views': '由 session.json 生成 sanitized/metadata.json 与 collection-result.json 导出视图',
      // 汇总
      status: '会话综合状态(研究 + 采集)',
      // 平台维度(委派 ingest.mjs)
      'list-kb': '列出知识库(委派 ingest.mjs)',
      'upload-doc': '直传文档(委派 ingest.mjs)',
      'upload-images': '上传正文图片并生成链接映射(委派 ingest.mjs)',
      'upload-resource': '上传资源(委派 ingest.mjs)',
      normalize: '规范化正文(委派 ingest.mjs)',
      store: '导入/存储(委派 ingest.mjs)',
      // 企业维度(委派 enterprise-collection.mjs)
      enterprise: '企业来源采集: wecom-smartpage / feishu-minutes(委派 enterprise-collection.mjs)',
    },
    legacyAliases: {
      'init-session': 'init(需 --query;旧 --collection-result-input-file 仍支持)',
      'mark-materialized': 'collect(单条物化载荷格式兼容)',
      'record-run': 'run',
    },
  };
}

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === 'help') {
    render(help());
    return;
  }

  // ── 研究维度 ──
  if (command === 'init') {
    render(cmdInit(args));
    return;
  }
  if (command === 'plan') {
    render(cmdPlan(args));
    return;
  }
  if (command === 'branch') {
    render(cmdBranch(args));
    return;
  }
  if (command === 'aggregate') {
    render(cmdAggregate(args));
    return;
  }
  if (command === 'report') {
    render(cmdReport(args));
    return;
  }

  // ── 采集维度(需要 --session-dir) ──
  const paths = sessionPaths(args['session-dir']);
  if (command === 'collect' || command === 'mark-materialized') {
    render(cmdCollect(paths, args));
    return;
  }
  if (command === 'inspect') {
    render(cmdInspect(paths, args));
    return;
  }
  if (command === 'run' || command === 'record-run') {
    render(cmdRun(paths, args));
    return;
  }
  if (command === 'cleanup') {
    render(cmdCleanup(paths, args));
    return;
  }
  if (command === 'unlock-stale') {
    render(cmdUnlockStale(paths));
    return;
  }
  if (command === 'set-retention') {
    render(cmdSetRetention(paths, args));
    return;
  }
  if (command === 'rewrite-image-links') {
    render(cmdRewriteImageLinks(paths, args));
    return;
  }
  if (command === 'export-views') {
    render(cmdExportViews(paths));
    return;
  }
  if (command === 'status') {
    render({ ok: true, action: 'status', ...cmdResearchStatus(args), collection: collectionStatus(paths) });
    return;
  }

  // ── 平台维度(委派 ingest.mjs) ──
  if (['list-kb', 'upload-doc', 'upload-images', 'upload-resource', 'normalize', 'store', 'ingest'].includes(command)) {
    delegate('ingest.mjs', process.argv.slice(2));
    return;
  }

  // ── 企业维度(委派 enterprise-collection.mjs) ──
  if (command === 'enterprise') {
    delegate('enterprise-collection.mjs', process.argv.slice(3));
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

try {
  main();
} catch (error) {
  render({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
