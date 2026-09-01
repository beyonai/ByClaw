import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotateMergedCandidates,
  classifyCandidate,
  classifyCandidates,
  countUniqueArticles,
  summarizeMergedQuality,
} from './candidate-quality.mjs';

test('classifies explicit account and login pages as reject', () => {
  assert.deepEqual(
    classifyCandidate({
      url: 'https://user.mihoyo.com/login',
      title: '米哈游通行证登录',
      content: '登录账号',
    }),
    { pageType: 'reject', reasons: ['login-or-account-url', 'login-or-account-title'] },
  );
});

test('classifies root and company introduction pages as weak', () => {
  assert.deepEqual(
    classifyCandidate({ url: 'https://www.mihoyo.com/', title: '米哈游', content: '公司官网' }),
    { pageType: 'weak', reasons: ['root-or-home-page'] },
  );
  assert.deepEqual(
    classifyCandidate({ url: 'https://www.mihoyo.com/company/about', title: '公司介绍' }),
    { pageType: 'weak', reasons: ['ambiguous-detail-page'] },
  );
});

test('classifies article-shaped reports as article', () => {
  assert.deepEqual(
    classifyCandidate({
      url: 'https://example.com/news/2026/mihoyo-report',
      title: '米哈游的新一轮探索：深度报道',
      content: '记者采访了公司团队。',
    }),
    { pageType: 'article', reasons: ['detail-url', 'article-content-signal'] },
  );
  assert.deepEqual(
    classifyCandidate({
      url: 'https://mp.weixin.qq.com/s/fixture',
      title: '米哈游营收观察',
      content: '',
    }),
    { pageType: 'article', reasons: ['trusted-article-url', 'article-content-signal'] },
  );
});

test('treats a trusted WeChat detail URL as an article without keyword-dependent titles', () => {
  assert.deepEqual(
    classifyCandidate({
      url: 'https://mp.weixin.qq.com/s/opaque-token',
      title: '在上海重新出发',
    }),
    { pageType: 'article', reasons: ['trusted-article-url'] },
  );
});

test('recognizes Nature and arXiv publication detail URLs without language-specific title keywords', () => {
  assert.deepEqual(
    classifyCandidate({
      url: 'https://www.nature.com/articles/s41586-025-09422-z',
      title: 'DeepSeek-R1 incentivizes reasoning in LLMs through reinforcement learning',
    }),
    { pageType: 'article', reasons: ['trusted-publication-url'] },
  );
  assert.deepEqual(
    classifyCandidate({
      url: 'https://arxiv.org/abs/2501.12948',
      title: 'DeepSeek-R1: Incentivizing Reasoning Capability in LLMs',
    }),
    { pageType: 'article', reasons: ['trusted-publication-url'] },
  );
});

test('reject precedence prevents login and search pages from being promoted by article words', () => {
  assert.equal(classifyCandidate({
    url: 'https://example.com/login?next=/news/report',
    title: '登录后阅读报道',
  }).pageType, 'reject');
  assert.deepEqual(classifyCandidate({
    url: 'https://example.com/search?q=米哈游',
    title: '米哈游报道搜索结果',
  }), {
    pageType: 'reject',
    reasons: ['search-or-listing-url', 'search-or-listing-title'],
  });
});

test('counts normalized article URLs without collapsing different same-host paths', () => {
  const rows = [
    { url: 'https://news.example.com/article/1#section', title: '品牌访谈一' },
    { url: 'https://news.example.com/article/1', title: '品牌访谈一' },
    { url: 'https://news.example.com/article/2', title: '品牌访谈二' },
    { url: 'https://news.example.com/', title: '品牌首页' },
  ];
  assert.equal(countUniqueArticles(rows), 2);
  assert.deepEqual(classifyCandidates(rows), {
    article: 3,
    weak: 1,
    reject: 0,
    candidates: [
      { ...rows[0], pageType: 'article', pageTypeReasons: ['detail-url', 'article-content-signal'] },
      { ...rows[1], pageType: 'article', pageTypeReasons: ['detail-url', 'article-content-signal'] },
      { ...rows[2], pageType: 'article', pageTypeReasons: ['detail-url', 'article-content-signal'] },
      { ...rows[3], pageType: 'weak', pageTypeReasons: ['root-or-home-page'] },
    ],
  });
});

test('annotates and stably ranks every merged candidate group', () => {
  const article = { url: 'https://example.com/news/1', title: '品牌深度报道' };
  const weak = { url: 'https://example.com/', title: '首页' };
  const reject = { url: 'https://example.com/login', title: '登录' };
  const merged = {
    groups: {
      bothChannels: [],
      searxngTop: [weak, article, reject],
      agentReachTop: [],
      hotBySource: { weixin: [reject, article] },
      hotWithoutPopularity: [],
      unverified: [],
    },
  };

  const annotated = annotateMergedCandidates(merged);

  assert.deepEqual(
    annotated.groups.searxngTop.map((row) => row.pageType),
    ['article', 'weak', 'reject'],
  );
  assert.deepEqual(
    annotated.groups.hotBySource.weixin.map((row) => row.pageType),
    ['article', 'reject'],
  );
  assert.deepEqual(merged.groups.searxngTop, [weak, article, reject]);
});

test('summarizes merged quality without double-counting the same URL across groups', () => {
  const article = {
    url: 'https://example.com/news/1',
    title: '品牌报道',
    pageType: 'article',
    pageTypeReasons: ['detail-url', 'article-content-signal'],
  };
  const merged = {
    groups: {
      bothChannels: [article],
      searxngTop: [{ ...article }],
      agentReachTop: [],
      hotBySource: {},
      hotWithoutPopularity: [],
      unverified: [{ url: 'https://example.com/', title: '首页', pageType: 'weak', pageTypeReasons: ['root-or-home-page'] }],
    },
  };
  assert.deepEqual(summarizeMergedQuality(merged), { article: 1, weak: 1, reject: 0 });
});
