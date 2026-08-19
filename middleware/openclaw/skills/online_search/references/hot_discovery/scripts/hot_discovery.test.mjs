#!/usr/bin/env node
/**
 * hot_discovery 测试 —— 零依赖，node:test 内置 runner
 *   node --test hot_discovery.test.mjs
 *
 * 重点是 §6.3 的 6 种 URL 形态：它们是 Step 0 的验收物，也是「双通道命中」判定的前置。
 * 规范化未跑通时测出的重叠率不可解释 —— 分不清是两个通道召回集本就不重叠（该重估设计
 * 价值），还是规范化漏了形态（实现 bug），两者处置完全相反。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  normalizeUrl, parseDeclarations, extractCandidate,
  parseBycliErrorCode, classifyFailure,
} from './hot_discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const decl = parseDeclarations(await readFile(resolve(HERE, '..', 'adapters.md'), 'utf8'));
const n = (u) => normalizeUrl(u, decl);

// ═══════════════ §6.3 那 6 种形态：基础四条规则实测只对齐 1 种 ═══════════════

test('形态 1：末尾斜杠（基础四条已能对齐）', () => {
  assert.equal(n('https://github.com/langchain-ai/langchain'),
               n('https://github.com/langchain-ai/langchain/'));
});

test('形态 2：www. 前缀（基础四条漏过）', () => {
  assert.equal(n('https://github.com/langchain-ai/langchain'),
               n('https://www.github.com/langchain-ai/langchain'));
});

test('形态 3：等价路径变体 /tree/master —— 已知缺口，刻意不对齐', () => {
  assert.notEqual(n('https://github.com/langchain-ai/langchain'),
                  n('https://github.com/langchain-ai/langchain/tree/master'));
  // 不对齐是设计决定：判定两路径是否同一资源需站点语义，且尝试对齐反有误合并风险
  // （/tree/v1 与 /tree/v2 是不同内容）。
});

test('形态 4：非 utm_ 的追踪参数 ?searchId（基础四条漏过）', () => {
  assert.equal(n('https://juejin.cn/post/7311271061818081295'),
               n('https://juejin.cn/post/7311271061818081295?searchId=abc123'));
});

test('形态 5：移动版子域 m.juejin.cn（基础四条漏过）', () => {
  assert.equal(n('https://juejin.cn/post/7311271061818081295'),
               n('https://m.juejin.cn/post/7311271061818081295'));
});

test('形态 6：?rq=1（基础四条漏过）', () => {
  assert.equal(n('https://stackoverflow.com/questions/12345/how-to-x'),
               n('https://stackoverflow.com/questions/12345/how-to-x?rq=1'));
});

// ═══════════════ 规范化的其余规则 ═══════════════

test('http → https', () => {
  assert.equal(n('http://example.com/a'), 'https://example.com/a');
});

test('去 fragment', () => {
  assert.equal(n('https://example.com/a#section-2'), 'https://example.com/a');
});

test('utm_* 被参数白名单覆盖（默认全去）', () => {
  assert.equal(n('https://example.com/a?utm_source=x&utm_medium=y'), 'https://example.com/a');
});

test('白名单内的参数保留：youtube 的 ?v=', () => {
  const u = n('https://www.youtube.com/watch?v=abc123&feature=share&t=90');
  assert.equal(u, 'https://youtube.com/watch?v=abc123');
});

test('参数顺序不影响规范化结果', () => {
  assert.equal(n('https://store.steampowered.com/app?appid=1&x=2'),
               n('https://store.steampowered.com/app?x=2&appid=1'));
});

test('移动子域不用通配：未列入白名单的 m.* 不归一', () => {
  assert.notEqual(n('https://m.unknown-site.com/p/1'), n('https://unknown-site.com/p/1'));
  // 个别站点的 m. 是独立内容，通配会误合并
});

test('根路径保留斜杠', () => {
  assert.equal(n('https://example.com'), 'https://example.com/');
  assert.equal(n('https://example.com/'), 'https://example.com/');
});

test('非 http(s) 协议与垃圾输入返回 null', () => {
  for (const bad of ['ftp://example.com/x', 'javascript:alert(1)', 'not a url', '', null, undefined]) {
    assert.equal(n(bad), null, `应拒绝: ${bad}`);
  }
});

test('剥离 URL 里的凭据与端口', () => {
  assert.equal(n('https://user:pw@example.com:443/a'), 'https://example.com/a');
});

// ═══════════════ 白名单取列：边界约束的实现点 ═══════════════

const npmSpec = decl.adapters.find((a) => a.site === 'npm');

test('白名单只放行声明的列，正文列不透传', () => {
  const s = {};
  const c = extractCandidate({
    rank: 1, name: 'langchain', version: '1.5.9',
    description: '这是一段本应被丢弃的包简介，绝不能出现在候选里',
    weeklyDownloads: 1978109, dependents: 1284, license: 'MIT',
    publisher: 'GitHub Actions', updated: '2026-08-18',
    url: 'https://www.npmjs.com/package/langchain',
  }, npmSpec, s);
  assert.equal(c.title, 'langchain');
  assert.equal(c.metrics.weeklyDownloads, 1978109);
  // description 只能以截断后的 titleContext 出现，原字段名不得存在
  assert.equal('description' in c, false);
  assert.equal('publisher' in c, false);
  assert.equal(c.titleContext, '这是一段本应被丢弃的包简介，绝不能出现在候选里');
});

test('titleContext 硬截断到 100 字符（UTF-16 码元，非字节）', () => {
  const long = '中'.repeat(400);
  const c = extractCandidate({ name: 'x', url: 'https://a/b', description: long,
    weeklyDownloads: 1 }, npmSpec, {});
  assert.equal(c.titleContext.length, 100);
  // 按字节截会把多字节字符切半，这里必须是字符数
  assert.equal(c.titleContext, '中'.repeat(100));
});

test('规则 1：嵌套字段记 shape_unexpected 且不展平（juejin 的 extra）', () => {
  const juejin = decl.adapters.find((a) => a.site === 'juejin');
  const s = {};
  const c = extractCandidate({
    rank: 1, kind: 'article', title: '云音乐 AI Agent 探索实践',
    url: 'https://juejin.cn/post/7311271061818081295',
    views: 4739, likes: 32, comments: 2, hot_index: 270,
    extra: { collect_count: 40, brief: '这段 brief 是正文类字段，展平就会绕过白名单' },
  }, juejin, s);
  assert.equal(s.shape_unexpected, 1);
  assert.deepEqual([...s.shapeUnexpectedFields], ['extra']);
  // 展平会把 extra.brief 提到顶层绕开按字段名的白名单，所以必须拒绝整个字段
  assert.equal(JSON.stringify(c).includes('brief'), false);
  assert.equal(JSON.stringify(c).includes('绕过白名单'), false);
  // 热度无损失：顶层已有四个指标
  assert.equal(c.metrics.hot_index, 270);
});

test('取不到 titleColumn → 丢弃候选并记 title_missing', () => {
  const s = {};
  const c = extractCandidate({ url: 'https://a/b', weeklyDownloads: 5 }, npmSpec, s);
  assert.equal(c, null);
  assert.equal(s.title_missing, 1);
  // 空标题候选会污染分组视图与 collectionFilters 审计链，故不得落盘
});

test('取不到 urlColumn → 丢弃候选并记 url_missing', () => {
  const s = {};
  const c = extractCandidate({ name: 'x', weeklyDownloads: 5 }, npmSpec, s);
  assert.equal(c, null);
  assert.equal(s.url_missing, 1);
});

test('weread-official 的 URL 列是 link 而非 url', () => {
  const wr = decl.adapters.find((a) => a.site === 'weread-official');
  assert.equal(wr.urlColumn, 'link');
  const c = extractCandidate({ title: '书名', link: 'https://weread.qq.com/x',
    rating: 8.5, readingCount: 1000, intro: '简介' }, wr, {});
  assert.equal(c.url, 'https://weread.qq.com/x');
});

test('weread-official 的限量参数是 --count 而非 --limit', () => {
  const wr = decl.adapters.find((a) => a.site === 'weread-official');
  assert.equal(wr.limitFlag, '--count');
});

test('除 weread-official 外没有适配器声明 limitFlag（默认 --limit）', () => {
  const overrides = decl.adapters.filter((a) => a.limitFlag).map((a) => a.site);
  assert.deepEqual(overrides, ['weread-official']);
});

test('热度列全缺失 → 候选保留但记 metric_missing（降级不丢弃）', () => {
  const s = {};
  const c = extractCandidate({ name: 'x', url: 'https://a/b' }, npmSpec, s);
  assert.ok(c);
  assert.equal(s.metric_missing, 1);
  assert.deepEqual(c.metrics, {});
});

test('metricColumns 声明为空数组是预期无热度，不记 metric_missing（cnki）', () => {
  const cnki = decl.adapters.find((a) => a.site === 'cnki');
  const s = {};
  const c = extractCandidate({ title: '论文', url: 'https://cnki/x' }, cnki, s);
  assert.ok(c);
  assert.equal(s.metric_missing, undefined);
});

test('无标题列的适配器从正文列截 60 字符，且不再另给 titleContext', () => {
  const tw = decl.adapters.find((a) => a.site === 'twitter');
  const c = extractCandidate({ id: '1', author: 'a', text: '推'.repeat(200),
    likes: 10, views: 100, url: 'https://x.com/a/status/1',
    media_urls: ['https://pbs.x/1.jpg'], card: { title: 'c' } }, tw, {});
  assert.equal(c.title.length, 60);
  // 同一条短贴不泄漏两份文本
  assert.equal(c.titleContext, undefined);
  // media_urls / card 是 URL 类字段，放行会诱使下游把发现结果当可直接取内容的资源清单
  assert.equal(JSON.stringify(c).includes('pbs.x'), false);
});

test('非数值的热度值被丢弃（不把 "1.2k" 当数字）', () => {
  const c = extractCandidate({ name: 'x', url: 'https://a/b', weeklyDownloads: '1.2k' },
    npmSpec, {});
  assert.deepEqual(c.metrics, {});
});

// ═══════════════ 错误分派：exit 75 同码两义 ═══════════════

test('从 stderr 的 YAML 解析 error.code（实测形状，非 stdout JSON）', () => {
  const stderr = 'ok: false\nerror:\n  code: AUTH_REQUIRED\n  message: ...\n  exitCode: 77\n';
  assert.equal(parseBycliErrorCode(stderr), 'AUTH_REQUIRED');
  assert.equal(parseBycliErrorCode('no code here'), null);
});

test('exit 75 必须靠 error.code 区分限流与登录等待', () => {
  assert.equal(classifyFailure(75, 'RATE_LIMITED'), 'rate_limited');
  assert.equal(classifyFailure(75, 'TIMEOUT'), 'login_timeout');
  // 无 error.code 时不猜 —— 只看码会把限流误判为等待登录而进错误分支
  assert.equal(classifyFailure(75, null), 'exit75_ambiguous');
});

test('其余退出码分派', () => {
  assert.equal(classifyFailure(77, 'AUTH_REQUIRED'), 'auth_required');
  assert.equal(classifyFailure(69, 'BROWSER_CONNECT'), 'bridge_unavailable');
  assert.equal(classifyFailure(66, 'EMPTY_RESULT'), 'empty_result');
  assert.equal(classifyFailure(1, 'COMMAND_EXEC'), 'command_failed');
  assert.equal(classifyFailure(2, null), 'command_failed');
});

// ═══════════════ 声明表自身的完整性 ═══════════════

test('声明表 33 个适配器，分档 14/5/14', () => {
  const byTier = (t) => decl.adapters.filter((a) => a.tier === t).length;
  assert.equal(decl.adapters.length, 33);
  assert.equal(byTier(1), 14);
  assert.equal(byTier(2), 5);
  assert.equal(byTier(3), 14);
});

test('每个适配器都有可用的 URL 列与标题来源', () => {
  for (const a of decl.adapters) {
    assert.ok(a.urlColumn, `${a.site} 缺 urlColumn`);
    assert.ok(a.titleColumn || (a.titleFrom || []).length, `${a.site} 无标题来源`);
  }
});

test('github 的 watchers 不在 metricColumns 里（实测恒 null）', () => {
  const gh = decl.adapters.find((a) => a.site === 'github');
  assert.equal(gh.metricColumns.includes('watchers'), false);
  assert.deepEqual(gh.metricColumns, ['stars', 'forks']);
});

test('未识别的 quirk 会让声明解析直接失败', () => {
  const bad = '```ADAPTER-DECLARATIONS\n' + JSON.stringify({
    tier1: { x: { cmd: 'search', urlColumn: 'url', titleColumn: 'title', quirks: ['nope'] } },
  }) + '\n```';
  assert.throws(() => parseDeclarations(bad), /未识别的 quirk/);
});

test('titleColumn 与 titleFrom 都缺会让声明解析失败', () => {
  const bad = '```ADAPTER-DECLARATIONS\n' + JSON.stringify({
    tier1: { x: { cmd: 'search', urlColumn: 'url' } },
  }) + '\n```';
  assert.throws(() => parseDeclarations(bad), /候选会 100% 丢弃/);
});
