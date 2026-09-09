'use strict';

import crypto from 'node:crypto';

export const UNIFIED_CANDIDATE_SCHEMA_VERSION = '1.0';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tokens(query) {
  return [...new Set(text(query).normalize('NFKC').toLocaleLowerCase('und')
    .split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1))];
}

function matchedTerms(query, fields) {
  const haystack = fields.map(text).join('\n').normalize('NFKC').toLocaleLowerCase('und');
  return tokens(query).filter((token) => haystack.includes(token));
}

export function scoreUnifiedCandidate(candidate, query) {
  const terms = tokens(query);
  const title = text(candidate.title).normalize('NFKC').toLocaleLowerCase('und');
  const body = [candidate.snippet, candidate.abstract, candidate.content, candidate.filePath]
    .map(text).join('\n').normalize('NFKC').toLocaleLowerCase('und');
  const titleHits = terms.filter((term) => title.includes(term)).length;
  const bodyHits = terms.filter((term) => body.includes(term)).length;
  const sourceScore = Number(candidate.sourceScore);
  const sourceBonus = Number.isFinite(sourceScore) ? Math.max(0, Math.min(20, sourceScore)) : 0;
  const materializationBonus = candidate.materializable === true ? 3 : 0;
  const granularityBonus = candidate.contentGranularity === 'full-text' ? 4 : 0;
  return titleHits * 20 + bodyHits * 6 + sourceBonus + materializationBonus + granularityBonus;
}

export function normalizePublicCandidate(candidate, query) {
  const sourceUrl = text(candidate?.url || candidate?.sourceUrl);
  const title = text(candidate?.title) || sourceUrl;
  const normalized = {
    candidateId: `public-${crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16)}`,
    source: 'public-internet',
    title,
    sourceUrl,
    snippet: text(candidate?.content || candidate?.passage || candidate?.snippet),
    sourceScore: Number(candidate?.score || candidate?.sourceScore || 0),
    contentGranularity: text(candidate?.contentGranularity) || 'unknown',
    materializable: candidate?.discoveryDisposition === 'probe' || candidate?.eligibleArticle === true,
    matchedTerms: matchedTerms(query, [title, candidate?.content, candidate?.passage]),
  };
  return { ...normalized, relevanceScore: scoreUnifiedCandidate(normalized, query) };
}

export function normalizeCloudCandidate(candidate, query) {
  const normalized = {
    candidateId: text(candidate?.itemId),
    source: 'cloud-knowledge',
    title: text(candidate?.title || candidate?.originalFileName),
    sourceUrl: text(candidate?.sourceUrl),
    snippet: text(candidate?.snippet || candidate?.abstract),
    abstract: text(candidate?.abstract),
    sourceScore: Number(candidate?.score || candidate?.sourceScore || 0),
    contentGranularity: text(candidate?.materialization?.contentGranularity) || 'unknown',
    materializable: candidate?.fileType && Number.isSafeInteger(candidate?.fileSize),
    resourceId: candidate?.resourceId,
    filePath: text(candidate?.filePath),
    fileType: text(candidate?.fileType),
    fileSize: candidate?.fileSize,
    fileSignature: text(candidate?.fileSignature),
    duplicateGroupKey: text(candidate?.duplicateGroupKey),
    matchedTerms: matchedTerms(query, [candidate?.title, candidate?.originalFileName, candidate?.filePath]),
  };
  return { ...normalized, relevanceScore: scoreUnifiedCandidate(normalized, query) };
}

export function mergeUnifiedCandidates(query, { publicCandidates = [], cloudCandidates = [] } = {}) {
  const normalized = [
    ...publicCandidates.map((candidate) => normalizePublicCandidate(candidate, query)),
    ...cloudCandidates.map((candidate) => normalizeCloudCandidate(candidate, query)),
  ].filter((candidate) => candidate.sourceUrl && candidate.title);
  const byIdentity = new Map();
  for (const candidate of normalized) {
    const identity = candidate.source === 'cloud-knowledge'
      ? `${candidate.resourceId}\n${candidate.filePath}` : candidate.sourceUrl;
    const previous = byIdentity.get(identity);
    if (!previous || candidate.relevanceScore > previous.relevanceScore) byIdentity.set(identity, candidate);
  }
  return [...byIdentity.values()].sort((a, b) => (
    b.relevanceScore - a.relevanceScore
    || (a.source === 'cloud-knowledge' ? 0 : 1) - (b.source === 'cloud-knowledge' ? 0 : 1)
    || a.title.localeCompare(b.title)
    || a.sourceUrl.localeCompare(b.sourceUrl)
  ));
}

