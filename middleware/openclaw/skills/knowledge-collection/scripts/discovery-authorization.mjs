import crypto from 'node:crypto';
import {
  assertDiscoveryQueryMatches,
  assessCandidateTopic,
  createTopicContract,
  isEligibleArticle,
} from './topic-relevance.mjs';

export const AUTHORIZATION_SCHEMA_VERSION = '1.1';
const MAX_DISCOVERY_ATTEMPTS = 2;

function normalizedHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: URL 无效: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: URL 不安全: ${raw}`);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

function candidateId(origin, canonicalUrl) {
  const digest = crypto.createHash('sha256').update(`${origin}\n${canonicalUrl}`).digest('hex').slice(0, 16);
  return `candidate-${digest}`;
}

function directCandidate(rawUrl) {
  const canonicalUrl = normalizedHttpUrl(rawUrl);
  return {
    candidateId: candidateId('user-provided', canonicalUrl),
    canonicalUrl,
    acquisitionUrls: [canonicalUrl],
    pageType: 'article',
    pageTypeReasons: ['user-provided-url'],
    topicRelevance: assessCandidateTopic(null, null),
    origin: 'user-provided',
  };
}

function arxivRepresentation(rawUrl) {
  const normalized = normalizedHttpUrl(rawUrl);
  const url = new URL(normalized);
  if (url.hostname !== 'arxiv.org' || url.search) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: 不是可信 arXiv 表示: ${normalized}`);
  }
  const match = /^\/(abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i.exec(url.pathname);
  if (!match) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: 不是可信 arXiv 论文路径: ${normalized}`);
  }
  const versionlessId = match[2].replace(/v\d+$/i, '');
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/i.test(versionlessId)) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: arXiv 论文 ID 无效: ${normalized}`);
  }
  return { normalized, paperId: versionlessId.toLowerCase(), representation: match[1].toLowerCase() };
}

export function createDiscoveryAuthorization({ directUrls = [], query = '', topicRequired = true } = {}) {
  const candidates = [];
  const seen = new Set();
  for (const rawUrl of directUrls) {
    const candidate = directCandidate(rawUrl);
    if (seen.has(candidate.canonicalUrl)) continue;
    seen.add(candidate.canonicalUrl);
    candidates.push(candidate);
  }
  return {
    schemaVersion: AUTHORIZATION_SCHEMA_VERSION,
    maxAttempts: MAX_DISCOVERY_ATTEMPTS,
    attemptCount: 0,
    exhausted: false,
    stopReason: null,
    stopDetail: null,
    runs: [],
    candidates,
    topicContract: createTopicContract(query, { required: topicRequired }),
  };
}

export function reserveDiscoveryAttempt(state, { query, category = 'general' }) {
  if (!state || state.schemaVersion !== AUTHORIZATION_SCHEMA_VERSION) {
    if (state?.schemaVersion === '1.0') {
      throw new Error('DISCOVERY_RELEVANCE_MIGRATION_REQUIRED: 旧公共发现会话必须新建内部 run');
    }
    throw new Error('DISCOVERY_AUTHORIZATION_INVALID: discoveryAuthorization 状态无效');
  }
  assertDiscoveryQueryMatches(state.topicContract, query);
  const previous = state.runs.at(-1);
  if (previous?.status === 'running') {
    throw new Error('DISCOVERY_IN_PROGRESS: 已有公共发现轮次正在运行');
  }
  if (state.attemptCount >= state.maxAttempts) {
    throw new Error('DISCOVERY_ATTEMPTS_EXHAUSTED: 公共发现最多允许两轮');
  }
  if (previous?.status === 'complete' && previous.articleCandidateIds?.length > 0) {
    throw new Error('DISCOVERY_RETRY_NOT_ALLOWED: 首轮已经返回可用文章候选');
  }
  const run = {
    runId: `discovery-${state.attemptCount + 1}`,
    query: String(query),
    category: String(category),
    status: 'running',
    candidateIds: [],
    articleCandidateIds: [],
    structuralArticleCandidateIds: [],
  };
  state.attemptCount += 1;
  state.runs.push(run);
  state.exhausted = state.attemptCount >= state.maxAttempts;
  state.stopReason = null;
  state.stopDetail = null;
  return run;
}

function normalizedCandidate(rawCandidate) {
  const canonicalUrl = normalizedHttpUrl(rawCandidate?.url);
  const acquisitionUrls = [];
  for (const rawUrl of [canonicalUrl, ...(Array.isArray(rawCandidate?.sourceUrls) ? rawCandidate.sourceUrls : [])]) {
    const normalized = normalizedHttpUrl(rawUrl);
    if (!acquisitionUrls.includes(normalized)) acquisitionUrls.push(normalized);
  }
  return {
    candidateId: candidateId('public-discover', canonicalUrl),
    canonicalUrl,
    acquisitionUrls,
    pageType: rawCandidate?.pageType || 'weak',
    pageTypeReasons: Array.isArray(rawCandidate?.pageTypeReasons) ? rawCandidate.pageTypeReasons : [],
    topicRelevance: rawCandidate?.topicRelevance,
    origin: 'public-discover',
  };
}

