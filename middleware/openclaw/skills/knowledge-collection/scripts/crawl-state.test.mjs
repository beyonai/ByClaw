#!/usr/bin/env node
/** crawl-state.mjs 单元测试。运行: node crawl-state.test.mjs */
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalizeUrl, extractUrls } from './crawl-state.mjs';

const CLI = path.join(import.meta.dirname, 'knowledge-collection.mjs');
let passed = 0;

function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (error) { console.error(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
}

function run(args, { expectFail = false } = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args, '--compact'], { encoding: 'utf8' });
    if (expectFail) throw new Error('预期失败但成功了');
    return JSON.parse(out);
  } catch (error) {
    if (!expectFail) throw error;
    const stdout = error.stdout || '';
    return JSON.parse(stdout);
  }
}

function makeSession(name) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kc-crawl-')), name);
  run(['init', '--session-dir', dir, '--query', 'test crawl']);
  return dir;
}

console.log('canonicalizeUrl');
test('去 fragment 与 index.html,统一为同一 URL', () => {
  assert.equal(canonicalizeUrl('https://e.com/a/index.html#x'), 'https://e.com/a/');
});
test('query 排序后等价', () => {
  assert.equal(canonicalizeUrl('https://e.com/?b=2&a=1'), canonicalizeUrl('https://e.com/?a=1&b=2'));
});
test('拒绝非 http/https', () => {
  assert.throws(() => canonicalizeUrl('file:///etc/passwd'), /只支持 http 或 https/);
});
test('拒绝带凭据的 URL', () => {
  assert.throws(() => canonicalizeUrl('https://u:p@e.com/'), /不得包含凭据/);
});

console.log('extractUrls');
test('优先解析 sitemap <loc>', () => {
  const urls = extractUrls('<url><loc>https://e.com/a</loc></url><url><loc>https://e.com/b</loc></url>');
  assert.deepEqual(urls, ['https://e.com/a', 'https://e.com/b']);
});
test('无 <loc> 时回退裸 URL,并剥掉 Markdown 尾括号', () => {
  assert.deepEqual(extractUrls('see [x](https://e.com/a) and https://e.com/b.'), ['https://e.com/a', 'https://e.com/b.']);
});

console.log('crawl-seed');
test('scope-prefix 拦截跨域 URL', () => {
  const dir = makeSession('s1');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\nhttps://evil.com/b\n');
  const out = run(['crawl-seed', '--session-dir', dir, '--urls-file', file, '--scope-prefix', 'https://ok.com/']);
  assert.equal(out.added, 1);
  assert.equal(out.skipped.outOfScope, 1);
});
test('max-pages 超出部分记为 overCap 而非静默丢弃', () => {
  const dir = makeSession('s2');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, ['a', 'b', 'c'].map((x) => `https://ok.com/${x}`).join('\n'));
  const out = run(['crawl-seed', '--session-dir', dir, '--urls-file', file, '--max-pages', '2']);
  assert.equal(out.added, 2);
  assert.equal(out.skipped.overCap, 1);
});
test('max-pages 偏斜警告(再现 Dify sitemap api-reference 批量入队)', () => {
  // 24 页全部来自 api-reference/annotations,其余 72 页被 overCap 放弃 → 触发警告
  const dir = makeSession('s2b');
  const file = path.join(dir, 'u.txt');
  const urls = [];
  for (let i = 0; i < 24; i++) urls.push(`https://docs.example.com/api-reference/annotations/ep-${i}`);
  for (let i = 0; i < 72; i++) urls.push(`https://docs.example.com/guide/intro-${i}`);
  fs.writeFileSync(file, urls.join('\n'));
  const out = run(['crawl-seed', '--session-dir', dir, '--urls-file', file, '--max-pages', '24']);
  assert.equal(out.added, 24);
  assert.equal(out.skipped.overCap, 72);
  assert.ok(out.warnings && out.warnings.length, '应产生偏斜警告');
  assert.ok(out.warnings[0].includes('api-reference/annotations'), '警告应指明集中的路径前缀');
});
test('重复 seed 不重置已有状态', () => {
  const dir = makeSession('s3');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const markFile = path.join(dir, '.post-processing-inputs', 'm.json');
  fs.writeFileSync(markFile, JSON.stringify({ results: [{ url: 'https://ok.com/a', status: 'fetched' }] }));
  run(['crawl-mark', '--session-dir', dir, '--mark-json-file', markFile]);
  const out = run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  assert.equal(out.added, 0);
  assert.equal(out.skipped.duplicate, 1);
  assert.equal(out.frontier.fetched, 1, 'fetched 状态不能被 re-seed 重置');
});
test('空文件拒绝', () => {
  const dir = makeSession('s4');
  const file = path.join(dir, 'e.txt');
  fs.writeFileSync(file, 'no urls here');
  const out = run(['crawl-seed', '--session-dir', dir, '--urls-file', file], { expectFail: true });
  assert.match(out.error, /没有解析到任何 http\/https URL/);
});

