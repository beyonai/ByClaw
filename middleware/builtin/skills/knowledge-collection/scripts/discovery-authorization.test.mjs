import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeArxivAcquisitionVariant,
  authorizePublicSource,
  createDiscoveryAuthorization,
  recordDiscoveryResult,
  reserveDiscoveryAttempt,
} from './discovery-authorization.mjs';
import * as authorizationModule from './discovery-authorization.mjs';
import { newSession } from './session.mjs';

test('registers only official same-paper arXiv acquisition representations', () => {
  const state = createDiscoveryAuthorization({
    directUrls: ['https://arxiv.org/pdf/2501.12948'],
  });

  const candidate = authorizeArxivAcquisitionVariant(
    state,
    'https://arxiv.org/pdf/2501.12948',
    'https://arxiv.org/html/2501.12948v2',
  );
  assert.equal(candidate.canonicalUrl, 'https://arxiv.org/pdf/2501.12948');
  assert.deepEqual(candidate.acquisitionUrls, [
    'https://arxiv.org/pdf/2501.12948',
    'https://arxiv.org/html/2501.12948v2',
  ]);
  assert.equal(
    authorizePublicSource(state, 'https://arxiv.org/html/2501.12948v2').candidateId,
    candidate.candidateId,
  );

  for (const invalid of [
    'https://arxiv.org/html/1706.03762',
    'https://example.com/html/2501.12948',
    'https://user:secret@arxiv.org/html/2501.12948',
    'https://arxiv.org/search/2501.12948',
  ]) {
    assert.throws(
      () => authorizeArxivAcquisitionVariant(
        state,
        'https://arxiv.org/pdf/2501.12948',
        invalid,
      ),
      /SOURCE_NOT_AUTHORIZED_BY_DISCOVERY|arXiv/i,
      invalid,
    );
  }
});

test('authorizes persisted probe dispositions and ignores provider pageType claims', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'DeepSeek-R1', category: 'science' });
  const recorded = recordDiscoveryResult(state, {
    query: 'DeepSeek-R1',
    category: 'science',
    candidates: [
      {
        url: 'https://arxiv.org/abs/2501.12948',
        sourceUrls: [
          'https://arxiv.org/abs/2501.12948',
          'https://arxiv.org/pdf/2501.12948',
        ],
        pageType: 'article',
      },
      {
        url: 'https://www.nature.com/articles/example',
        pageType: 'weak',
      },
      {
        url: 'https://example.com/search?q=deepseek',
        pageType: 'reject',
      },
    ],
  });

  assert.equal(recorded.articleCandidates.length, 2);
  assert.equal(
    authorizePublicSource(state, 'https://arxiv.org/abs/2501.12948').origin,
    'public-discover',
  );
  assert.equal(
    authorizePublicSource(state, 'https://arxiv.org/pdf/2501.12948').canonicalUrl,
    'https://arxiv.org/abs/2501.12948',
  );
  assert.equal(
    authorizePublicSource(state, 'https://www.nature.com/articles/example').pageType,
    'article',
  );
  assert.throws(
    () => authorizePublicSource(state, 'https://example.com/search?q=deepseek'),
    /SOURCE_NOT_AUTHORIZED_BY_DISCOVERY.*pageType=reject/,
  );
  assert.throws(
    () => authorizePublicSource(state, 'https://arxiv.org/abs/9999.99999'),
    /SOURCE_NOT_AUTHORIZED_BY_DISCOVERY/,
  );
});

test('explicit user URLs are authorized without public discovery', () => {
  const state = createDiscoveryAuthorization({
    directUrls: ['https://example.com/user-selected-article'],
  });

  const candidate = authorizePublicSource(state, 'https://example.com/user-selected-article');
  assert.equal(candidate.origin, 'user-provided');
  assert.equal(candidate.pageType, 'article');
  assert.equal(candidate.topicRelevance.status, 'not-required');
});

test('authorizes only topic-matched structural articles for schema 2.0 sessions', () => {
  const state = createDiscoveryAuthorization({ query: '采集一篇关于 DeepSeek 的文章' });
  assert.equal(state.schemaVersion, '2.0');
  assert.equal(state.topicContract.normalizedSubject, 'deepseek');
  reserveDiscoveryAttempt(state, { query: 'DeepSeek paper', category: 'science' });
  const recorded = recordDiscoveryResult(state, {
    query: 'DeepSeek paper',
    category: 'science',
    candidates: [{
      url: 'https://arxiv.org/abs/2103.05770v1',
      title: 'Notebook articles: towards a transformative publishing experience',
      pageType: 'article',
    }],
  });

  assert.equal(recorded.structuralArticleCandidates.length, 1);
  assert.equal(recorded.articleCandidates.length, 0);
  assert.equal(state.candidates[0].topicRelevance.status, 'unmatched');
  assert.throws(
    () => authorizePublicSource(state, 'https://arxiv.org/abs/2103.05770v1'),
    /SOURCE_NOT_RELEVANT_TO_TASK.*topicRelevance=unmatched/,
  );
});

