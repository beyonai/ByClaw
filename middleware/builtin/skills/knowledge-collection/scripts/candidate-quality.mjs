'use strict';

import { assessCandidateTopic, isEligibleArticle } from './topic-relevance.mjs';

const TYPE_ORDER = Object.freeze({ article: 0, weak: 1, reject: 2 });
const LOGIN_URL = /(?:^|\/)(?:login|signin|passport|account|auth)(?:\/|$)/i;
const LOGIN_TEXT = /(?:登录|注册|账号服务|通行证|sign\s*in|log\s*in)/i;
const LOGIN_WALL_TEXT = /(?:请|需要|必须)?(?:先)?登录(?:后|才|以便)?(?:查看|阅读全文|继续阅读|访问)|sign\s*in\s+to\s+(?:read|continue)/i;
const SEARCH_URL = /(?:^|\/)(?:search|query|results?)(?:\/|$)/i;
const LISTING_TEXT = /(?:搜索结果|站内搜索|全部文章|文章列表|新闻列表)/i;
const ARTICLE_TEXT = /(?:报道|专访|访谈|深度|记者|新闻|观察|复盘|营收|发布于|作者)/i;
const DETAIL_PATH = /\/(?:news|article|post|story|stories|p|s|\d{4})\//i;
const ARTICLE_FILE = /\/(?!index(?:\.html?|\.shtml)$)[^/]+\.(?:html?|shtml)$/i;
const GENERIC_PAGE_PATH = /(?:^|\/)(?:channel|category|tag|topic)(?:\/|$)|\/index\.(?:html?|shtml)$/i;
const GENERIC_TITLE = /^(?:首页|主页|新闻|文章|新闻详情|文章详情|详情|列表|频道|专题|话题|标签|index|home)$/i;
const NUMERIC_DETAIL_ID = /^\d{5,}$/;
const COMPOSITE_DETAIL_ID = /^\d{3,}[_-]\d{3,}$/;
const MIXED_DETAIL_ID = /^(?=.{8,}$)(?=(?:.*[a-z]){2})(?=(?:.*\d){2})[a-z0-9_-]+$/i;
const DATE_DETAIL_PATH = /^\/\d{4}\/\d{1,2}(?:\/\d{1,2})?\/([^/]+)\/?$/;
const DETAIL_QUERY_KEYS = new Set(['id', 'aid', 'articleid', 'docid', 'contentid', 'pk']);
const DETAIL_TOKENS = new Set(['article', 'news', 'content', 'detail', 'post', 'story', 'read', 'view']);
const MIN_SUMMARY_CODE_POINTS = 80;
const HIGH_PRIORITY_SCORE = 4;

export const CLASSIFIER_RULE_VERSION = '2.0';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function candidateText(candidate) {
  return [candidate?.title, candidate?.content, candidate?.passage,
    candidate?.searxngContent, candidate?.titleContext]
    .map(text)
    .filter(Boolean)
    .join('\n');
}

function parseHttpUrl(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isTrustedWechatArticle(url) {
  return url.protocol === 'https:'
    && url.hostname.toLowerCase() === 'mp.weixin.qq.com'
    && /^\/s(?:\/|$)/i.test(url.pathname);
}

function isTrustedSogouWechatRedirect(url) {
  return url.protocol === 'https:'
    && url.hostname.toLowerCase() === 'weixin.sogou.com'
    && /^\/link\/?$/i.test(url.pathname)
    && Boolean(url.searchParams.get('url')?.trim());
}

function isTrustedPublicationDetail(url) {
  const hostname = url.hostname.toLowerCase();
  return (hostname === 'arxiv.org' && /^\/abs\/[^/]+\/?$/i.test(url.pathname))
    || ((hostname === 'nature.com' || hostname.endsWith('.nature.com'))
      && /^\/articles\/[^/]+\/?$/i.test(url.pathname));
}

function visibleLength(value) {
  return [...text(value).normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '')].length;
}

function hasPublicationMetadata(candidate) {
  return ['publishTime', 'publishedAt', 'published', 'published_at', 'datePublished', 'pubDate']
    .some((key) => text(candidate?.[key]));
}

function isOpaqueDetailId(value) {
  return NUMERIC_DETAIL_ID.test(value) || COMPOSITE_DETAIL_ID.test(value)
    || MIXED_DETAIL_ID.test(value);
}

