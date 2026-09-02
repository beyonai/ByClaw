import crypto from 'node:crypto';
import {
  assertDiscoveryQueryMatches,
  assessCandidateTopic,
  createTopicContract,
  isEligibleArticle,
} from './topic-relevance.mjs';
import { classifyCandidates } from './candidate-quality.mjs';

export const AUTHORIZATION_SCHEMA_VERSION = '2.0';
const LEGACY_AUTHORIZATION_SCHEMA_VERSION = '1.1';
const MAX_DISCOVERY_ATTEMPTS = 2;
const MAX_OBSERVATIONS = 200;
const MAX_TITLE_CHARS = 1_000;
const MAX_SUMMARY_CHARS = 20_000;

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
  const id = candidateId('user-provided', canonicalUrl);
  return {
    candidateId: id,
    canonicalUrl,
    acquisitionUrls: [canonicalUrl],
    pageType: 'article',
    pageTypeReasons: ['user-provided-url'],
    discoveryDisposition: 'probe',
    probePriority: 'high',
    verificationRequired: true,
    topicRelevance: assessCandidateTopic(null, null),
    evidenceHash: crypto.createHash('sha256').update(`user-provided\n${canonicalUrl}`).digest('hex'),
    candidateVersion: 1,
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
    observations: [],
    observationDiagnostics: { overCap: 0, truncated: 0 },
    candidates,
    topicContract: createTopicContract(query, { required: topicRequired }),
  };
}

