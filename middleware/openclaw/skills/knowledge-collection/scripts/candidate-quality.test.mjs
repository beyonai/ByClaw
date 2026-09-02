import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotateMergedCandidates,
  classifyCandidate,
  classifyCandidates,
  countUniqueArticles,
  summarizeMergedQuality,
} from './candidate-quality.mjs';
import { createTopicContract } from './topic-relevance.mjs';

function compatibilityShape(result) {
  return { pageType: result.pageType, reasons: result.reasons };
}

test('classifies explicit account and login pages as reject', () => {
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://user.mihoyo.com/login',
      title: '米哈游通行证登录',
      content: '登录账号',
    })),
    { pageType: 'reject', reasons: ['login-or-account-url', 'login-or-account-title'] },
  );
});

test('malformed percent escapes cannot crash deterministic classification', () => {
  assert.doesNotThrow(() => classifyCandidate({
    url: 'https://example.com/%E0%A4%A',
    title: 'Malformed URL article',
    content: 'A descriptive article passage with useful structural evidence.',
  }));
});

test('negated login wording in an article title is not an exact login page', () => {
  assert.notEqual(classifyCandidate({
    url: 'https://example.com/article/reading-guide',
    title: '无需登录即可阅读：DeepSeek 工程指南',
    content: '这是一篇包含完整工程背景与实现说明的文章摘要。',
  }).pageType, 'reject');
});

test('classifies root and company introduction pages as weak', () => {
  assert.deepEqual(
    compatibilityShape(classifyCandidate({ url: 'https://www.mihoyo.com/', title: '米哈游', content: '公司官网' })),
    { pageType: 'weak', reasons: ['root-or-home-page'] },
  );
  assert.deepEqual(
    compatibilityShape(classifyCandidate({ url: 'https://www.mihoyo.com/company/about', title: '公司介绍' })),
    { pageType: 'weak', reasons: ['ambiguous-detail-page'] },
  );
});

test('classifies article-shaped reports as article', () => {
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://example.com/news/2026/mihoyo-report',
      title: '米哈游的新一轮探索：深度报道',
      content: '记者采访了公司团队。',
    })),
    { pageType: 'article', reasons: ['detail-url', 'article-content-signal'] },
  );
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://mp.weixin.qq.com/s/fixture',
      title: '米哈游营收观察',
      content: '',
    })),
    { pageType: 'article', reasons: ['trusted-article-url', 'article-content-signal'] },
  );
});

test('treats a trusted WeChat detail URL as an article without keyword-dependent titles', () => {
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://mp.weixin.qq.com/s/opaque-token',
      title: '在上海重新出发',
    })),
    { pageType: 'article', reasons: ['trusted-article-url'] },
  );
});

test('treats a strict Sogou WeChat article redirect as an article', () => {
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://weixin.sogou.com/link?url=opaque-article-token',
      title: '外国玩家眼中的「米哈游发家史」',
    })),
    { pageType: 'article', reasons: ['trusted-wechat-redirect-url'] },
  );
  assert.equal(classifyCandidate({
    url: 'http://weixin.sogou.com/link?url=opaque-article-token',
    title: '米哈游文章',
  }).pageType, 'weak');
  assert.equal(classifyCandidate({
    url: 'https://weixin.sogou.com/link',
    title: '米哈游文章',
  }).pageType, 'weak');
  assert.equal(classifyCandidate({
    url: 'https://weixin.sogou.com/weixin?query=米哈游',
    title: '米哈游文章搜索结果',
  }).pageType, 'reject');
});

test('recognizes Nature and arXiv publication detail URLs without language-specific title keywords', () => {
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://www.nature.com/articles/s41586-025-09422-z',
      title: 'DeepSeek-R1 incentivizes reasoning in LLMs through reinforcement learning',
    })),
    { pageType: 'article', reasons: ['trusted-publication-url'] },
  );
  assert.deepEqual(
    compatibilityShape(classifyCandidate({
      url: 'https://arxiv.org/abs/2501.12948',
      title: 'DeepSeek-R1: Incentivizing Reasoning Capability in LLMs',
    })),
    { pageType: 'article', reasons: ['trusted-publication-url'] },
  );
});