function structuralDetailSignal(url) {
  const pathname = url.pathname;
  if (GENERIC_PAGE_PATH.test(pathname)) return null;
  if (ARTICLE_FILE.test(pathname)) return 'article-file';
  const segments = pathname.split('/').filter(Boolean);
  const leaf = segments.at(-1) || '';
  if (COMPOSITE_DETAIL_ID.test(leaf)) return 'composite-detail-id';
  if (isOpaqueDetailId(leaf)) {
    return segments.at(-2)?.toLowerCase() === 'c' ? 'opaque-c-detail-id' : 'opaque-detail-id';
  }
  const dated = pathname.match(DATE_DETAIL_PATH);
  if (dated && !/^(?:index|channel|category|tag|topic)$/i.test(dated[1])) {
    return 'dated-detail-path';
  }
  return null;
}

function splitPathTokens(pathname) {
  return pathname.split('/').filter(Boolean).flatMap((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch {}
    return decoded
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
  });
}

function detailQuerySignal(url) {
  return [...url.searchParams].some(([key, value]) => DETAIL_QUERY_KEYS.has(key.toLowerCase())
    && /^[a-z0-9_-]{1,128}$/i.test(value));
}

function result(pageType, reasons, {
  warnings = [], evidence = [], score = 0, priority = null, disposition,
} = {}) {
  const discoveryDisposition = disposition || (pageType === 'reject' ? 'reject' : 'probe');
  return {
    pageType,
    reasons,
    discoveryDisposition,
    probePriority: discoveryDisposition === 'probe' ? (priority || 'normal') : null,
    verificationRequired: true,
    warnings: [...new Set(warnings)],
    evidence: [...new Set(evidence)],
    score,
    classifierRuleVersion: CLASSIFIER_RULE_VERSION,
  };
}

function exactLoginTitle(title) {
  const normalized = text(title).normalize('NFKC');
  if (/(?:无需|免|不必|不用)\s*(?:登录|注册)/iu.test(normalized)) return false;
  return normalized.length <= 40 && !ARTICLE_TEXT.test(normalized)
    && /^(?:.{0,24})?(?:登录|注册|用户登录|账号登录|账户登录|log\s*in|sign\s*in|sign\s*up)(?:页|页面|中心)?$/iu
      .test(normalized);
}

function exactListingTitle(title) {
  const normalized = text(title).normalize('NFKC');
  return normalized.length <= 60 && LISTING_TEXT.test(normalized) && !ARTICLE_TEXT.test(normalized.replace(/新闻列表/g, ''));
}

function applyTopicDisposition(quality, topicRelevance) {
  const warnings = [...quality.warnings];
  const reasons = [...quality.reasons];
  let discoveryDisposition = quality.discoveryDisposition;
  let probePriority = quality.probePriority;
  let pageType = quality.pageType;
  if (topicRelevance.status === 'unknown' && discoveryDisposition === 'probe') {
    warnings.push('topic-unverified');
    probePriority = 'normal';
    if (pageType === 'article') pageType = 'weak';
  } else if (topicRelevance.status === 'unmatched') {
    discoveryDisposition = 'reject';
    probePriority = null;
    reasons.push('topic-unmatched');
  }
  return {
    ...quality,
    pageType,
    pageTypeReasons: [...new Set(reasons)],
    pageTypeWarnings: [...new Set(warnings)],
    pageTypeEvidence: quality.evidence,
    pageTypeScore: quality.score,
    discoveryDisposition,
    probePriority,
    topicRelevance,
  };
}

