import path from 'node:path';

import { sourceTrustRank } from './rank.mjs';

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableText(value) {
  return JSON.stringify(stableValue(value));
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizeRepository(repository) {
  if (repository === null || repository === undefined) return null;
  if (typeof repository !== 'string' || !repository.trim()) return null;
  return repository.trim().replace(/^https?:\/\/(?:www\.)?/iu, '').replace(/^git@([^:]+):/iu, '$1/')
    .replace(/\.git\/?$/iu, '').replace(/\/+$/u, '').toLocaleLowerCase();
}

function normalizePath(recordPath) {
  if (recordPath === null || recordPath === undefined) return null;
  if (typeof recordPath !== 'string' || !recordPath.trim()) return null;
  const trimmed = recordPath.trim();
  if (trimmed.includes('\u0000') || path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    throw new TypeError('catalog record path must be a safe relative path');
  }
  const normalized = path.posix.normalize(trimmed.replace(/\\/gu, '/')).replace(/\/+$/u, '') || '.';
  if (normalized === '..' || normalized.startsWith('../')) throw new TypeError('catalog record path escapes its repository');
  return normalized;
}

function normalizeSecurity(security) {
  if (!plainObject(security)) return { status: 'unknown', reasons: [] };
  const candidate = typeof security.status === 'string' ? security.status.toLowerCase() : 'unknown';
  const status = ['pass', 'caution', 'unknown', 'malicious'].includes(candidate) ? candidate : 'unknown';
  const reasons = Array.isArray(security.reasons) ? security.reasons.filter((reason) => typeof reason === 'string') : [];
  return { status, reasons: [...reasons] };
}

function normalizeProvenance(provenance) {
  if (!plainObject(provenance) || typeof provenance.provider !== 'string' || !provenance.provider ||
    typeof provenance.rawId !== 'string' || !provenance.rawId || typeof provenance.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(provenance.retrievedAt))) {
    throw new TypeError('catalog record provenance requires provider, retrievedAt, and rawId');
  }
  return {
    provider: provenance.provider,
    retrievedAt: provenance.retrievedAt,
    rawId: provenance.rawId,
  };
}

function rankingEvidence(record, provenance) {
  const providerMetrics = plainObject(record.metrics) && plainObject(record.metrics[provenance.provider])
    ? clone(record.metrics[provenance.provider])
    : {};
  return {
    provider: provenance.provider,
    retrievedAt: provenance.retrievedAt,
    rawId: provenance.rawId,
    relevance: Number.isFinite(record.relevance) ? record.relevance : null,
    sourceTrustClass: typeof record.sourceTrustClass === 'string' && record.sourceTrustClass ? record.sourceTrustClass : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    metrics: providerMetrics,
  };
}

function normalizeEvidence(evidence) {
  if (!plainObject(evidence)) throw new TypeError('catalog record sourceEvidence must contain objects');
  const provenance = normalizeProvenance(evidence);
  return {
    provider: provenance.provider,
    retrievedAt: provenance.retrievedAt,
    rawId: provenance.rawId,
    relevance: Number.isFinite(evidence.relevance) ? evidence.relevance : null,
    sourceTrustClass: typeof evidence.sourceTrustClass === 'string' && evidence.sourceTrustClass
      ? evidence.sourceTrustClass
      : null,
    updatedAt: typeof evidence.updatedAt === 'string' ? evidence.updatedAt : null,
    metrics: plainObject(evidence.metrics) ? clone(evidence.metrics) : {},
  };
}

