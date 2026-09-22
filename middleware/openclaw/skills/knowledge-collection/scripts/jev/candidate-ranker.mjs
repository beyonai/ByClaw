import { callTypeSafeJev } from './typesafe.mjs';

const BATCH_SIZE = 40;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const scores = new Map();
  let model = null;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const questions = Object.fromEntries(batch.map((candidate, index) => [`r${index}`, {
      type: 'noul',
      instructions: 'Is this search candidate directly relevant to the original request?',
      criteria: { true: 'directly relevant', false: 'not directly relevant' },
    }]));
    const state = {
      request,
      candidates: Object.fromEntries(batch.map((candidate, index) => [`r${index}`, {
        id: text(candidate.id) || `candidate-${offset + index}`,
        title: text(candidate.title),
        summary: text(candidate.content || candidate.passage || candidate.searxngContent),
        providers: candidate.providers || [],
        engines: candidate.engines || [],
      }])),
    };
    const response = await callJev({ state, questions }, options);
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