function normalizedIdentity(raw) {
  const url = parseHttpUrl(raw);
  if (!url || url.username || url.password) return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

export function classifyCandidate(candidate) {
  const url = parseHttpUrl(candidate?.url);
  if (!url || url.username || url.password) {
    return result('reject', ['invalid-or-unsafe-url']);
  }

  const combinedText = candidateText(candidate);
  const title = text(candidate?.title);
  const summaries = [candidate?.content, candidate?.passage, candidate?.searxngContent, candidate?.titleContext]
    .map(text).filter(Boolean).join('\n');
  const reasons = [];
  if (LOGIN_URL.test(url.pathname)) reasons.push('login-or-account-url');
  if (exactLoginTitle(title)) reasons.push('login-or-account-title');
  if (reasons.length) return result('reject', reasons);

  if (SEARCH_URL.test(url.pathname)) reasons.push('search-or-listing-url');
  if (exactListingTitle(title)) reasons.push('search-or-listing-title');
  if (reasons.length) return result('reject', reasons);

  const warnings = [];
  if (LOGIN_TEXT.test(summaries)) warnings.push('login-shell-text');
  const possibleLoginGate = LOGIN_WALL_TEXT.test(summaries);
  if (possibleLoginGate) warnings.push('possible-login-gate');

  if (GENERIC_PAGE_PATH.test(url.pathname)) {
    return result('weak', ['generic-index-or-channel-page'], { warnings });
  }

  const trustedWechat = isTrustedWechatArticle(url);
  const trustedWechatRedirect = isTrustedSogouWechatRedirect(url);
  const trustedPublication = isTrustedPublicationDetail(url);
  if (trustedPublication) {
    return result('article', ['trusted-publication-url'], {
      warnings, evidence: ['trusted-publication-url'], score: HIGH_PRIORITY_SCORE, priority: 'high',
    });
  }
  const detailUrl = trustedWechat || DETAIL_PATH.test(url.pathname);
  const contentSignal = ARTICLE_TEXT.test(combinedText);
  if (trustedWechat) {
    return result('article', contentSignal
        ? ['trusted-article-url', 'article-content-signal']
        : ['trusted-article-url'], {
      warnings, evidence: ['trusted-article-url'], score: HIGH_PRIORITY_SCORE, priority: 'high',
    });
  }
  if (trustedWechatRedirect) {
    return result('article', ['trusted-wechat-redirect-url'], {
      warnings, evidence: ['trusted-wechat-redirect-url'], score: HIGH_PRIORITY_SCORE, priority: 'high',
    });
  }

  const evidence = [];
  let score = 0;
  let hasStructural = false;
  let hasContentOrMetadata = false;
  const structuralSignal = structuralDetailSignal(url);
  if (detailUrl) {
    score += 2;
    hasStructural = true;
    evidence.push('detail-url');
  } else if (structuralSignal) {
    score += 2;
    hasStructural = true;
    evidence.push(structuralSignal);
  }
  if (splitPathTokens(url.pathname).some((token) => DETAIL_TOKENS.has(token))) {
    score += 1;
    hasStructural = true;
    evidence.push('detail-route-token');
  }
  if (detailQuerySignal(url)) {
    score += 1;
    hasStructural = true;
    evidence.push('detail-query-parameter');
  }
  if (title && !GENERIC_TITLE.test(title)) {
    score += 1;
    hasContentOrMetadata = true;
    evidence.push('non-generic-title');
  }
  if (visibleLength(summaries) >= MIN_SUMMARY_CODE_POINTS) {
    score += 1;
    hasContentOrMetadata = true;
    evidence.push('summary-minimum-length');
  }
  if (hasPublicationMetadata(candidate)) {
    score += 2;
    hasContentOrMetadata = true;
    evidence.push('publication-metadata');
  }
  if (contentSignal) {
    score += 1;
    hasContentOrMetadata = true;
    evidence.push('article-content-signal');
  }
  const high = score >= HIGH_PRIORITY_SCORE && hasStructural && hasContentOrMetadata && !possibleLoginGate;
  if (high) {
    const compatibilityReasons = detailUrl && contentSignal
      ? ['detail-url', 'article-content-signal']
      : [structuralSignal || evidence.find((entry) => entry.includes('detail')) || 'article-structure', 'article-evidence'];
    return result('article', compatibilityReasons, {
      warnings, evidence, score, priority: 'high',
    });
  }

  if (url.pathname === '/' || url.pathname === '') {
    return result('weak', ['root-or-home-page'], { warnings, evidence, score });
  }
  return result('weak', ['ambiguous-detail-page'], { warnings, evidence, score });
}

function annotateCandidate(candidate, topicContract = null) {
  const quality = classifyCandidate(candidate);
  const topicRelevance = assessCandidateTopic(topicContract, candidate);
  return {
    ...candidate,
    ...applyTopicDisposition(quality, topicRelevance),
  };
}

function qualitySummary(annotated) {
  const relevance = { matched: 0, unmatched: 0, unknown: 0, notRequired: 0 };
  for (const candidate of annotated) {
    const key = candidate.topicRelevance.status === 'not-required'
      ? 'notRequired' : candidate.topicRelevance.status;
    relevance[key] += 1;
  }
  return {
    article: annotated.filter((candidate) => candidate.pageType === 'article').length,
    weak: annotated.filter((candidate) => candidate.pageType === 'weak').length,
    reject: annotated.filter((candidate) => candidate.pageType === 'reject').length,
    eligibleArticle: annotated.filter(isEligibleArticle).length,
    topicRelevance: relevance,
  };
}

export function classifyCandidates(candidates, topicContract = null) {
  const annotated = Array.isArray(candidates)
    ? candidates.map((candidate) => annotateCandidate(candidate, topicContract)) : [];
  return {
    ...qualitySummary(annotated),
    candidates: annotated,
  };
}

export function countUniqueArticles(candidates) {
  const urls = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (classifyCandidate(candidate).pageType !== 'article') continue;
    const identity = normalizedIdentity(candidate?.url);
    if (identity) urls.add(identity);
  }
  return urls.size;
}

