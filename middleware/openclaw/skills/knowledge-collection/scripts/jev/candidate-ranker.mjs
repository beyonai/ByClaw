import { callTypeSafeJev } from './typesafe.mjs';

const BATCH_SIZE = 40;
const TOTAL_BUDGET_MS = 10_000;
const MAX_REQUEST_CHARS = 2_000;
const MAX_ID_CHARS = 500;
const MAX_TITLE_CHARS = 1_000;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_LABEL_CHARS = 100;
const MAX_LABELS = 10;

function text(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function labels(value) {
  return Array.isArray(value)
    ? value.slice(0, MAX_LABELS).map((entry) => text(entry, MAX_LABEL_CHARS)).filter(Boolean)
    : [];
}

function eligible(candidate) {
  return candidate?.discoveryDisposition !== 'reject';
}

function agreement(candidate) {
  const providers = Array.isArray(candidate?.providers) ? candidate.providers : [];
  const engines = Array.isArray(candidate?.engines) ? candidate.engines : [];
  return Math.min(1, Math.max(providers.length, engines.length) / 2);
}

function rankScore(candidate) {
  const rank = Number(candidate?.originalRank);
  return Number.isFinite(rank) && rank > 0 ? 1 / rank : 0;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function fallback(candidates, code) {
  return { candidates, diagnostic: { status: 'fallback', code } };
}

export async function rankCandidates(request, candidates, options = {}) {
  const source = Array.isArray(candidates) ? candidates : [];
  const rows = source.filter(eligible);
  if (rows.length === 0) return { candidates: source, diagnostic: { status: 'skipped', code: 'NO_ELIGIBLE_CANDIDATES' } };
  const callJev = options.callJev || callTypeSafeJev;
  const now = options.now || (() => performance.now());
  const deadline = now() + TOTAL_BUDGET_MS;
  const outerRemainingBudgetMs = options.remainingBudgetMs;
  const remainingBudgetMs = () => {
    const localRemaining = Math.max(0, deadline - now());
    if (typeof outerRemainingBudgetMs !== 'function') return localRemaining;
    const outerRemaining = Number(outerRemainingBudgetMs());
    return Number.isFinite(outerRemaining) ? Math.max(0, Math.min(localRemaining, outerRemaining)) : localRemaining;
  };
  const scores = new Map();
  let model = null;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    if (remainingBudgetMs() <= 0) return fallback(source, 'TYPESAFE_RANKING_BUDGET_EXHAUSTED');
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const questions = Object.fromEntries(batch.map((candidate, index) => [`r${index}`, {
      type: 'noul',
      instructions: 'Is this search candidate directly relevant to the original request?',
      criteria: { true: 'directly relevant', false: 'not directly relevant' },
    }]));
    const state = {
      request: text(request, MAX_REQUEST_CHARS),
      candidates: Object.fromEntries(batch.map((candidate, index) => [`r${index}`, {
        id: text(candidate.id, MAX_ID_CHARS) || `candidate-${offset + index}`,
        title: text(candidate.title, MAX_TITLE_CHARS),
        summary: text(candidate.content || candidate.passage || candidate.searxngContent, MAX_SUMMARY_CHARS),
        providers: labels(candidate.providers),
        engines: labels(candidate.engines),
      }])),
    };
    const response = await callJev({ state, questions }, { ...options, remainingBudgetMs });
    if (!response?.ok) return fallback(source, response?.diagnostic?.code || 'TYPESAFE_RANKING_FAILED');
    model = response.document?.model || model;
    for (let index = 0; index < batch.length; index += 1) {
      const answer = response.document?.answers?.[`r${index}`];
      if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
        return fallback(source, 'TYPESAFE_RANKING_INVALID');
      }
      scores.set(batch[index], answer.noul);
    }
  }
  const ranked = rows.map((candidate, stableIndex) => {
    const semanticRelevance = scores.get(candidate);
    const providerAgreement = agreement(candidate);
    const originalRankScore = rankScore(candidate);
    const finalScore = rounded((semanticRelevance * 0.8) + (providerAgreement * 0.12) + (originalRankScore * 0.08));
    return { candidate: { ...candidate, ranking: { version: '1.0', semanticRelevance,
      providerAgreement, originalRankScore, finalScore, judge: 'typesafe' } }, stableIndex };
  }).sort((a, b) => b.candidate.ranking.finalScore - a.candidate.ranking.finalScore || a.stableIndex - b.stableIndex)
    .map(({ candidate }) => candidate);
  const rejected = source.filter((candidate) => !eligible(candidate));
  return { candidates: [...ranked, ...rejected], diagnostic: { status: 'used', model, candidateCount: rows.length } };
}