export function normalizeCatalogRecord(record) {
  if (!plainObject(record)) throw new TypeError('catalog record must be an object');
  if (!['skill', 'mcp'].includes(record.kind)) throw new TypeError('catalog record kind must be skill or mcp');
  if (typeof record.name !== 'string' || !record.name.trim()) throw new TypeError('catalog record name is required');
  const repository = normalizeRepository(record.repository);
  const recordPath = normalizePath(record.path);
  const provenance = normalizeProvenance(record.provenance);
  const sourceEvidence = Array.isArray(record.sourceEvidence) && record.sourceEvidence.length > 0
    ? record.sourceEvidence.map(normalizeEvidence)
    : [rankingEvidence(record, provenance)];
  return {
    kind: record.kind,
    name: record.name.trim(),
    description: typeof record.description === 'string' ? record.description : null,
    author: typeof record.author === 'string' ? record.author : null,
    repository,
    path: recordPath,
    version: typeof record.version === 'string' ? record.version : null,
    sources: Array.isArray(record.sources) ? clone(record.sources) : [],
    metrics: plainObject(record.metrics) ? clone(record.metrics) : {},
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    installCommands: plainObject(record.installCommands) ? clone(record.installCommands) : {},
    security: normalizeSecurity(record.security),
    provenance,
    relevance: Number.isFinite(record.relevance) ? record.relevance : null,
    sourceTrustClass: typeof record.sourceTrustClass === 'string' && record.sourceTrustClass ? record.sourceTrustClass : null,
    sourceEvidence,
    deduplicationConfidence: repository !== null && recordPath !== null ? 'high' : 'low',
  };
}

function uniqueSorted(values) {
  const byText = new Map(values.map((value) => [stableText(value), clone(value)]));
  return [...byText.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function securityStatus(records) {
  const priority = new Map([['malicious', 4], ['unknown', 3], ['caution', 2], ['pass', 1]]);
  return [...records].sort((left, right) => (priority.get(right.security.status) ?? 3) - (priority.get(left.security.status) ?? 3))[0].security.status;
}

function newest(left, right) {
  return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
}

function bestRankingRecord(records) {
  const highestTrust = Math.max(...records.map((record) => sourceTrustRank(record.sourceTrustClass)));
  const trusted = records.filter((record) => sourceTrustRank(record.sourceTrustClass) === highestTrust);
  const byProvider = new Map();
  for (const record of trusted) {
    const provider = record.provenance.provider;
    const group = byProvider.get(provider) ?? [];
    group.push(record);
    byProvider.set(provider, group);
  }
  const representatives = [...byProvider.values()].map((group) => [...group].sort((left, right) => {
    const relevanceDifference = (right.relevance ?? Number.NEGATIVE_INFINITY) - (left.relevance ?? Number.NEGATIVE_INFINITY);
    return relevanceDifference || newest(left, right) || stableText(left).localeCompare(stableText(right));
  })[0]);
  return representatives.sort((left, right) => newest(left, right) ||
    left.provenance.provider.localeCompare(right.provenance.provider) || stableText(left).localeCompare(stableText(right)))[0];
}

function mergeGroup(records) {
  const ordered = [...records].sort((left, right) => stableText(left).localeCompare(stableText(right)));
  const base = clone(bestRankingRecord(ordered));
  base.sources = uniqueSorted(ordered.flatMap((record) => record.sources));
  base.metrics = clone(base.metrics);
  for (const record of ordered) {
    for (const source of Object.keys(record.metrics).sort()) {
      if (!Object.hasOwn(base.metrics, source)) base.metrics[source] = clone(record.metrics[source]);
    }
  }
  const reasons = uniqueSorted(ordered.flatMap((record) => record.security.reasons));
  base.security = { status: securityStatus(ordered), reasons };
  base.sourceEvidence = uniqueSorted(ordered.flatMap((record) => record.sourceEvidence)).sort((left, right) =>
    byteCompare(left.provider, right.provider) || byteCompare(left.rawId, right.rawId) || byteCompare(stableText(left), stableText(right)));
  return base;
}

export function deduplicateCatalog(records) {
  if (!Array.isArray(records)) throw new TypeError('catalog records must be an array');
  const normalized = records.map(normalizeCatalogRecord);
  const groups = new Map();
  normalized.forEach((record, index) => {
    const key = record.deduplicationConfidence === 'high'
      ? `${record.kind}\u0000${record.repository}\u0000${record.path}`
      : `ambiguous\u0000${index}\u0000${stableText(record.provenance)}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  });
  return [...groups.values()].map(mergeGroup).sort((left, right) => {
    const leftKey = `${left.deduplicationConfidence}\u0000${left.kind}\u0000${left.repository ?? ''}\u0000${left.path ?? ''}\u0000${left.name}\u0000${stableText(left.provenance)}`;
    const rightKey = `${right.deduplicationConfidence}\u0000${right.kind}\u0000${right.repository ?? ''}\u0000${right.path ?? ''}\u0000${right.name}\u0000${stableText(right.provenance)}`;
    return leftKey.localeCompare(rightKey);
  });
}
