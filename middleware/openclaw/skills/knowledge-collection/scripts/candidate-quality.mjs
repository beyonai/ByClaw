'use strict';

import { assessCandidateTopic, isEligibleArticle } from './topic-relevance.mjs';

const TYPE_ORDER = Object.freeze({ article: 0, weak: 1, reject: 2 });
const LOGIN_URL = /(?:^|\/)(?:login|signin|passport|account|auth)(?:\/|$)/i;
const LOGIN_TEXT = /(?:登录|注册|账号服务|通行证|sign\s*in|log\s*in)/i;
const SEARCH_URL = /(?:^|\/)(?:search|query|results?)(?:\/|$)/i;
const LISTING_TEXT = /(?:搜索结果|站内搜索|全部文章|文章列表|新闻列表)/i;
const ARTICLE_TEXT = /(?:报道|专访|访谈|深度|记者|新闻|观察|复盘|营收|发布于|作者)/i;
const DETAIL_PATH = /\/(?:news|article|post|story|stories|p|s|\d{4})\//i;
const ARTICLE_FILE = /\/(?!index(?:\.html?|\.shtml)$)[^/]+\.(?:html?|shtml)$/i;
const GENERIC_PAGE_PATH = /(?:^|\/)(?:channel|category|tag|topic)(?:\/|$)|\/index\.(?:html?|shtml)$/i;
const GENERIC_TITLE = /^(?:首页|主页|新闻|文章|新闻详情|文章详情|详情|列表|频道|专题|话题|标签|index|home)$/i;
const NUMERIC_DETAIL_ID = /^\d{7,}$/;
const MIXED_DETAIL_ID = /^(?=.{8,}$)(?=.*[a-z])(?=.*\d)[a-z0-9_-]+$/i;
const DATE_DETAIL_PATH = /^\/\d{4}\/\d{1,2}(?:\/\d{1,2})?\/([^/]+)\/?$/;
const MIN_VISIBLE_CONTEXT_CHARS = 20;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function candidateText(candidate) {
  return [candidate?.title, candidate?.content, candidate?.searxngContent, candidate?.titleContext]
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

function isTrustedPublicationDetail(url) {
  const hostname = url.hostname.toLowerCase();
  return (hostname === 'arxiv.org' && /^\/abs\/[^/]+\/?$/i.test(url.pathname))
    || ((hostname === 'nature.com' || hostname.endsWith('.nature.com'))
      && /^\/articles\/[^/]+\/?$/i.test(url.pathname));
}

function visibleLength(value) {
  return text(value).replace(/\s+/g, '').length;
}

function hasPublicationMetadata(candidate) {
  return ['publishTime', 'publishedAt', 'published', 'published_at', 'datePublished', 'pubDate']
    .some((key) => text(candidate?.[key]));
}

function isOpaqueDetailId(value) {
  return NUMERIC_DETAIL_ID.test(value) || MIXED_DETAIL_ID.test(value);
}

function structuralDetailSignal(url) {
  const pathname = url.pathname;
  if (GENERIC_PAGE_PATH.test(pathname)) return null;
  if (ARTICLE_FILE.test(pathname)) return 'article-file';
  const segments = pathname.split('/').filter(Boolean);
  const leaf = segments.at(-1) || '';
  if (isOpaqueDetailId(leaf)) {
    return segments.at(-2)?.toLowerCase() === 'c' ? 'opaque-c-detail-id' : 'opaque-detail-id';
  }
  const dated = pathname.match(DATE_DETAIL_PATH);
  if (dated && !/^(?:index|channel|category|tag|topic)$/i.test(dated[1])) {
    return 'dated-detail-path';
  }
  return null;
}

function hasNewDetailEvidence(candidate, combinedText) {
  if (ARTICLE_TEXT.test(combinedText)) return true;
  if ([candidate?.content, candidate?.searxngContent, candidate?.titleContext]
    .some((value) => visibleLength(value) >= MIN_VISIBLE_CONTEXT_CHARS)) return true;
  return hasPublicationMetadata(candidate);
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
    return { pageType: 'reject', reasons: ['invalid-or-unsafe-url'] };
  }

  const combinedText = candidateText(candidate);
  const reasons = [];
  if (LOGIN_URL.test(url.pathname)) reasons.push('login-or-account-url');
  if (LOGIN_TEXT.test(combinedText)) reasons.push('login-or-account-title');
  if (reasons.length) return { pageType: 'reject', reasons };

  if (SEARCH_URL.test(url.pathname)) reasons.push('search-or-listing-url');
  if (LISTING_TEXT.test(combinedText)) reasons.push('search-or-listing-title');
  if (reasons.length) return { pageType: 'reject', reasons };

  if (GENERIC_PAGE_PATH.test(url.pathname)) {
    return { pageType: 'weak', reasons: ['generic-index-or-channel-page'] };
  }

  const trustedWechat = isTrustedWechatArticle(url);
  const trustedPublication = isTrustedPublicationDetail(url);
  if (trustedPublication) {
    return { pageType: 'article', reasons: ['trusted-publication-url'] };
  }
  const detailUrl = trustedWechat || DETAIL_PATH.test(url.pathname);
  const contentSignal = ARTICLE_TEXT.test(combinedText);
  if (trustedWechat) {
    return {
      pageType: 'article',
      reasons: contentSignal
        ? ['trusted-article-url', 'article-content-signal']
        : ['trusted-article-url'],
    };
  }
  if (detailUrl && contentSignal) {
    return { pageType: 'article', reasons: ['detail-url', 'article-content-signal'] };
  }
  const structuralSignal = structuralDetailSignal(url);
  const title = text(candidate?.title);
  if (structuralSignal && title && !GENERIC_TITLE.test(title)
    && hasNewDetailEvidence(candidate, combinedText)) {
    return { pageType: 'article', reasons: [structuralSignal, 'article-evidence'] };
  }

  if (url.pathname === '/' || url.pathname === '') {
    return { pageType: 'weak', reasons: ['root-or-home-page'] };
  }
  return { pageType: 'weak', reasons: ['ambiguous-detail-page'] };
}