export function reserveDiscoveryAttempt(state, {
  query, category = 'general', allowCandidateRetry = false,
}) {
  if (!state || ![AUTHORIZATION_SCHEMA_VERSION, LEGACY_AUTHORIZATION_SCHEMA_VERSION].includes(state.schemaVersion)) {
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
  if (!allowCandidateRetry
    && previous?.status === 'complete' && previous.articleCandidateIds?.length > 0) {
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function boundedText(value, maximum) {
  if (typeof value !== 'string') return '';
  return [...value.trim()].slice(0, maximum).join('');
}

function normalizeObservation(rawCandidate, { query, category, rank }) {
  const url = normalizedHttpUrl(rawCandidate?.url);
  const provider = boundedText(rawCandidate?.provider || rawCandidate?.engine || 'unknown', 100) || 'unknown';
  const observedAt = boundedText(rawCandidate?.discoveredAt, 100) || new Date().toISOString();
  const channel = boundedText(rawCandidate?.channel || category, 100) || 'general';
  const requestId = boundedText(rawCandidate?.requestId, 500);
  const identity = [provider, query, channel, rank, requestId, observedAt, url].join('\n');
  const originalTitle = typeof rawCandidate?.title === 'string' ? [...rawCandidate.title.trim()].length : 0;
  const originalPassage = typeof rawCandidate?.passage === 'string' ? [...rawCandidate.passage.trim()].length : 0;
  const originalContent = typeof rawCandidate?.content === 'string' ? [...rawCandidate.content.trim()].length : 0;
  const sourceUrls = [];
  for (const rawUrl of Array.isArray(rawCandidate?.sourceUrls) ? rawCandidate.sourceUrls : []) {
    try {
      const normalized = normalizedHttpUrl(rawUrl);
      if (!sourceUrls.includes(normalized)) sourceUrls.push(normalized);
    } catch {}
  }
  return {
    observationId: `observation-${sha256(identity).slice(0, 24)}`,
    provider,
    providerVersion: boundedText(rawCandidate?.providerVersion, 100),
    query: boundedText(query, 2_000),
    channel,
    rank,
    requestId,
    observedAt,
    publishedAt: boundedText(rawCandidate?.publishedAt, 100),
    url,
    title: boundedText(rawCandidate?.title, MAX_TITLE_CHARS),
    passage: boundedText(rawCandidate?.passage, MAX_SUMMARY_CHARS),
    content: boundedText(rawCandidate?.content, MAX_SUMMARY_CHARS),
    site: boundedText(rawCandidate?.site, 1_000),
    sourceUrls,
    score: Number.isFinite(rawCandidate?.score) ? rawCandidate.score : null,
    authorityLevel: Number.isFinite(rawCandidate?.authorityLevel) ? rawCandidate.authorityLevel : null,
    evidenceLevel: boundedText(rawCandidate?.evidenceLevel, 100)
      || (rawCandidate?.passage || rawCandidate?.content ? 'summary' : 'metadata'),
    observationTruncated: originalTitle > MAX_TITLE_CHARS
      || originalPassage > MAX_SUMMARY_CHARS || originalContent > MAX_SUMMARY_CHARS,
  };
}

function candidateEvidenceFromObservations(observations, rawCandidate) {
  const uniqueText = (field) => [...new Set(observations.map((entry) => entry[field]).filter(Boolean))].join('\n');
  return {
    url: observations[0]?.url || rawCandidate?.url,
    title: uniqueText('title'),
    passage: uniqueText('passage'),
    content: uniqueText('content'),
    publishedAt: rawCandidate?.publishedAt,
    sourceUrls: [...new Set(observations.flatMap((entry) => entry.sourceUrls || []))],
  };
}

function normalizedCandidate(rawCandidate, topicContract, observationIds = []) {
  const canonicalUrl = normalizedHttpUrl(rawCandidate?.url);
  const acquisitionUrls = [];
  for (const rawUrl of [canonicalUrl,
    ...(Array.isArray(rawCandidate?.sourceUrls) ? rawCandidate.sourceUrls : [])]) {
    const normalized = normalizedHttpUrl(rawUrl);
    if (!acquisitionUrls.includes(normalized)) acquisitionUrls.push(normalized);
  }
  const annotated = classifyCandidates([{ ...rawCandidate, url: canonicalUrl }], topicContract).candidates[0];
  const evidenceHash = sha256(JSON.stringify({
    observationIds: [...observationIds].sort(),
    disposition: annotated.discoveryDisposition,
    priority: annotated.probePriority,
    reasons: annotated.pageTypeReasons,
    warnings: annotated.pageTypeWarnings,
    topic: annotated.topicRelevance,
    acquisitionUrls: [...acquisitionUrls].sort(),
  }));
  return {
    candidateId: candidateId('public-discover', canonicalUrl),
    canonicalUrl,
    acquisitionUrls,
    pageType: annotated.pageType,
    pageTypeReasons: annotated.pageTypeReasons,
    pageTypeWarnings: annotated.pageTypeWarnings,
    pageTypeEvidence: annotated.pageTypeEvidence,
    pageTypeScore: annotated.pageTypeScore,
    classifierRuleVersion: annotated.classifierRuleVersion,
    discoveryDisposition: annotated.discoveryDisposition,
    probePriority: annotated.probePriority,
    verificationRequired: true,
    topicRelevance: annotated.topicRelevance,
    observationIds: [...observationIds].sort(),
    evidenceHash,
    candidateVersion: 1,
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
    for (const field of ['title', 'content', 'passage', 'searxngContent', 'titleContext']) {
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

export function recordDiscoveryResult(state, {
  query, category = 'general', candidates = [], error = null, keepOpen = false,
}) {
  const run = [...state.runs].reverse().find((entry) => entry.status === 'running');
  if (!run || run.query !== String(query) || run.category !== String(category)) {
    throw new Error('DISCOVERY_AUTHORIZATION_INVALID: 没有匹配的进行中发现轮次');
  }
  if (state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION) {
    state.observations = Array.isArray(state.observations) ? state.observations : [];
    state.observationDiagnostics = state.observationDiagnostics || { overCap: 0, truncated: 0 };
    const knownObservationIds = new Set(state.observations.map((entry) => entry.observationId));
    candidates.forEach((rawCandidate, index) => {
      const observation = normalizeObservation(rawCandidate, { query, category, rank: index + 1 });
      const wasTruncated = boundedText(rawCandidate?.title, MAX_TITLE_CHARS) !== (rawCandidate?.title || '').trim()
        || boundedText(rawCandidate?.passage, MAX_SUMMARY_CHARS) !== (rawCandidate?.passage || '').trim()
        || boundedText(rawCandidate?.content, MAX_SUMMARY_CHARS) !== (rawCandidate?.content || '').trim();
      if (wasTruncated) state.observationDiagnostics.truncated += 1;
      if (knownObservationIds.has(observation.observationId)) return;
      if (state.observations.length >= MAX_OBSERVATIONS) {
        state.observationDiagnostics.overCap += 1;
        return;
      }
      state.observations.push(observation);
      knownObservationIds.add(observation.observationId);
    });
  }
  const existingById = new Map(state.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const recorded = [];
  for (const rawCandidate of mergeRawCandidates(candidates)) {
    const canonicalUrl = normalizedHttpUrl(rawCandidate?.url);
    const observations = state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION
      ? state.observations.filter((entry) => entry.url === canonicalUrl) : [];
    if (state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION && observations.length === 0) {
      continue;
    }
    const derivedEvidence = observations.length
      ? candidateEvidenceFromObservations(observations, rawCandidate) : rawCandidate;
    const candidate = state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION
      ? normalizedCandidate(derivedEvidence, state.topicContract, observations.map((entry) => entry.observationId))
      : normalizedCandidate({
        ...rawCandidate,
        topicRelevance: assessCandidateTopic(state.topicContract, rawCandidate),
      }, state.topicContract);
    const previous = existingById.get(candidate.candidateId);
    if (previous && previous.evidenceHash !== candidate.evidenceHash) {
      candidate.candidateVersion = (Number(previous.candidateVersion) || 1) + 1;
    } else if (previous) {
      candidate.candidateVersion = Number(previous.candidateVersion) || 1;
    }
    const replacesPrevious = state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION || !previous
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
  run.status = keepOpen ? 'running' : (error ? 'failed' : 'complete');
  run.error = error ? String(error) : null;
  run.candidateIds = [...new Set(recorded.map((candidate) => candidate.candidateId))];
  const structuralArticleCandidates = recorded.filter((candidate) => candidate.pageType === 'article');
  const articleCandidates = recorded.filter(isEligibleArticle);
  const probeCandidates = recorded.filter((candidate) => candidate.discoveryDisposition === 'probe'
    && ['matched', 'not-required', 'unknown'].includes(candidate.topicRelevance?.status));
  run.structuralArticleCandidateIds = structuralArticleCandidates.map((candidate) => candidate.candidateId);
  run.articleCandidateIds = articleCandidates.map((candidate) => candidate.candidateId);
  run.probeCandidateIds = probeCandidates.map((candidate) => candidate.candidateId);
  if (keepOpen) {
    state.exhausted = false;
    state.stopReason = null;
    state.stopDetail = null;
  } else if (articleCandidates.length > 0) {
    state.exhausted = false;
    state.stopReason = null;
    state.stopDetail = null;
  } else if (state.attemptCount >= state.maxAttempts) {
    state.exhausted = true;
    state.stopReason = 'no-article-candidates';
    state.stopDetail = 'no-relevant-article-candidates';
  }
  return { run, articleCandidates, structuralArticleCandidates, probeCandidates };
}

export function finalizeOpenDiscoveryAttempt(state, { query, category = 'general' }) {
  const run = [...state.runs].reverse().find((entry) => entry.status === 'running');
  if (!run || run.query !== String(query) || run.category !== String(category)) {
    throw new Error('DISCOVERY_AUTHORIZATION_INVALID: 没有匹配的进行中发现轮次');
  }
  run.status = 'complete';
  if ((run.articleCandidateIds || []).length > 0) {
    state.exhausted = false;
    state.stopReason = null;
    state.stopDetail = null;
  } else if (state.attemptCount >= state.maxAttempts) {
    state.exhausted = true;
    state.stopReason = 'no-article-candidates';
    state.stopDetail = 'no-relevant-article-candidates';
  }
  return run;
}

export function authorizePublicSource(state, rawUrl) {
  if (!state || ![AUTHORIZATION_SCHEMA_VERSION, LEGACY_AUTHORIZATION_SCHEMA_VERSION].includes(state.schemaVersion)) {
    return null;
  }
  const normalized = normalizedHttpUrl(rawUrl);
  const candidate = state.candidates.find((entry) =>
    entry.canonicalUrl === normalized || entry.acquisitionUrls.includes(normalized));
  if (!candidate) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: ${normalized} 不在本次授权候选中`);
  }
  const allowedTopics = state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION
    ? ['matched', 'not-required', 'unknown'] : ['matched', 'not-required'];
  if (candidate.origin === 'public-discover'
    && !allowedTopics.includes(candidate.topicRelevance?.status)) {
    throw new Error(`SOURCE_NOT_RELEVANT_TO_TASK: ${normalized} topicRelevance=${candidate.topicRelevance?.status || 'missing'}`);
  }
  if (state.schemaVersion === AUTHORIZATION_SCHEMA_VERSION && candidate.discoveryDisposition !== 'probe') {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: ${normalized} pageType=${candidate.pageType}`);
  }
  if (state.schemaVersion === LEGACY_AUTHORIZATION_SCHEMA_VERSION && !['article', 'weak'].includes(candidate.pageType)) {
    throw new Error(`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: ${normalized} pageType=${candidate.pageType}`);
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
