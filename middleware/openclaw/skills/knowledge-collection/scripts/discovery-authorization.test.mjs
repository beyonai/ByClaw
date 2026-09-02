import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeArxivAcquisitionVariant,
  authorizePublicSource,
  createDiscoveryAuthorization,
  recordDiscoveryResult,
  reserveDiscoveryAttempt,
} from './discovery-authorization.mjs';

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

test('authorizes article and weak candidates emitted by public discovery without promoting weak', () => {
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

  assert.equal(recorded.articleCandidates.length, 1);
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
    'weak',
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

test('authorizes only topic-matched structural articles for schema 1.1 sessions', () => {
  const state = createDiscoveryAuthorization({ query: '采集一篇关于 DeepSeek 的文章' });
  assert.equal(state.schemaVersion, '1.1');
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

test('a later structural article upgrade is retained even when it remains topic-ineligible', () => {
  const state = createDiscoveryAuthorization({ query: '采集一篇关于 DeepSeek 的文章' });
  reserveDiscoveryAttempt(state, { query: 'DeepSeek paper', category: 'science' });
  recordDiscoveryResult(state, {
    query: 'DeepSeek paper',
    category: 'science',
    candidates: [{
      url: 'https://example.com/reports/entry', title: 'DeepSeek navigation', pageType: 'weak',
    }],
  });
  reserveDiscoveryAttempt(state, { query: 'DeepSeek report', category: 'science' });
  const second = recordDiscoveryResult(state, {
    query: 'DeepSeek report',
    category: 'science',
    candidates: [{
      url: 'https://example.com/reports/entry', title: 'Unrelated report', pageType: 'article',
    }],
  });

  assert.equal(second.articleCandidates.length, 0);
  assert.equal(second.structuralArticleCandidates.length, 1);
  assert.equal(state.candidates[0].pageType, 'article');
  assert.equal(state.candidates[0].topicRelevance.status, 'unmatched');
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

test('does not reserve another discovery attempt while one is running', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'first', category: 'general' });
  assert.throws(
    () => reserveDiscoveryAttempt(state, { query: 'concurrent', category: 'science' }),
    /DISCOVERY_IN_PROGRESS/,
  );
});