function annotateCandidate(candidate, topicContract = null) {
  const quality = classifyCandidate(candidate);
  return {
    ...candidate,
    pageType: quality.pageType,
    pageTypeReasons: quality.reasons,
    topicRelevance: assessCandidateTopic(topicContract, candidate),
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
      searxngContents: [],
      titleContexts: [],
      qualities: [],
    };
    for (const [key, value] of [
      ['titles', candidate?.title],
      ['contents', candidate?.content],
      ['searxngContents', candidate?.searxngContent],
      ['titleContexts', candidate?.titleContext],
    ]) {
      const normalized = text(value);
      if (normalized && !aggregate[key].includes(normalized)) aggregate[key].push(normalized);
    }
    aggregate.qualities.push(classifyCandidate(candidate));
    rawByIdentity.set(identity, aggregate);
  }
  return new Map([...rawByIdentity].map(([identity, aggregate]) => {
    const rejected = aggregate.qualities.filter((quality) => quality.pageType === 'reject');
    const articles = aggregate.qualities.filter((quality) => quality.pageType === 'article');
    const selected = rejected.length ? rejected : articles.length ? articles : aggregate.qualities;
    const pageType = rejected.length ? 'reject' : articles.length ? 'article' : 'weak';
    const pageTypeReasons = [...new Set(selected.flatMap((quality) => quality.reasons))];
    const evidence = {
      url: aggregate.url,
      title: aggregate.titles.join('\n'),
      content: aggregate.contents.join('\n'),
      searxngContent: aggregate.searxngContents.join('\n'),
      titleContext: aggregate.titleContexts.join('\n'),
    };
    return [identity, {
      pageType,
      pageTypeReasons,
      topicRelevance: assessCandidateTopic(topicContract, evidence),
    }];
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
