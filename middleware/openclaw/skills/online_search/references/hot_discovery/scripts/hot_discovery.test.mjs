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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  normalizeUrl, parseDeclarations, extractCandidate,
  parseBycliErrorCode, classifyFailure, parseBoundedInteger, parseTiers, mergeDocuments,
  readJsonIfGiven, selectAdaptersForDimensions, bridgeFailureStats, allSelectedAdaptersEmpty,
  searchHotDiscovery,
} from './hot_discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const decl = parseDeclarations(await readFile(resolve(HERE, '..', 'adapters.md'), 'utf8'));
const n = (u, options) => normalizeUrl(u, decl, options);
const identityN = (u) => normalizeUrl(u, decl);

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

test('utm_* 追踪参数默认删除', () => {
  assert.equal(n('https://example.com/a?utm_source=x&utm_medium=y'), 'https://example.com/a');
});

test('未知站点的业务查询参数默认保留，避免误合并不同资源', () => {
  assert.notEqual(n('https://example.com/view?id=1'), n('https://example.com/view?id=2'));
  assert.equal(n('https://example.com/view?id=1&utm_source=x'), 'https://example.com/view?id=1');
});

test('对象存储签名与常见凭据查询参数必须删除', () => {
  const url = n('https://cdn.example.com/a?id=1&X-Amz-Credential=AKIA&X-Amz-Signature=TOPSECRET&X-Amz-Security-Token=SESSIONSECRET&jwt=abc&sig=def&key=ghi');
  assert.equal(url, 'https://cdn.example.com/a?id=1');
});

test('去重身份保留未知业务参数，公开 URL 单独脱敏 OAuth code', () => {
  assert.equal(n('https://example.com/callback?code=OAUTHSECRET&state=abc'),
    'https://example.com/callback');
  assert.notEqual(identityN('https://example.com/view?policy=privacy'),
    identityN('https://example.com/view?policy=terms'));

  const result = mergeDocuments({
    hotDoc: { query: 'q', candidates: [{
      url: 'https://example.com/view?policy=privacy', title: 'Privacy',
      discoveredBy: ['bycli:npm'], popularity: null,
    }] },
    sxDoc: { query: 'q', results: [{
      url: 'https://example.com/view?policy=terms', title: 'Terms', engine: 'google',
    }] },
    arDoc: null, normalizer: n, identityNormalizer: identityN,
  });
  assert.equal(result.totals.afterDedup, 2);
  assert.equal(result.totals.bothChannels, 0);
});

test('公开脱敏 URL 相同不得让不同内部身份共享 both 分组状态', () => {
  const hotCandidate = (policy) => ({
    url: `https://example.com/view?policy=${policy}`, title: policy,
    discoveredBy: ['bycli:npm'], popularity: {
      source: 'npm', metric: 'downloads', value: 1, allMetrics: { downloads: 1 },
      rankInSource: 1, sortedLocally: true, searchWindowSize: 2,
    },
  });
  const result = mergeDocuments({
    hotDoc: { query: 'q', candidates: [hotCandidate('privacy'), hotCandidate('terms')] },
    sxDoc: { query: 'q', results: [{
      url: 'https://example.com/view?policy=privacy', title: 'Privacy', engine: 'google',
    }] },
    arDoc: null, normalizer: n, identityNormalizer: identityN,
  });
  assert.equal(result.groups.bothChannels.length, 1);
  assert.equal(result.groups.hotBySource.npm.length, 1);
  assert.equal(result.groups.hotBySource.npm[0].title, 'terms');
  assert.notEqual(result.groups.bothChannels[0].url, result.groups.hotBySource.npm[0].url);
});

