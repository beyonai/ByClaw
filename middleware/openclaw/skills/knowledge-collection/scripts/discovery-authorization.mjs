import crypto from 'node:crypto';

const AUTHORIZATION_SCHEMA_VERSION = '1.0';
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
    origin: 'user-provided',
  };
}

export function createDiscoveryAuthorization({ directUrls = [] } = {}) {
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
    runs: [],
    candidates,
  };
}

export function reserveDiscoveryAttempt(state, { query, category = 'general' }) {
  if (!state || state.schemaVersion !== AUTHORIZATION_SCHEMA_VERSION) {
    throw new Error('DISCOVERY_AUTHORIZATION_INVALID: discoveryAuthorization 状态无效');
  }
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
  };
  state.attemptCount += 1;
  state.runs.push(run);
  state.exhausted = state.attemptCount >= state.maxAttempts;
  state.stopReason = null;
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
    origin: 'public-discover',
  };
}

export function recordDiscoveryResult(state, { query, category = 'general', candidates = [], error = null }) {
  const run = [...state.runs].reverse().find((entry) => entry.status === 'running');
  if (!run || run.query !== String(query) || run.category !== String(category)) {
    throw new Error('DISCOVERY_AUTHORIZATION_INVALID: 没有匹配的进行中发现轮次');
  }
  const existingById = new Map(state.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const recorded = [];
  for (const rawCandidate of candidates) {
    const candidate = normalizedCandidate(rawCandidate);
    const previous = existingById.get(candidate.candidateId);
    if (!previous || (previous.pageType !== 'article' && candidate.pageType === 'article')) {
      existingById.set(candidate.candidateId, candidate);
    }
    recorded.push(existingById.get(candidate.candidateId));
  }
  state.candidates = [...existingById.values()];
  run.status = error ? 'failed' : 'complete';
  run.error = error ? String(error) : null;
  run.candidateIds = [...new Set(recorded.map((candidate) => candidate.candidateId))];
  const articleCandidates = recorded.filter((candidate) => candidate.pageType === 'article');
  run.articleCandidateIds = articleCandidates.map((candidate) => candidate.candidateId);
  if (articleCandidates.length > 0) {
    state.exhausted = false;
    state.stopReason = null;
  } else if (state.attemptCount >= state.maxAttempts) {
    state.exhausted = true;
    state.stopReason = 'no-article-candidates';
  }
  return { run, articleCandidates };
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
  return candidate;
}

export function attachCandidateIds(candidates, state) {
  return candidates.map((candidate) => {
    const authorized = state.candidates.find((entry) => entry.canonicalUrl === normalizedHttpUrl(candidate.url));
    return authorized ? { ...candidate, discoveryCandidateId: authorized.candidateId } : candidate;
  });
}