test('promotes bounded structural detail routes only with article evidence', () => {
  const articleContext = '这是一段用于确认候选页面承载独立正文内容的有效详情摘要。'.repeat(5);
  const fixtures = [
    'https://example.com/1234567',
    'https://example.com/a1b2c3d4',
    'https://example.com/c/a1b2c3d4',
    'https://example.com/features/company-update.shtml',
    'https://example.com/2026/09/company-update',
    'https://example.com/2026/09/01/company-update',
  ];
  for (const url of fixtures) {
    assert.equal(classifyCandidate({
      url,
      title: 'Example 公司战略调整与业务进展',
      content: articleContext,
    }).pageType, 'article', url);
  }

  assert.equal(classifyCandidate({
    url: 'https://example.com/a1b2c3d4',
    title: 'Example 公司战略调整与业务进展',
    publishTime: '2026-09-01',
  }).pageType, 'article');
});

test('keeps undersized IDs, generic titles, index files, and channel routes weak', () => {
  const longContext = '这是一段超过二十个可见字符的摘要，但路径或标题仍不足以证明它是独立文章详情页面。';
  const fixtures = [
    { url: 'https://example.com/1234', title: 'Example 公司动态' },
    { url: 'https://example.com/a1b2c3d', title: 'Example 公司动态' },
    { url: 'https://example.com/c/a1b2c3d', title: 'Example 公司动态' },
    { url: 'https://example.com/index.html', title: 'Example 公司动态' },
    { url: 'https://example.com/channel/technology', title: 'Example 公司动态' },
    { url: 'https://example.com/category/technology', title: 'Example 公司动态' },
    { url: 'https://example.com/tag/technology', title: 'Example 公司动态' },
    { url: 'https://example.com/topic/technology', title: 'Example 公司动态' },
    { url: 'https://example.com/1234567', title: '新闻详情' },
  ];
  for (const candidate of fixtures) {
    assert.equal(classifyCandidate({ ...candidate, content: longContext }).pageType, 'weak', candidate.url);
  }
});

test('requires article text, twenty visible context characters, or publication metadata', () => {
  const base = {
    url: 'https://example.com/7654321',
    title: 'Example 公司战略调整与业务进展',
  };
  assert.equal(classifyCandidate({ ...base, content: '普通短摘要' }).pageType, 'weak');
  assert.equal(classifyCandidate({ ...base, content: '记者发布了最新报道' }).pageType, 'article');
  assert.equal(classifyCandidate({
    ...base,
    titleContext: '这是一段用于判断详情页的上下文。'.repeat(8),
  }).pageType, 'article');
});

test('explicit search and listing evidence retains reject precedence over detail structure', () => {
  assert.equal(classifyCandidate({
    url: 'https://example.com/1234567',
    title: 'Example 新闻列表',
    content: '搜索结果与全部文章',
  }).pageType, 'reject');
});

test('reject precedence prevents login and search pages from being promoted by article words', () => {
  assert.equal(classifyCandidate({
    url: 'https://example.com/login?next=/news/report',
    title: '登录后阅读报道',
  }).pageType, 'reject');
  assert.deepEqual(compatibilityShape(classifyCandidate({
    url: 'https://example.com/search?q=米哈游',
    title: '米哈游报道搜索结果',
  })), {
    pageType: 'reject',
    reasons: ['search-or-listing-url'],
  });
});

test('summary login shell text warns but cannot reject an article-shaped WSA candidate', () => {
  const result = classifyCandidate({
    url: 'https://news.example.com/a/1062887467_362225',
    title: 'DeepSeek Harness 深度解析',
    passage: `登录 注册 ${'本文分析 DeepSeek Harness 的架构、运行机制与工程实践。'.repeat(8)}`,
    provider: 'tencent-wsa',
    evidenceLevel: 'search-summary',
  });

  assert.equal(result.discoveryDisposition, 'probe');
  assert.equal(result.probePriority, 'high');
  assert.equal(result.pageType, 'article');
  assert.equal(result.verificationRequired, true);
  assert.ok(result.warnings.includes('login-shell-text'));
  assert.equal(result.reasons.includes('login-or-account-title'), false);
});