export function countUniqueEligibleArticles(candidates, topicContract = null) {
  const urls = new Set();
  const annotatedCandidates = annotateMergedCandidates({
    groups: {
      bothChannels: [],
      searxngTop: Array.isArray(candidates) ? candidates : [],
      agentReachTop: [],
      hotBySource: {},
      hotWithoutPopularity: [],
      unverified: [],
    },
  }, topicContract).groups.searxngTop;
  for (const annotated of annotatedCandidates) {
    if (!isEligibleArticle(annotated)) continue;
    const identity = normalizedIdentity(annotated?.url);
    if (identity) urls.add(identity);
  }
  return urls.size;
}

function annotateAndSort(candidates, topicContract, mergedByIdentity = null) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({
      candidate: mergedByIdentity?.get(normalizedIdentity(candidate?.url))
        ? { ...candidate, ...mergedByIdentity.get(normalizedIdentity(candidate?.url)) }
        : annotateCandidate(candidate, topicContract),
      index,
    }))
    .sort((left, right) => TYPE_ORDER[left.candidate.pageType] - TYPE_ORDER[right.candidate.pageType]
      || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function mergedAnnotations(document, topicContract) {
  const rawByIdentity = new Map();
  for (const candidate of mergedCandidates(document)) {
    const identity = normalizedIdentity(candidate?.url);
    if (!identity) continue;
    const aggregate = rawByIdentity.get(identity) || {
      url: candidate.url,
      titles: [],
      contents: [],
      passages: [],
      searxngContents: [],
      titleContexts: [],
    };
    for (const [key, value] of [
      ['titles', candidate?.title],
      ['contents', candidate?.content],
      ['passages', candidate?.passage],
      ['searxngContents', candidate?.searxngContent],
      ['titleContexts', candidate?.titleContext],
    ]) {
      const normalized = text(value);
      if (normalized && !aggregate[key].includes(normalized)) aggregate[key].push(normalized);
    }
    rawByIdentity.set(identity, aggregate);
  }
  return new Map([...rawByIdentity].map(([identity, aggregate]) => {
    const evidence = {
      url: aggregate.url,
      title: aggregate.titles.join('\n'),
      content: aggregate.contents.join('\n'),
      passage: aggregate.passages.join('\n'),
      searxngContent: aggregate.searxngContents.join('\n'),
      titleContext: aggregate.titleContexts.join('\n'),
    };
    return [identity, applyTopicDisposition(
      classifyCandidate(evidence),
      assessCandidateTopic(topicContract, evidence),
    )];
  }));
}

export function annotateMergedCandidates(document, topicContract = null) {
  const groups = document?.groups && typeof document.groups === 'object'
    ? document.groups : {};
  const annotations = mergedAnnotations(document, topicContract);
  const hotBySource = groups.hotBySource && typeof groups.hotBySource === 'object'
    ? Object.fromEntries(Object.entries(groups.hotBySource)
      .map(([source, candidates]) => [source, annotateAndSort(candidates, topicContract, annotations)]))
    : {};
  return {
    ...document,
    groups: {
      ...groups,
      bothChannels: annotateAndSort(groups.bothChannels, topicContract, annotations),
      searxngTop: annotateAndSort(groups.searxngTop, topicContract, annotations),
      agentReachTop: annotateAndSort(groups.agentReachTop, topicContract, annotations),
      hotBySource,
      hotWithoutPopularity: annotateAndSort(groups.hotWithoutPopularity, topicContract, annotations),
      unverified: annotateAndSort(groups.unverified, topicContract, annotations),
    },
  };
}

export function mergedCandidates(document) {
  const groups = document?.groups && typeof document.groups === 'object' ? document.groups : {};
  return [
    ...(Array.isArray(groups.bothChannels) ? groups.bothChannels : []),
    ...(Array.isArray(groups.searxngTop) ? groups.searxngTop : []),
    ...(Array.isArray(groups.agentReachTop) ? groups.agentReachTop : []),
    ...Object.values(groups.hotBySource && typeof groups.hotBySource === 'object' ? groups.hotBySource : {})
      .flatMap((candidates) => (Array.isArray(candidates) ? candidates : [])),
    ...(Array.isArray(groups.hotWithoutPopularity) ? groups.hotWithoutPopularity : []),
    ...(Array.isArray(groups.unverified) ? groups.unverified : []),
  ];
}

export function summarizeMergedQuality(document) {
  const byUrl = new Map();
  for (const rawCandidate of mergedCandidates(document)) {
    const candidate = rawCandidate?.pageType && rawCandidate?.topicRelevance
      ? rawCandidate : annotateCandidate(rawCandidate);
    const identity = normalizedIdentity(candidate?.url);
    if (!identity) continue;
    const previous = byUrl.get(identity);
    if (!previous || TYPE_ORDER[candidate.pageType] < TYPE_ORDER[previous.pageType]) {
      byUrl.set(identity, candidate);
    }
  }
  return qualitySummary([...byUrl.values()]);
}
