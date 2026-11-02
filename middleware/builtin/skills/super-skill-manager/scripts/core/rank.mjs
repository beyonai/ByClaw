const SECURITY_ORDER = new Map([['pass', 3], ['caution', 2], ['unknown', 1]]);
const TRUST_ORDER = new Map([
  ['official', 4], ['first-party', 4], ['curated', 3], ['verified', 3], ['marketplace', 3],
  ['community', 2], ['unverified', 1], ['github', 1], ['unknown', 0],
]);

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(byteCompare).map((key) => [key, stableValue(value[key])]));
}

function stableSerialization(record) {
  return JSON.stringify(stableValue(record));
}

function normalizedSecurityStatus(record) {
  const status = typeof record.security?.status === 'string' ? record.security.status.toLowerCase() : 'unknown';
  return ['pass', 'caution', 'unknown', 'malicious'].includes(status) ? status : 'unknown';
}

export function sourceTrustRank(sourceTrustClass) {
  return TRUST_ORDER.get(sourceTrustClass) ?? TRUST_ORDER.get('unknown');
}

function provider(record) {
  return typeof record.provenance?.provider === 'string' ? record.provenance.provider : '';
}

function relevance(record) {
  return Number.isFinite(record.relevance) ? record.relevance : Number.NEGATIVE_INFINITY;
}

function recencyBucket(updatedAt, now) {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated) || updated > now) return 0;
  const days = (now - updated) / 86_400_000;
  if (days <= 30) return 4;
  if (days <= 180) return 3;
  if (days <= 365) return 2;
  return 1;
}

function sourceNames(record) {
  if (!Array.isArray(record.sources)) return [];
  return [...new Set(record.sources.map((source) => source?.source ?? source?.provider).filter((source) => typeof source === 'string'))].sort();
}

function observationCount(record) {
  return sourceNames(record).filter((source) => source !== 'github').length;
}

function popularityPercentile(record) {
  if (record.metrics === null || typeof record.metrics !== 'object' || Array.isArray(record.metrics)) return -1;
  const values = Object.values(record.metrics).map((metric) => metric?.popularityPercentile)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  return values.length === 0 ? -1 : Math.max(...values);
}

function trust(record) {
  return sourceTrustRank(record.sourceTrustClass);
}

function stableIdentity(record) {
  return `${record.kind ?? ''}\u0000${record.repository ?? ''}\u0000${record.path ?? ''}\u0000${record.name ?? ''}\u0000${provider(record)}\u0000${record.provenance?.rawId ?? ''}`;
}

function compareBase(left, right, now) {
  const securityDifference = (SECURITY_ORDER.get(normalizedSecurityStatus(right)) ?? 1) -
    (SECURITY_ORDER.get(normalizedSecurityStatus(left)) ?? 1);
  if (securityDifference) return securityDifference;
  const trustDifference = trust(right) - trust(left);
  if (trustDifference) return trustDifference;
  const recencyDifference = recencyBucket(right.updatedAt, now) - recencyBucket(left.updatedAt, now);
  if (recencyDifference) return recencyDifference;
  const observationDifference = observationCount(right) - observationCount(left);
  if (observationDifference) return observationDifference;
  const popularityDifference = popularityPercentile(right) - popularityPercentile(left);
  if (popularityDifference) return popularityDifference;
  return byteCompare(stableIdentity(left), stableIdentity(right)) ||
    byteCompare(stableSerialization(left), stableSerialization(right));
}

function sortRanked(records, now) {
  const baseline = [...records].sort((left, right) => compareBase(left, right, now));
  const adapterQueues = new Map();
  for (const record of baseline) {
    const key = `${normalizedSecurityStatus(record)}\u0000${provider(record)}`;
    const queue = adapterQueues.get(key) ?? [];
    queue.push(record);
    adapterQueues.set(key, queue);
  }
  for (const queue of adapterQueues.values()) {
    queue.sort((left, right) => relevance(right) - relevance(left) || compareBase(left, right, now));
  }
  return baseline.map((record) => {
    const key = `${normalizedSecurityStatus(record)}\u0000${provider(record)}`;
    return adapterQueues.get(key).shift();
  });
}

function githubOnly(record) {
  const sources = sourceNames(record);
  return sources.length > 0 ? sources.every((source) => source === 'github') : provider(record) === 'github';
}

function withReasons(record, now) {
  const copy = structuredClone(record);
  copy.rankingReasons = [
    `security:${normalizedSecurityStatus(record)}`,
    `relevance:${provider(record) || 'unknown'}:${Number.isFinite(record.relevance) ? record.relevance : 'unknown'}`,
    `source-trust:${record.sourceTrustClass ?? 'unknown'}`,
    `maintenance-recency-bucket:${recencyBucket(record.updatedAt, now)}`,
    `independent-market-observations:${observationCount(record)}`,
    `platform-local-popularity-percentile:${popularityPercentile(record) < 0 ? 'unknown' : popularityPercentile(record)}`,
    `stable-tiebreak:${stableIdentity(record)}`,
  ];
  return copy;
}

export function rankCatalog(records, { limit = 10, now = Date.now() } = {}) {
  if (!Array.isArray(records)) throw new TypeError('catalog records must be an array');
  if (!Number.isInteger(limit) || limit < 0) throw new TypeError('limit must be a non-negative integer');
  const nowValue = typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(nowValue)) throw new TypeError('now must be a timestamp or ISO date');
  const excluded = [];
  const unverifiedCandidates = [];
  const eligible = [];
  for (const record of records) {
    const copy = withReasons(record, nowValue);
    if (normalizedSecurityStatus(record) === 'malicious') excluded.push(copy);
    else if (githubOnly(record)) unverifiedCandidates.push(copy);
    else eligible.push(copy);
  }
  const ranked = sortRanked(eligible, nowValue);
  return {
    top: ranked.slice(0, limit),
    unverifiedCandidates: sortRanked(unverifiedCandidates, nowValue),
    excluded: sortRanked(excluded, nowValue),
  };
}