console.log('crawl-next / crawl-mark');
test('crawl-next 只返回 pending,已 fetched 不再出队', () => {
  const dir = makeSession('n1');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\nhttps://ok.com/b\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const markFile = path.join(dir, '.post-processing-inputs', 'm.json');
  fs.writeFileSync(markFile, JSON.stringify({ results: [{ url: 'https://ok.com/a', status: 'fetched' }] }));
  run(['crawl-mark', '--session-dir', dir, '--mark-json-file', markFile]);
  const out = run(['crawl-next', '--session-dir', dir]);
  assert.deepEqual(out.urls, ['https://ok.com/b']);
});
test('status=failed 必须带 reason', () => {
  const dir = makeSession('n2');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const markFile = path.join(dir, '.post-processing-inputs', 'm.json');
  fs.writeFileSync(markFile, JSON.stringify({ results: [{ url: 'https://ok.com/a', status: 'failed' }] }));
  const out = run(['crawl-mark', '--session-dir', dir, '--mark-json-file', markFile], { expectFail: true });
  assert.match(out.error, /必须给出 reason/);
});
test('未入队 URL 拒绝登记', () => {
  const dir = makeSession('n3');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const markFile = path.join(dir, '.post-processing-inputs', 'm.json');
  fs.writeFileSync(markFile, JSON.stringify({ results: [{ url: 'https://other.com/x', status: 'fetched' }] }));
  const out = run(['crawl-mark', '--session-dir', dir, '--mark-json-file', markFile], { expectFail: true });
  assert.match(out.error, /不在 frontier 中/);
});
test('payload 必须位于 .post-processing-inputs/ 内', () => {
  const dir = makeSession('n4');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const outside = path.join(dir, 'm.json');
  fs.writeFileSync(outside, JSON.stringify({ results: [{ url: 'https://ok.com/a', status: 'fetched' }] }));
  const out = run(['crawl-mark', '--session-dir', dir, '--mark-json-file', outside], { expectFail: true });
  assert.match(out.error, /必须位于 \.post-processing-inputs\//);
});
test('成功登记后删除 payload', () => {
  const dir = makeSession('n5');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const markFile = path.join(dir, '.post-processing-inputs', 'm.json');
  fs.writeFileSync(markFile, JSON.stringify({ results: [{ url: 'https://ok.com/a', status: 'fetched' }] }));
  run(['crawl-mark', '--session-dir', dir, '--mark-json-file', markFile]);
  assert.equal(fs.existsSync(markFile), false);
});
test('crawl 子树不破坏 task/research/collection', () => {
  const dir = makeSession('n6');
  const file = path.join(dir, 'u.txt');
  fs.writeFileSync(file, 'https://ok.com/a\n');
  run(['crawl-seed', '--session-dir', dir, '--urls-file', file]);
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(session.schemaVersion, '2.0');
  for (const key of ['task', 'research', 'collection', 'crawl']) {
    assert.ok(session[key], `缺少 ${key}`);
  }
  assert.equal(session.task.query, 'test crawl');
});

console.log(`\n${passed} passed`);