function mergeRawCandidates(candidates) {
  const byUrl = new Map();
  const pageTypeRank = { reject: 0, article: 1, weak: 2 };
  for (const rawCandidate of candidates) {
    const canonicalUrl = normalizedHttpUrl(rawCandidate?.url);
    const previous = byUrl.get(canonicalUrl);
    if (!previous) {
      byUrl.set(canonicalUrl, {
        ...rawCandidate,
        url: canonicalUrl,
        sourceUrls: [...new Set(Array.isArray(rawCandidate?.sourceUrls) ? rawCandidate.sourceUrls : [])],
      });
      continue;
    }
    for (const field of ['title', 'content', 'searxngContent', 'titleContext']) {
      const values = [previous[field], rawCandidate?.[field]]
        .filter((value) => typeof value === 'string' && value.trim())
        .flatMap((value) => value.split('\n'));
      previous[field] = [...new Set(values)].join('\n');
    }
    previous.sourceUrls = [...new Set([
      ...(previous.sourceUrls || []),
      ...(Array.isArray(rawCandidate?.sourceUrls) ? rawCandidate.sourceUrls : []),
    ])];
    const incomingType = rawCandidate?.pageType || 'weak';
    if (pageTypeRank[incomingType] < pageTypeRank[previous.pageType || 'weak']) {
      previous.pageType = incomingType;
    }
    previous.pageTypeReasons = [...new Set([
      ...(previous.pageTypeReasons || []),
      ...(Array.isArray(rawCandidate?.pageTypeReasons) ? rawCandidate.pageTypeReasons : []),
    ])];
  }
  return [...byUrl.values()];
}

export function recordDiscoveryResult(state, { query, category = 'general', candidates = [], error = null }) {
  const run = [...state.runs].reverse().find((entry) => entry.status === 'running');
  if (!run || run.query !== String(query) || run.category !== String(category)) {
    throw new Error('DISCOVERY_AUTHORIZATION_INVALID: 没有匹配的进行中发现轮次');
  }
  const existingById = new Map(state.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const recorded = [];
  for (const rawCandidate of mergeRawCandidates(candidates)) {
    const candidate = normalizedCandidate({
      ...rawCandidate,
      topicRelevance: assessCandidateTopic(state.topicContract, rawCandidate),
    });
    const previous = existingById.get(candidate.candidateId);
    const replacesPrevious = !previous
      || candidate.pageType === 'reject'
      || (previous.pageType !== 'reject'
        && ((!isEligibleArticle(previous) && isEligibleArticle(candidate))
          || (previous.pageType === 'weak' && candidate.pageType === 'article')));
    if (replacesPrevious) {
      existingById.set(candidate.candidateId, candidate);
    }
    recorded.push(existingById.get(candidate.candidateId));
  }
  state.candidates = [...existingById.values()];
  run.status = error ? 'failed' : 'complete';
  run.error = error ? String(error) : null;
  run.candidateIds = [...new Set(recorded.map((candidate) => candidate.candidateId))];
  const structuralArticleCandidates = recorded.filter((candidate) => candidate.pageType === 'article');
  const articleCandidates = recorded.filter(isEligibleArticle);
  run.structuralArticleCandidateIds = structuralArticleCandidates.map((candidate) => candidate.candidateId);
  run.articleCandidateIds = articleCandidates.map((candidate) => candidate.candidateId);
  if (articleCandidates.length > 0) {
    state.exhausted = false;
    state.stopReason = null;
    state.stopDetail = null;
  } else if (state.attemptCount >= state.maxAttempts) {
    state.exhausted = true;
    state.stopReason = 'no-article-candidates';
    state.stopDetail = 'no-relevant-article-candidates';
  }
  return { run, articleCandidates, structuralArticleCandidates };
}

export function authorizePublicSource(state, rawUrl) {
  if (!state || state.schemaVersion !== AUTHORIZATION_SCHEMA_VERSION) {
    return null;
  }
  const normalized = normalizedHttpUrl(rawUrl);
  const candidate = state.candidates.find((entry) =>
    entry.canonicalUrl === normalized || entry.acquisitionUrls.includes(normalized));
  if (!candidate) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: ${normalized} 不在本次授权候选中`);
  }
  if (candidate.pageType !== 'article') {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: ${normalized} pageType=${candidate.pageType}`);
  }
  if (candidate.origin === 'public-discover'
    && !['matched', 'not-required'].includes(candidate.topicRelevance?.status)) {
    throw new Error(`SOURCE_NOT_RELEVANT_TO_TASK: ${normalized} topicRelevance=${candidate.topicRelevance?.status || 'missing'}`);
  }
  return candidate;
}

export function authorizeArxivAcquisitionVariant(state, sourceUrl, acquisitionUrl) {
  const candidate = authorizePublicSource(state, sourceUrl);
  const source = arxivRepresentation(sourceUrl);
  const acquisition = arxivRepresentation(acquisitionUrl);
  if (source.paperId !== acquisition.paperId) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: arXiv acquisition 论文 ID 不一致: ${acquisition.normalized}`);
  }
  if (!candidate.acquisitionUrls.includes(acquisition.normalized)) {
    candidate.acquisitionUrls.push(acquisition.normalized);
  }
  return candidate;
}

export function attachCandidateIds(candidates, state) {
  return candidates.map((candidate) => {
    const authorized = state.candidates.find((entry) => entry.canonicalUrl === normalizedHttpUrl(candidate.url));
    return authorized ? { ...candidate, discoveryCandidateId: authorized.candidateId } : candidate;
  });
}
