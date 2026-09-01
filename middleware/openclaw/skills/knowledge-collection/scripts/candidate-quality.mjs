'use strict';

const TYPE_ORDER = Object.freeze({ article: 0, weak: 1, reject: 2 });
const LOGIN_URL = /(?:^|\/)(?:login|signin|passport|account|auth)(?:\/|$)/i;
const LOGIN_TEXT = /(?:登录|注册|账号服务|通行证|sign\s*in|log\s*in)/i;
const SEARCH_URL = /(?:^|\/)(?:search|query|results?)(?:\/|$)/i;
const LISTING_TEXT = /(?:搜索结果|站内搜索|全部文章|文章列表|新闻列表)/i;
const ARTICLE_TEXT = /(?:报道|专访|访谈|深度|记者|新闻|观察|复盘|营收|发布于|作者)/i;
const DETAIL_PATH = /\/(?:news|article|post|story|stories|p|s|\d{4})\//i;

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

  if (url.pathname === '/' || url.pathname === '') {
    return { pageType: 'weak', reasons: ['root-or-home-page'] };
  }
  return { pageType: 'weak', reasons: ['ambiguous-detail-page'] };
}

function annotateCandidate(candidate) {
  const quality = classifyCandidate(candidate);
  return {
    ...candidate,
    pageType: quality.pageType,
    pageTypeReasons: quality.reasons,
  };
}

export function classifyCandidates(candidates) {
  const annotated = Array.isArray(candidates) ? candidates.map(annotateCandidate) : [];
  return {
    article: annotated.filter((candidate) => candidate.pageType === 'article').length,
    weak: annotated.filter((candidate) => candidate.pageType === 'weak').length,
    reject: annotated.filter((candidate) => candidate.pageType === 'reject').length,
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

function annotateAndSort(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({ candidate: annotateCandidate(candidate), index }))
    .sort((left, right) => TYPE_ORDER[left.candidate.pageType] - TYPE_ORDER[right.candidate.pageType]
      || left.index - right.index)
    .map(({ candidate }) => candidate);
}

export function annotateMergedCandidates(document) {
  const groups = document?.groups && typeof document.groups === 'object'
    ? document.groups : {};
  const hotBySource = groups.hotBySource && typeof groups.hotBySource === 'object'
    ? Object.fromEntries(Object.entries(groups.hotBySource)
      .map(([source, candidates]) => [source, annotateAndSort(candidates)]))
    : {};
  return {
    ...document,
    groups: {
      ...groups,
      bothChannels: annotateAndSort(groups.bothChannels),
      searxngTop: annotateAndSort(groups.searxngTop),
      agentReachTop: annotateAndSort(groups.agentReachTop),
      hotBySource,
      hotWithoutPopularity: annotateAndSort(groups.hotWithoutPopularity),
      unverified: annotateAndSort(groups.unverified),
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
    const candidate = rawCandidate?.pageType ? rawCandidate : annotateCandidate(rawCandidate);
    const identity = normalizedIdentity(candidate?.url);
    if (!identity) continue;
    const previous = byUrl.get(identity);
    if (!previous || TYPE_ORDER[candidate.pageType] < TYPE_ORDER[previous]) {
      byUrl.set(identity, candidate.pageType);
    }
  }
  const counts = { article: 0, weak: 0, reject: 0 };
  for (const pageType of byUrl.values()) counts[pageType] += 1;
  return counts;
}