test('generic detail routes and stable query IDs produce explainable probe evidence', () => {
  const candidates = [
    {
      url: 'https://example.com/commonDetail/759632',
      title: 'DeepSeek Harness 工程实践',
      passage: '本文完整介绍系统设计、执行流程、状态管理以及落地经验。'.repeat(5),
    },
    {
      url: 'https://example.com/content/detail.php?pk=759632',
      title: 'DeepSeek Harness 工程实践',
      publishedAt: '2026-09-01',
    },
  ];
  for (const candidate of candidates) {
    const result = classifyCandidate(candidate);
    assert.equal(result.discoveryDisposition, 'probe', candidate.url);
    assert.equal(result.probePriority, 'high', candidate.url);
    assert.ok(result.evidence.length > 0, candidate.url);
    assert.equal(result.classifierRuleVersion, '2.0');
  }
});

test('topic unknown is normal-tail while topic unmatched is not probe-authorized', () => {
  const contract = createTopicContract('采集一篇关于 DeepSeek Harness 的文章');
  const unknown = classifyCandidates([{
    url: 'https://example.com/',
  }], contract).candidates[0];
  assert.equal(unknown.topicRelevance.status, 'unknown');
  assert.equal(unknown.discoveryDisposition, 'probe');
  assert.equal(unknown.probePriority, 'normal');
  assert.ok(unknown.pageTypeWarnings.includes('topic-unverified'));

  const unmatched = classifyCandidates([{
    url: 'https://example.com/commonDetail/759632',
    title: '米哈游游戏业务工程实践',
    passage: '本文讨论米哈游游戏业务、产品发布、玩家社区和商业化运营。'.repeat(6),
  }], contract).candidates[0];
  assert.equal(unmatched.topicRelevance.status, 'unmatched');
  assert.equal(unmatched.discoveryDisposition, 'reject');
  assert.equal(unmatched.probePriority, null);
  assert.ok(unmatched.pageTypeReasons.includes('topic-unmatched'));
});

test('counts normalized article URLs without collapsing different same-host paths', () => {
  const rows = [
    { url: 'https://news.example.com/article/1#section', title: '品牌访谈一' },
    { url: 'https://news.example.com/article/1', title: '品牌访谈一' },
    { url: 'https://news.example.com/article/2', title: '品牌访谈二' },
    { url: 'https://news.example.com/', title: '品牌首页' },
  ];
  assert.equal(countUniqueArticles(rows), 2);
  const classified = classifyCandidates(rows);
  assert.deepEqual({
    article: classified.article,
    weak: classified.weak,
    reject: classified.reject,
    eligibleArticle: classified.eligibleArticle,
    topicRelevance: classified.topicRelevance,
  }, {
    article: 3,
    weak: 1,
    reject: 0,
    eligibleArticle: 3,
    topicRelevance: { matched: 0, unmatched: 0, unknown: 0, notRequired: 4 },
  });
  assert.deepEqual(classified.candidates.map((candidate) => candidate.topicRelevance.status), [
    'not-required', 'not-required', 'not-required', 'not-required',
  ]);
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
  assert.deepEqual(summarizeMergedQuality(merged), {
    article: 1,
    weak: 1,
    reject: 0,
    eligibleArticle: 1,
    topicRelevance: { matched: 0, unmatched: 0, unknown: 0, notRequired: 2 },
  });
});

test('merges duplicate raw evidence before computing one relevance conclusion', () => {
  const url = 'https://example.com/news/1';
  const contract = createTopicContract('采集一篇关于 DeepSeek 的文章');
  const annotated = annotateMergedCandidates({
    groups: {
      bothChannels: [],
      searxngTop: [{ url, title: 'A reasoning-model report', content: '记者发布于今天' }],
      agentReachTop: [{ url, title: 'DeepSeek benchmark analysis', content: '' }],
      hotBySource: {},
      hotWithoutPopularity: [],
      unverified: [],
    },
  }, contract);

  assert.equal(annotated.groups.searxngTop[0].topicRelevance.status, 'matched');
  assert.equal(annotated.groups.agentReachTop[0].topicRelevance.status, 'matched');
});
