// Advisory scheduling only: this module never adds candidates or changes authorization.
export function host(candidate) {
  try { return new URL(candidate.canonicalUrl || candidate.url || '').hostname; } catch { return ''; }
}

export function resourcePath(candidate) {
  try { return new URL(candidate.canonicalUrl || candidate.url || '').pathname.slice(0, 500); } catch { return ''; }
}

export function collectionFeedback(session, run) {
  const candidates = session.task?.discoveryGate?.candidates || [];
  return (run?.attempts || []).filter((attempt) => attempt.finishedAt).slice(-20).map((attempt) => ({
    host: host(candidates.find((candidate) => candidate.candidateId === attempt.candidateId) || {}),
    reason: String(attempt.reasonCode || '').slice(0, 100),
    delivered: attempt.promotionStatus === 'promoted',
    durationMs: Math.max(0, Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) || 0,
  }));
}

function titleTokens(title) {
  const normalized = String(title || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)));
}

export function possibleDuplicates(candidates) {
  // Bounded lexical prefilter; the model only compares plausible pairs.
  const tokens = candidates.map((candidate) => titleTokens(candidate.title));
  const pairs = [];
  for (let right = 1; right < candidates.length && pairs.length < 40; right += 1) {
    for (let left = 0; left < right && pairs.length < 40; left += 1) {
      if (tokens[left].size < 8 || tokens[right].size < 8) continue;
      const common = [...tokens[left]].filter((token) => tokens[right].has(token)).length;
      if (common / (tokens[left].size + tokens[right].size - common) >= 0.65) pairs.push([left, right]);
    }
  }
  return pairs;
}

export function schedulingEvidence(session, candidates) {
  const observations = new Map((session.task.discoveryGate.observations || []).map((row) => [row.observationId, row]));
  return candidates.map((candidate) => {
    const rows = (candidate.observationIds || []).map((id) => observations.get(id)).filter(Boolean);
    return { ...candidate, id: candidate.candidateId, url: candidate.canonicalUrl,
      title: candidate.title || rows[0]?.title || '',
      content: rows.map((row) => row.content || row.passage || row.snippet || '').join('\n').slice(0, 4000) };
  });
}

export function collectedPublicCandidates(session) {
  return (session.collection?.collection?.items || [])
    .filter((item) => item.source === 'public-internet' && item.materialization?.status === 'materialized')
    .slice(-40).map((item) => ({ id: item.itemId, title: item.title, url: item.sourceUrl }));
}