test('rejects a drifting retry before reserving an attempt', () => {
  const state = createDiscoveryAuthorization({ query: '采集一篇关于 DeepSeek 的文章' });
  assert.throws(
    () => reserveDiscoveryAttempt(state, { query: 'Qwen paper', category: 'science' }),
    /DISCOVERY_QUERY_DRIFT/,
  );
  assert.equal(state.attemptCount, 0);
  assert.deepEqual(state.runs, []);
});

test('authorization recomputes relevance after merging duplicate channel evidence', () => {
  const state = createDiscoveryAuthorization({ query: 'neural scaling' });
  reserveDiscoveryAttempt(state, { query: 'neural scaling', category: 'science' });
  const result = recordDiscoveryResult(state, {
    query: 'neural scaling',
    category: 'science',
    candidates: [
      { url: 'https://example.com/news/report', title: 'Neural report', pageType: 'article' },
      { url: 'https://example.com/news/report', content: 'Scaling analysis', pageType: 'article' },
    ],
  });

  assert.equal(result.articleCandidates.length, 1);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].topicRelevance.status, 'matched');
});

test('a later structural upgrade retains immutable topic evidence from earlier observations', () => {
  const state = createDiscoveryAuthorization({ query: '采集一篇关于 DeepSeek 的文章' });
  reserveDiscoveryAttempt(state, { query: 'DeepSeek paper', category: 'science' });
  recordDiscoveryResult(state, {
    query: 'DeepSeek paper',
    category: 'science',
    candidates: [{
      url: 'https://example.com/commonDetail/entry', title: 'DeepSeek navigation', pageType: 'weak',
    }],
  });
  reserveDiscoveryAttempt(state, { query: 'DeepSeek report', category: 'science' });
  const second = recordDiscoveryResult(state, {
    query: 'DeepSeek report',
    category: 'science',
    candidates: [{
      url: 'https://example.com/commonDetail/entry',
      title: 'Unrelated report',
      passage: 'This publication discusses an unrelated product and its market operations. '.repeat(4),
      publishedAt: '2026-09-01',
      pageType: 'article',
    }],
  });

  assert.equal(second.articleCandidates.length, 1);
  assert.equal(second.structuralArticleCandidates.length, 1);
  assert.equal(state.candidates[0].pageType, 'article');
  assert.equal(state.candidates[0].topicRelevance.status, 'matched');
  assert.equal(state.candidates[0].candidateVersion, 2);
});

test('records bounded immutable observations and a versioned candidate view', () => {
  const state = createDiscoveryAuthorization({ query: 'DeepSeek Harness' });
  reserveDiscoveryAttempt(state, { query: 'DeepSeek Harness', category: 'science' });
  const recorded = recordDiscoveryResult(state, {
    query: 'DeepSeek Harness',
    category: 'science',
    candidates: [{
      url: 'https://example.com/commonDetail/759632',
      title: 'DeepSeek Harness 工程实践',
      passage: '这篇文章介绍 DeepSeek Harness 的架构设计、执行流程和工程落地。'.repeat(6),
      provider: 'tencent-wsa',
      requestId: 'request-1',
      discoveredAt: '2026-09-02T00:00:00.000Z',
      score: 0.8,
      authorityLevel: 4,
      authorization: 'Bearer must-not-persist',
      pageType: 'reject',
    }],
  });

  assert.equal(state.observations.length, 1);
  assert.deepEqual(Object.keys(state.observations[0]).sort(), [
    'authorityLevel', 'channel', 'content', 'evidenceLevel', 'observationId',
    'observationTruncated', 'observedAt', 'passage', 'provider', 'providerVersion',
    'publishedAt', 'query', 'rank', 'requestId', 'score', 'site', 'sourceUrls', 'title', 'url',
  ]);
  assert.doesNotMatch(JSON.stringify(state), /must-not-persist|authorization/i);
  assert.equal(recorded.probeCandidates.length, 1);
  assert.equal(state.candidates[0].discoveryDisposition, 'probe');
  assert.equal(state.candidates[0].probePriority, 'high');
  assert.equal(state.candidates[0].candidateVersion, 1);
  assert.match(state.candidates[0].evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(state.candidates[0].verificationRequired, true);
});

test('observation cap never leaves an unbacked candidate in the probe queue', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'bounded candidates' });
  const candidates = Array.from({ length: 201 }, (_, index) => ({
    url: `https://example.com/article/${index}`,
    title: `Bounded article ${index}`,
    content: 'A sufficiently descriptive article summary for deterministic probing.',
  }));
  const result = recordDiscoveryResult(state, { query: 'bounded candidates', candidates });
  assert.equal(state.observations.length, 200);
  assert.equal(state.observationDiagnostics.overCap, 1);
  assert.equal(state.candidates.length, 200);
  assert.equal(result.probeCandidates.length, 200);
});