test('同一对象的轮换签名 URL 应按资源身份合并且不公开签名', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'q', candidates: [{
      url: 'https://cdn.example.com/object?id=1&X-Amz-Date=20260822T000000Z&X-Amz-Expires=60&X-Amz-Signature=A', title: 'Object',
      discoveredBy: ['bycli:npm'], popularity: {
        source: 'npm', metric: 'downloads', value: 1, allMetrics: { downloads: 1 },
        rankInSource: 1, sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: { query: 'q', results: [{
      url: 'https://cdn.example.com/object?id=1&X-Amz-Date=20260822T010000Z&X-Amz-Expires=120&X-Amz-Signature=B', engine: 'google',
    }] },
    arDoc: null, normalizer: n, identityNormalizer: identityN,
  });
  assert.equal(result.totals.afterDedup, 1);
  assert.equal(result.totals.bothChannels, 1);
  assert.equal(result.groups.bothChannels[0].url, 'https://cdn.example.com/object?id=1');
});

test('任意回调路径且没有 state 的 OAuth code 也不得公开', () => {
  assert.equal(n('https://app.example.com/login?code=OAUTH_SECRET&iss=https%3A%2F%2Fissuer.example'),
    'https://app.example.com/login?iss=https%3A%2F%2Fissuer.example');
});

test('普通业务 code 参数必须保留并参与资源身份', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'q', candidates: [{
      url: 'https://example.com/product?id=1&code=US', title: 'US',
      discoveredBy: ['bycli:npm'], popularity: null,
    }] },
    sxDoc: { query: 'q', results: [{
      url: 'https://example.com/product?id=1&code=CN', engine: 'google',
    }] },
    arDoc: null, normalizer: n, identityNormalizer: identityN,
  });
  assert.equal(result.totals.afterDedup, 2);
  assert.equal(result.totals.bothChannels, 0);
});