test('replayed mutable sourceUrls cannot rewrite immutable acquisition authorization', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'immutable acquisition' });
  const base = {
    url: 'https://example.com/article/immutable', title: 'Immutable acquisition article',
    content: 'A sufficiently descriptive article summary for probing.', provider: 'fixture',
    requestId: 'same-request', discoveredAt: '2026-09-02T00:00:00.000Z',
  };
  recordDiscoveryResult(state, {
    query: 'immutable acquisition',
    candidates: [{ ...base, sourceUrls: ['https://example.com/read/a'] }],
  });
  const before = JSON.parse(JSON.stringify(state.candidates[0]));
  reserveDiscoveryAttempt(state, { query: 'immutable acquisition', allowCandidateRetry: true });
  recordDiscoveryResult(state, {
    query: 'immutable acquisition',
    candidates: [{ ...base, sourceUrls: ['https://evil.example/read/b'] }],
  });
  const after = state.candidates[0];
  assert.deepEqual(after.acquisitionUrls, before.acquisitionUrls);
  assert.equal(after.evidenceHash, before.evidenceHash);
  assert.equal(after.candidateVersion, before.candidateVersion);
});

test('a later discovery round cannot rewrite accepted acquisition evidence or its candidate', () => {
  const requestedUrl = 'https://m.example.com/article/123';
  const resolvedUrl = 'https://www.example.com/article/123?source=redirect';
  const state = createDiscoveryAuthorization({ query: 'Example article' });
  reserveDiscoveryAttempt(state, { query: 'Example article' });
  recordDiscoveryResult(state, {
    query: 'Example article',
    candidates: [{
      url: requestedUrl,
      title: 'Example article analysis',
      content: 'Example article analysis with sufficient discovery evidence for probing.',
      pageType: 'article',
    }],
  });
  const candidate = authorizePublicSource(state, requestedUrl);
  const session = newSession({ discoveryGate: state });
  authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: candidate.candidateId,
    requestedUrl,
    resolvedUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/article/executor-result.json',
  });
  const evidenceBefore = JSON.parse(JSON.stringify(session.task.acquisitionEvidence));
  const candidateBefore = JSON.parse(JSON.stringify(candidate));

  reserveDiscoveryAttempt(state, { query: 'Example article followup', allowCandidateRetry: true });
  recordDiscoveryResult(state, {
    query: 'Example article followup',
    candidates: [{
      url: 'https://example.com/article/other',
      title: 'Example article followup',
      content: 'A different Example article discovered during the bounded fallback round.',
      pageType: 'article',
    }],
  });

  assert.deepEqual(session.task.acquisitionEvidence, evidenceBefore);
  assert.deepEqual(state.candidates.find((entry) => entry.candidateId === candidate.candidateId), candidateBefore);
  assert.equal(
    authorizationModule.authorizeAcceptedAcquisitionEvidence(
      session, candidate.candidateId, resolvedUrl,
    ).candidateId,
    candidate.candidateId,
  );
});

test('keeps schema 1.1 authorization readable for legacy atomic commands', () => {
  const state = createDiscoveryAuthorization({ directUrls: ['https://example.com/article/12345'] });
  state.schemaVersion = '1.1';
  const candidate = authorizePublicSource(state, 'https://example.com/article/12345');
  assert.equal(candidate.origin, 'user-provided');
});

test('discovery authorization rejects a third public discovery attempt', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'first', category: 'general' });
  recordDiscoveryResult(state, { query: 'first', category: 'general', candidates: [] });
  reserveDiscoveryAttempt(state, { query: 'second', category: 'science' });
  recordDiscoveryResult(state, { query: 'second', category: 'science', candidates: [] });

  assert.equal(state.exhausted, true);
  assert.equal(state.stopReason, 'no-article-candidates');
  assert.equal(state.stopDetail, 'no-relevant-article-candidates');
  assert.throws(
    () => reserveDiscoveryAttempt(state, { query: 'third', category: 'science' }),
    /DISCOVERY_ATTEMPTS_EXHAUSTED/,
  );
});

test('a second discovery attempt is allowed only when the first produced no article', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'first', category: 'science' });
  recordDiscoveryResult(state, {
    query: 'first',
    category: 'science',
    candidates: [{ url: 'https://arxiv.org/abs/2501.12948', pageType: 'article' }],
  });

  assert.throws(
    () => reserveDiscoveryAttempt(state, { query: 'unnecessary retry', category: 'science' }),
    /DISCOVERY_RETRY_NOT_ALLOWED/,
  );
});

test('owned public-collect may use its fallback round after candidates fail verification', () => {
  const state = createDiscoveryAuthorization({ query: 'DeepSeek Harness 文章' });
  reserveDiscoveryAttempt(state, { query: 'DeepSeek Harness 文章' });
  recordDiscoveryResult(state, {
    query: 'DeepSeek Harness 文章',
    candidates: [{
      url: 'https://example.com/article/123456',
      title: 'DeepSeek Harness 工程实践',
      content: 'DeepSeek Harness 的完整工程实践与架构分析正文摘要。',
    }],
  });
  assert.doesNotThrow(() => reserveDiscoveryAttempt(state, {
    query: 'DeepSeek Harness 工程实践',
    allowCandidateRetry: true,
  }));
});

test('does not reserve another discovery attempt while one is running', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'first', category: 'general' });
  assert.throws(
    () => reserveDiscoveryAttempt(state, { query: 'concurrent', category: 'science' }),
    /DISCOVERY_IN_PROGRESS/,
  );
});

test('stores controlled redirects outside discovery evidence and keeps initial authorization exact', () => {
  const requestedUrl = 'https://m.example.com/article/123';
  const resolvedUrl = 'https://www.example.com/article/123?source=redirect';
  const gate = createDiscoveryAuthorization({ directUrls: [requestedUrl] });
  const candidate = authorizePublicSource(gate, requestedUrl);
  const session = newSession({ discoveryGate: gate });
  const before = JSON.parse(JSON.stringify(candidate));

  const first = authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: candidate.candidateId,
    requestedUrl,
    resolvedUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/article/executor-result.json',
  });
  const replay = authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: candidate.candidateId,
    requestedUrl,
    resolvedUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/article/executor-result.json',
  });

  assert.deepEqual(first, replay);
  assert.equal(first.redirectChainObserved, false);
  assert.equal(session.task.acquisitionEvidence.length, 1);
  assert.deepEqual(gate.candidates[0], before);
  assert.equal(
    authorizationModule.authorizeAcceptedAcquisitionEvidence(
      session, candidate.candidateId, resolvedUrl,
    ).candidateId,
    candidate.candidateId,
  );
  assert.throws(() => authorizePublicSource(gate, resolvedUrl), /SOURCE_NOT_AUTHORIZED/);
});

test('runtime redirect evidence rejects cross-candidate binding and is bounded', () => {
  const firstUrl = 'https://example.com/article/1';
  const secondUrl = 'https://example.com/article/2';
  const gate = createDiscoveryAuthorization({ directUrls: [firstUrl, secondUrl] });
  const first = authorizePublicSource(gate, firstUrl);
  const second = authorizePublicSource(gate, secondUrl);
  const session = newSession({ discoveryGate: gate });

  assert.throws(() => authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: first.candidateId,
    requestedUrl: firstUrl,
    resolvedUrl: secondUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/one/executor-result.json',
  }), /ACQUISITION_EVIDENCE_CANDIDATE_CONFLICT/);
  assert.throws(
    () => authorizationModule.authorizeAcceptedAcquisitionEvidence(
      session, second.candidateId, 'https://www.example.com/article/1',
    ),
    /SOURCE_NOT_AUTHORIZED/,
  );

  session.task.acquisitionEvidence = Array.from({ length: 200 }, (_, index) => ({
    schemaVersion: '1.0', candidateId: `existing-${index}`, status: 'accepted',
  }));
  assert.throws(() => authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: first.candidateId,
    requestedUrl: firstUrl,
    resolvedUrl: 'https://www.example.com/article/1',
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/one/executor-result.json',
  }), /ACQUISITION_EVIDENCE_LIMIT_REACHED/);
});