test('Azure 用户委派 SAS 轮换字段全部从资源身份和公开 URL 删除', () => {
  const base = 'https://account.blob.core.windows.net/container/blob?sv=2025-01-05&sp=r&sr=b';
  assert.equal(n(`${base}&skoid=OID&sktid=TID&skt=2026-01-01&ske=2026-01-02&sks=b&skv=2025&sig=SECRET`),
    'https://account.blob.core.windows.net/container/blob');
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

test('剥离 URL 凭据与默认端口，但保留非默认端口', () => {
  assert.equal(n('https://user:pw@example.com:443/a'), 'https://example.com/a');
  assert.equal(n('https://user:pw@example.com:8443/a'), 'https://example.com:8443/a');
  assert.equal(n('http://user:pw@example.com:8080/a'), 'http://example.com:8080/a');
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

test('malformed bycli 行被跳过并记 row_shape_unexpected', () => {
  for (const row of [null, undefined, 'bad', 42, []]) {
    const stats = {};
    assert.equal(extractCandidate(row, npmSpec, stats), null);
    assert.equal(stats.row_shape_unexpected, 1);
  }
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

test('OS 级超时优先分类为 timeout', () => {
  assert.equal(classifyFailure(1, null, true), 'timeout');
  assert.equal(classifyFailure(75, 'RATE_LIMITED', true), 'timeout');
});

test('doctor 超时保留 timeout、killed 与原始错误码', () => {
  assert.deepEqual(bridgeFailureStats(2, {
    code: 1, timedOut: true, killed: true, rawErrorCode: 'ETIMEDOUT',
  }), {
    tier: 2, status: 'timeout', exitCode: 1, killed: true, rawErrorCode: 'ETIMEDOUT',
  });
  assert.deepEqual(bridgeFailureStats(3, { code: 1, timedOut: false }), {
    tier: 3, status: 'bridge_unavailable', exitCode: 1,
  });
});

test('认证失败保留已完成结果、停止后续浏览器适配器并给出用户动作', async () => {
  const declarations = {
    adapters: [
      {
        site: 'credential-gateway', cmd: 'search', tier: 3, dimensions: ['books'],
        urlColumn: 'url', titleColumn: 'title', metricColumns: ['rating'], quirks: [],
      },
      {
        site: 'browser-site', cmd: 'search', tier: 3, dimensions: ['books'],
        urlColumn: 'url', titleColumn: 'title', metricColumns: ['score'], quirks: [],
      },
    ],
  };
  const calls = [];
  const bycli = {
    loadRuntime: async () => ({
      compatibility: { status: 'compatible', currentVersion: '2.1.38', baselineVersion: '2.1.38' },
      catalog: new Map([
        ['credential-gateway/search', {
          strategy: 'public', browser: false, columns: ['url', 'title', 'rating'],
          args: [{ name: 'limit', positional: false }],
        }],
        ['browser-site/search', {
          strategy: 'cookie', browser: true, columns: ['url', 'title', 'score'],
          args: [{ name: 'limit', positional: false }],
        }],
      ]),
    }),
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      return {
        code: 77, stdout: '',
        stderr: 'ok: false\nerror:\n  code: AUTH_REQUIRED\n',
        timedOut: false, killed: false, rawErrorCode: null,
      };
    },
    ensureBridge: async () => assert.fail('认证失败后不应启动浏览器桥接'),
  };

  const result = await searchHotDiscovery(
    { query: 'agent', dimensions: 'books', tiers: '3', limit: '1' },
    { declarations, bycli },
  );

  assert.equal(calls.length, 1);
  assert.equal(result.requiresUserAction.kind, 'auth_required');
  assert.equal(result.requiresUserAction.source, 'credential-gateway');
  assert.equal(result.adapterStats['browser-site'].status, 'skipped_user_action');
});

test('桥接在预检后断开时停止后续浏览器适配器', async () => {
  const declarations = {
    adapters: [
      {
        site: 'first-browser-site', cmd: 'search', tier: 2, dimensions: ['books'],
        urlColumn: 'url', titleColumn: 'title', metricColumns: ['score'], quirks: [],
      },
      {
        site: 'later-browser-site', cmd: 'search', tier: 2, dimensions: ['books'],
        urlColumn: 'url', titleColumn: 'title', metricColumns: ['score'], quirks: [],
      },
    ],
  };
  const calls = [];
  const bycli = {
    loadRuntime: async () => ({
      compatibility: { status: 'compatible', currentVersion: '2.1.38', baselineVersion: '2.1.38' },
      catalog: new Map(['first-browser-site', 'later-browser-site'].map((site) => [`${site}/search`, {
        strategy: 'public', browser: true, columns: ['url', 'title', 'score'],
        args: [{ name: 'limit', positional: false }],
      }])),
    }),
    ensureBridge: async () => ({ ok: true, attempts: 1 }),
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      return {
        code: 69, stdout: '',
        stderr: 'ok: false\nerror:\n  code: BROWSER_CONNECT\n',
        timedOut: false, killed: false, rawErrorCode: null,
      };
    },
  };

  const result = await searchHotDiscovery(
    { query: 'agent', dimensions: 'books', tiers: '2', limit: '1' },
    { declarations, bycli },
  );

  assert.equal(calls.length, 1);
  assert.equal(result.requiresUserAction.kind, 'bridge_unavailable');
  assert.equal(result.adapterStats['later-browser-site'].status, 'skipped_user_action');
});

// ═══════════════ CLI 数值参数边界 ═══════════════

test('parseBoundedInteger 接受缺省值和范围内整数', () => {
  assert.equal(parseBoundedInteger(undefined, 'limit', 20, 1, 100), 20);
  assert.equal(parseBoundedInteger('1', 'limit', 20, 1, 100), 1);
  assert.equal(parseBoundedInteger('100', 'limit', 20, 1, 100), 100);
});

test('parseBoundedInteger 拒绝非法值', () => {
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '101', true]) {
    assert.throws(
      () => parseBoundedInteger(value, 'limit', 20, 1, 100),
      /limit 必须是 1–100 的整数/,
    );
  }
});

test('parseTiers 接受缺省值和合法档位', () => {
  assert.deepEqual([...parseTiers(undefined)], [1, 2, 3]);
  assert.deepEqual([...parseTiers('1, 3')], [1, 3]);
});

test('parseTiers 拒绝空项、重复、越界、小数和非字符串', () => {
  for (const value of ['1,', '1,1', '0', '4', '1.5', 'x', '', true]) {
    assert.throws(() => parseTiers(value), /tiers 必须是 1、2、3 的不重复逗号分隔列表/);
  }
});

// ═══════════════ merge 快照边界与闭环 ═══════════════

test('merge 丢弃 hot-file 未知字段并保留跨通道命中', () => {
  const hotDoc = {
    query: 'agent',
    observedAt: '2026-08-22T00:00:00.000Z',
    candidates: [{
      url: 'http://www.example.com/a/?utm_source=x',
      title: 'A',
      titleContext: '中'.repeat(120),
      content: '不得透传的正文',
      citations: [{ quote: '不得透传' }],
      discoveredBy: ['bycli:npm'],
      relevance: null,
      popularity: {
        source: 'npm',
        metric: 'downloads',
        value: 10,
        allMetrics: { downloads: 10, injected: { body: 'x' } },
        rankInSource: 1,
        sortedLocally: true,
        searchWindowSize: 20,
        injected: 'drop',
      },
      acquisitionRoute: 'forged',
    }],
  };
  const sxDoc = { query: 'agent', results: [{
    url: 'https://example.com/a', title: 'A', engine: 'google', score: 2,
  }] };

  const result = mergeDocuments({
    hotDoc, sxDoc, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  const candidate = result.groups.bothChannels[0];
  assert.equal(result.totals.bothChannels, 1);
  assert.equal(candidate.titleContext.length, 100);
  assert.equal(candidate.acquisitionRoute, null);
  assert.equal('content' in candidate, false);
  assert.equal('citations' in candidate, false);
  assert.equal('injected' in candidate.popularity, false);
  assert.deepEqual(candidate.popularity.allMetrics, { downloads: 10 });
});

test('merge 丢弃 malformed hot candidate 并告警', () => {
  const result = mergeDocuments({
    hotDoc: { candidates: [null, { url: 'not-a-url', title: 'x' }] },
    sxDoc: null,
    arDoc: null,
    normalizer: n,
    groupLimit: 5,
    searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 0);
  assert.match(result.warnings.join('\n'), /hot-file.*2 条/);
});

test('hot-file 不能伪造 searxng 来源制造双通道命中', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'agent', candidates: [{
      url: 'https://example.com/a',
      title: 'A',
      discoveredBy: ['bycli:npm', 'searxng:google'],
      relevance: null,
      popularity: {
        source: 'npm', metric: 'downloads', value: 10,
        allMetrics: { downloads: 10 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 20,
      },
      acquisitionRoute: null,
    }] },
    sxDoc: null,
    arDoc: null,
    normalizer: n,
    groupLimit: 5,
    searxngLimit: 20,
  });
  assert.equal(result.totals.bothChannels, 0);
  assert.deepEqual(result.groups.hotBySource.npm[0].discoveredBy, ['bycli:npm']);
});

test('特殊 popularity.source 不得击穿按来源分组', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'agent', candidates: [{
      url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:__proto__'],
      popularity: {
        source: '__proto__', metric: 'downloads', value: 1,
        allMetrics: { downloads: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.groups.hotBySource.__proto__[0].title, 'A');
});

test('malformed 辅助通道文档被隔离并告警', () => {
  const result = mergeDocuments({
    hotDoc: null,
    sxDoc: { results: {} },
    arDoc: { results: {} },
    normalizer: n,
    groupLimit: 5,
    searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 0);
  assert.match(result.warnings.join('\n'), /searxng-file 结构无效/);
  assert.match(result.warnings.join('\n'), /agent-reach-file 结构无效/);
});

test('hot-file 不能注入 relevance 进入 searxngTop', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'agent', candidates: [{
      url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
      relevance: { searxngScore: 99, searxngRank: 1 },
      popularity: {
        source: 'npm', metric: 'downloads', value: 1,
        allMetrics: { downloads: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.groups.searxngTop.length, 0);
  assert.equal(result.groups.hotBySource.npm[0].relevance, null);
});

test('hot-file popularity.source 必须匹配 bycli 来源', () => {
  const result = mergeDocuments({
    hotDoc: { candidates: [{
      url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
      popularity: {
        source: 'github', metric: 'stars', value: 1,
        allMetrics: { stars: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 0);
  assert.match(result.warnings.join('\n'), /hot-file.*1 条/);
});

test('hot-file candidates 非数组时必须告警', () => {
  const result = mergeDocuments({
    hotDoc: { candidates: {} }, sxDoc: null, arDoc: null,
    normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 0);
  assert.match(result.warnings.join('\n'), /hot-file 结构无效/);
});

test('查询不一致时隔离 searxng 通道，禁止双通道命中', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'AI  Agent', candidates: [{
      url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
      popularity: {
        source: 'npm', metric: 'downloads', value: 1,
        allMetrics: { downloads: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: { query: 'different query', results: [{
      url: 'https://example.com/a', title: 'A', engine: 'google', score: 1,
    }] },
    arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.bothChannels, 0);
  assert.equal(result.totals.incoming, 1);
  assert.match(result.warnings.join('\n'), /查询不一致.*searxng/);
});

test('文件缺失或 JSON 损坏时返回 warning 而不是抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hot-discovery-test-'));
  try {
    const missing = await readJsonIfGiven(join(dir, 'missing.json'), 'hot-file');
    assert.equal(missing.doc, null);
    assert.match(missing.warning, /hot-file 读取或解析失败/);

    const invalidPath = join(dir, 'invalid.json');
    await writeFile(invalidPath, '{invalid', 'utf8');
    const invalid = await readJsonIfGiven(invalidPath, 'searxng-file');
    assert.equal(invalid.doc, null);
    assert.match(invalid.warning, /searxng-file 读取或解析失败/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge 对 hot-file 顶层元数据执行白名单', () => {
  const result = mergeDocuments({
    hotDoc: {
      observedAt: { content: 'BODY' },
      query: { content: 'BODY' },
      candidates: [],
      adapterStats: {
        npm: { tier: 1, transport: 'direct', status: 'ok', rows: 2, candidates: 1, content: 'BODY', nested: { body: 'x' } },
      },
      warnings: ['valid warning', { content: 'BODY' }, 'x'.repeat(1500)],
    },
    sxDoc: { query: 'fallback query', results: [] },
    arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.query, 'fallback query');
  assert.equal(typeof result.observedAt, 'string');
  assert.deepEqual(result.adapterStats, {
    npm: { tier: 1, transport: 'direct', status: 'ok', rows: 2, candidates: 1 },
  });
  assert.equal(result.warnings[0], 'valid warning');
  assert.equal(result.warnings[1].length, 1000);
  assert.equal(JSON.stringify(result).includes('BODY'), false);
});

test('hot-file 排名字段必须是有效正整数且不超过窗口', () => {
  const invalidRanks = [
    { rankInSource: -1, searchWindowSize: 10 },
    { rankInSource: 1.5, searchWindowSize: 10 },
    { rankInSource: 1, searchWindowSize: 0 },
    { rankInSource: 2, searchWindowSize: 1 },
  ];
  for (const ranking of invalidRanks) {
    const result = mergeDocuments({
      hotDoc: { candidates: [{
        url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
        popularity: {
          source: 'npm', metric: 'downloads', value: 1,
          allMetrics: { downloads: 1 }, sortedLocally: true, ...ranking,
        },
      }] },
      sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
    });
    assert.equal(result.totals.incoming, 0);
    assert.match(result.warnings.join('\n'), /hot-file.*1 条/);
  }
});

test('merge 输出不得通过 originalUrls 泄漏 URL 凭据或敏感参数', () => {
  const result = mergeDocuments({
    hotDoc: { candidates: [{
      url: 'https://user:secret@example.com/a?token=TOPSECRET',
      title: 'A', discoveredBy: ['bycli:npm'],
      popularity: {
        source: 'npm', metric: 'downloads', value: 1,
        allMetrics: { downloads: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('TOPSECRET'), false);
  assert.equal(serialized.includes('originalUrls'), false);
});

test('缺少 query 的通道可保留候选但不得参与双通道命中', () => {
  const result = mergeDocuments({
    hotDoc: { candidates: [{
      url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
      popularity: {
        source: 'npm', metric: 'downloads', value: 1,
        allMetrics: { downloads: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: { query: 'agent', results: [{
      url: 'https://example.com/a', title: 'A', engine: 'google', score: 1,
    }] },
    arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 2);
  assert.equal(result.totals.bothChannels, 0);
  assert.match(result.warnings.join('\n'), /hot-file 缺少 query/);
  assert.deepEqual(result.groups.searxngTop[0].discoveredBy, ['searxng:google']);
  assert.deepEqual(result.groups.searxngTop[0].unverifiedDiscoveredBy, ['bycli:npm']);
  assert.equal(result.groups.hotBySource.npm, undefined);
  assert.equal(JSON.stringify(result).includes('_verifiedDiscoveredBy'), false);
});

test('agent-reach 单通道候选和全未验证候选都有独立输出组', () => {
  const agentOnly = mergeDocuments({
    hotDoc: null, sxDoc: null,
    arDoc: { query: 'agent', results: [{ url: 'https://example.com/a', source: 'web' }] },
    normalizer: n, groupLimit: 5, searxngLimit: 20, agentReachLimit: 20, unverifiedLimit: 20,
  });
  assert.equal(agentOnly.groups.agentReachTop.length, 1);
  assert.deepEqual(agentOnly.groups.agentReachTop[0].discoveredBy, ['agent-reach:web']);

  const unverified = mergeDocuments({
    hotDoc: null, sxDoc: null,
    arDoc: { results: [{ url: 'https://example.com/b', source: 'web' }] },
    normalizer: n, groupLimit: 5, searxngLimit: 20, agentReachLimit: 20, unverifiedLimit: 20,
  });
  assert.equal(unverified.groups.unverified.length, 1);
  assert.deepEqual(unverified.groups.unverified[0].unverifiedDiscoveredBy, ['agent-reach:web']);
});

test('无 popularity 的合法 hot 候选进入独立降级分组', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'q', candidates: [{
      url: 'https://cnki.example/paper/1', title: 'Paper',
      discoveredBy: ['bycli:cnki'], popularity: null,
    }] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
    unrankedHotLimit: 20,
  });
  assert.equal(result.groups.hotWithoutPopularity.length, 1);
  assert.equal(result.groups.hotWithoutPopularity[0].title, 'Paper');
});

test('searxng + agent-reach 没有热度时不得进入 bothChannels 或重复分组', () => {
  const result = mergeDocuments({
    hotDoc: null,
    sxDoc: { query: 'q', results: [{ url: 'https://example.com/a', engine: 'google' }] },
    arDoc: { query: 'q', results: [{ url: 'https://example.com/a', source: 'web' }] },
    normalizer: n, groupLimit: 5, searxngLimit: 20, agentReachLimit: 20,
  });
  assert.equal(result.groups.bothChannels.length, 0);
  assert.equal(result.groups.searxngTop.length, 1);
  assert.equal(result.groups.agentReachTop.length, 0);
});

test('空 engine 的 searxng 候选使用可分组的稳定回退来源', () => {
  const result = mergeDocuments({
    hotDoc: null,
    sxDoc: { query: 'q', results: [{ url: 'https://example.com/a', title: 'A', engine: '' }] },
    arDoc: null, normalizer: n,
  });
  assert.equal(result.groups.searxngTop.length, 1);
  assert.deepEqual(result.groups.searxngTop[0].discoveredBy, ['searxng:searxng']);
});

test('agent-reach 查询不一致时隔离该通道', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'agent', candidates: [{
      url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
      popularity: {
        source: 'npm', metric: 'downloads', value: 1,
        allMetrics: { downloads: 1 }, rankInSource: 1,
        sortedLocally: true, searchWindowSize: 1,
      },
    }] },
    sxDoc: null,
    arDoc: { query: 'different', results: [{ url: 'https://example.com/a', title: 'A' }] },
    normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 1);
  assert.equal(result.totals.bothChannels, 0);
  assert.match(result.warnings.join('\n'), /查询不一致.*agent-reach/);
});

test('同一 URL 的多个 hot 来源都保留且主热度确定', () => {
  const makeCandidate = (source, metric, value) => ({
    url: 'https://example.com/a', title: 'A', discoveredBy: [`bycli:${source}`],
    popularity: {
      source, metric, value, allMetrics: { [metric]: value },
      rankInSource: 1, sortedLocally: true, searchWindowSize: 10,
    },
  });
  const result = mergeDocuments({
    hotDoc: { query: 'agent', candidates: [
      makeCandidate('npm', 'downloads', 10),
      makeCandidate('github', 'stars', 20),
    ] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.afterDedup, 1);
  assert.equal(result.groups.hotBySource.npm.length, 1);
  assert.equal(result.groups.hotBySource.github.length, 1);
  assert.equal(result.groups.hotBySource.npm[0].popularity.source, 'npm');
  assert.equal(result.groups.hotBySource.github[0].popularity.source, 'github');
  assert.deepEqual(result.groups.hotBySource.github[0].popularities.map((p) => p.source), ['github', 'npm']);
  assert.equal(result.groups.hotBySource.github[0].popularities[0], result.groups.hotBySource.github[0].popularity);
});

test('同一 URL 同一 hot 来源的多个 metric 不得重复占用分组名额', () => {
  const makeCandidate = (metric, rank) => ({
    url: 'https://example.com/a', title: 'A', discoveredBy: ['bycli:npm'],
    popularity: {
      source: 'npm', metric, value: 10, allMetrics: { [metric]: 10 },
      rankInSource: rank, sortedLocally: true, searchWindowSize: 10,
    },
  });
  const result = mergeDocuments({
    hotDoc: { query: 'agent', candidates: [
      makeCandidate('weeklyDownloads', 2), makeCandidate('downloads', 1),
    ] },
    sxDoc: null, arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.groups.hotBySource.npm.length, 1);
  assert.equal(result.groups.hotBySource.npm[0].popularity.metric, 'downloads');
  assert.equal(result.groups.hotBySource.npm[0].popularities.length, 2);
});

test('false、0、空字符串输入不能伪装成未提供的通道', () => {
  const result = mergeDocuments({
    hotDoc: false, sxDoc: 0, arDoc: '', normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.match(result.warnings.join('\n'), /hot-file 结构无效/);
  assert.match(result.warnings.join('\n'), /searxng-file 结构无效/);
  assert.match(result.warnings.join('\n'), /agent-reach-file 结构无效/);
});

test('searxng 与 agent-reach 的畸形行被丢弃并计数告警', () => {
  const result = mergeDocuments({
    hotDoc: null,
    sxDoc: { query: 'agent', results: [null, { url: 'https://example.com/a' }] },
    arDoc: { query: 'agent', results: [42, { url: 'https://example.com/b' }] },
    normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.totals.incoming, 2);
  assert.match(result.warnings.join('\n'), /searxng-file 有 1 行不符合 schema/);
  assert.match(result.warnings.join('\n'), /agent-reach-file 有 1 行不符合 schema/);
});

test('结构无效通道的 query 不能污染有效通道的规范查询', () => {
  const result = mergeDocuments({
    hotDoc: { query: 'poison', candidates: 'not-an-array' },
    sxDoc: { query: 'agent', results: [{ url: 'https://example.com/a' }] },
    arDoc: null, normalizer: n, groupLimit: 5, searxngLimit: 20,
  });
  assert.equal(result.query, 'agent');
  assert.equal(result.totals.incoming, 1);
  assert.match(result.warnings.join('\n'), /hot-file 结构无效/);
});

test('维度选择显式报告无覆盖维度和完全无适配器', () => {
  const partial = selectAdaptersForDimensions(decl.adapters, ['packages', 'unknown'], new Set([1, 2, 3]));
  assert.ok(partial.selected.some((adapter) => adapter.dimensions.includes('packages')));
  assert.match(partial.warnings.join('\n'), /unknown.*无热度适配器覆盖/);

  const none = selectAdaptersForDimensions(decl.adapters, ['unknown'], new Set([1, 2, 3]));
  assert.equal(none.selected.length, 0);
  assert.match(none.warnings.join('\n'), /没有可运行的热度适配器/);
});

test('全部已选适配器 ok_empty 时产生聚合无覆盖信号', () => {
  const selected = [{ site: 'a' }, { site: 'b' }];
  assert.equal(allSelectedAdaptersEmpty(selected, {
    a: { status: 'ok_empty' }, b: { status: 'ok_empty' },
  }), true);
  assert.equal(allSelectedAdaptersEmpty(selected, {
    a: { status: 'ok_empty' }, b: { status: 'ok' },
  }), false);
  assert.equal(allSelectedAdaptersEmpty([], {}), false);
});

// ═══════════════ 声明表自身的完整性 ═══════════════

test('声明表 52 个适配器，分档 14/18/20', () => {
  const byTier = (t) => decl.adapters.filter((a) => a.tier === t).length;
  assert.equal(decl.adapters.length, 52);
  assert.equal(byTier(1), 14);
  assert.equal(byTier(2), 18);
  assert.equal(byTier(3), 20);
});

test('实测需要登录或高风险拦截的新适配器归入第三档', () => {
  const bySite = new Map(decl.adapters.map((adapter) => [adapter.site, adapter]));
  for (const site of ['gitlab', 'csdn', 'threads']) {
    assert.equal(bySite.get(site)?.tier, 3, `${site} 需要登录或高风险拦截`);
  }
});

test('新增九个公共浏览器适配器进入业务路由且不伪造热度', () => {
  const addedSites = ['baidu', 'bing', 'yandex', 'so', 'sogou', 'gitlab', 'csdn', 'threads', '52pojie'];
  const bySite = new Map(decl.adapters.map((adapter) => [adapter.site, adapter]));

  for (const site of addedSites) {
    const adapter = bySite.get(site);
    assert.ok(adapter, `${site} 未进入声明表`);
    assert.equal(adapter.tier, ['gitlab', 'csdn', 'threads'].includes(site) ? 3 : 2);
    assert.equal(adapter.cmd, 'search');
    assert.deepEqual(adapter.metricColumns, [], `${site} 不应把搜索相关性分数当作热度`);
    assert.deepEqual(adapter.titleContextFrom, ['snippet']);
  }
});

test('general 补充覆盖公共搜索、内容社区与新闻入口', () => {
  const bySite = new Map(decl.adapters.map((adapter) => [adapter.site, adapter]));
  const expected = {
    brave: { tier: 2, cmd: 'search', dimensions: ['general'] },
    duckduckgo: { tier: 2, cmd: 'search', dimensions: ['general'] },
    google: { tier: 2, cmd: 'search', dimensions: ['general'] },
    yahoo: { tier: 2, cmd: 'search', dimensions: ['general'] },
    toutiao: { tier: 2, cmd: 'search', dimensions: ['general'] },
    weixin: { tier: 2, cmd: 'sougousearch', dimensions: ['general', 'blogs'] },
    tieba: { tier: 3, cmd: 'search', dimensions: ['general', 'social media'] },
    weibo: { tier: 3, cmd: 'search', dimensions: ['general', 'social media'] },
    reuters: { tier: 3, cmd: 'search', dimensions: ['news'] },
    '36kr': { tier: 2, cmd: 'search', dimensions: ['it', 'news'] },
  };

  for (const [site, shape] of Object.entries(expected)) {
    const adapter = bySite.get(site);
    assert.ok(adapter, `${site} 未进入声明表`);
    assert.equal(adapter.tier, shape.tier, `${site} tier 不正确`);
    assert.equal(adapter.cmd, shape.cmd, `${site} 命令不正确`);
    assert.deepEqual(adapter.dimensions, shape.dimensions, `${site} 维度不正确`);
  }
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