test('multiple controlled artifacts for one redirect retain candidate authorization', () => {
  const requestedUrl = 'https://m.example.com/article/1';
  const resolvedUrl = 'https://www.example.com/article/1';
  const gate = createDiscoveryAuthorization({ directUrls: [requestedUrl] });
  const candidate = authorizePublicSource(gate, requestedUrl);
  const session = newSession({ discoveryGate: gate });
  for (const evidenceArtifact of [
    'raw/bycli/web/one/executor-result.json',
    'raw/bycli/web/one-attempt-2/executor-result.json',
  ]) {
    authorizationModule.registerAcceptedAcquisitionEvidence(session, {
      candidateId: candidate.candidateId,
      requestedUrl,
      resolvedUrl,
      executor: 'bycli',
      evidenceArtifact,
    });
  }

  assert.equal(session.task.acquisitionEvidence.length, 2);
  assert.equal(
    authorizationModule.authorizeAcceptedAcquisitionEvidence(
      session, candidate.candidateId, resolvedUrl,
    ).candidateId,
    candidate.candidateId,
  );
});

test('one runtime resolved URL cannot be accepted for two candidate identities', () => {
  const firstUrl = 'https://m.example.com/article/1';
  const secondUrl = 'https://m.example.com/article/2';
  const resolvedUrl = 'https://www.example.com/article/final';
  const gate = createDiscoveryAuthorization({ directUrls: [firstUrl, secondUrl] });
  const first = authorizePublicSource(gate, firstUrl);
  const second = authorizePublicSource(gate, secondUrl);
  const session = newSession({ discoveryGate: gate });

  authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: first.candidateId,
    requestedUrl: firstUrl,
    resolvedUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/one/executor-result.json',
  });
  assert.throws(() => authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: second.candidateId,
    requestedUrl: secondUrl,
    resolvedUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/two/executor-result.json',
  }), /ACQUISITION_EVIDENCE_CANDIDATE_CONFLICT/);
  assert.equal(session.task.acquisitionEvidence.length, 1);
});

test('runtime evidence rejects a resolved URL shared by two candidate variants', () => {
  const firstUrl = 'https://example.com/article/1';
  const secondUrl = 'https://example.com/article/2';
  const gate = createDiscoveryAuthorization({ directUrls: [firstUrl, secondUrl] });
  const first = authorizePublicSource(gate, firstUrl);
  const second = authorizePublicSource(gate, secondUrl);
  first.acquisitionUrls.push(secondUrl);
  const session = newSession({ discoveryGate: gate });

  assert.throws(() => authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: first.candidateId,
    requestedUrl: firstUrl,
    resolvedUrl: secondUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/one/executor-result.json',
  }), /ACQUISITION_EVIDENCE_CANDIDATE_CONFLICT/);
});

test('runtime redirect reauthorization rejects a corrupted requested identity', () => {
  const requestedUrl = 'https://m.example.com/article/1';
  const resolvedUrl = 'https://www.example.com/article/1';
  const gate = createDiscoveryAuthorization({ directUrls: [requestedUrl] });
  const candidate = authorizePublicSource(gate, requestedUrl);
  const session = newSession({ discoveryGate: gate });
  authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: candidate.candidateId,
    requestedUrl,
    resolvedUrl,
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/one/executor-result.json',
  });
  session.task.acquisitionEvidence[0].requestedUrl = 'https://evil.example.net/article/1';

  assert.throws(
    () => authorizationModule.authorizeAcceptedAcquisitionEvidence(
      session, candidate.candidateId, resolvedUrl,
    ),
    /SOURCE_NOT_AUTHORIZED/,
  );
});

test('runtime redirect authorization errors redact sensitive query values', () => {
  const requestedUrl = 'https://example.com/article/1';
  const gate = createDiscoveryAuthorization({ directUrls: [requestedUrl] });
  const candidate = authorizePublicSource(gate, requestedUrl);
  const session = newSession({ discoveryGate: gate });
  assert.throws(() => authorizationModule.registerAcceptedAcquisitionEvidence(session, {
    candidateId: candidate.candidateId,
    requestedUrl,
    resolvedUrl: 'https://evil.example.net/login?token=super-secret',
    executor: 'bycli',
    evidenceArtifact: 'raw/bycli/web/one/executor-result.json',
  }), (error) => {
    assert.match(error.message, /SOURCE_NOT_AUTHORIZED/);
    assert.equal(error.message.includes('super-secret'), false);
    assert.match(error.message, /REDACTED/);
    return true;
  });
});
