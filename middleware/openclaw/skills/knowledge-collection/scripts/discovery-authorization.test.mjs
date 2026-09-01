import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizePublicSource,
  createDiscoveryAuthorization,
  recordDiscoveryResult,
  reserveDiscoveryAttempt,
} from './discovery-authorization.mjs';

test('authorizes only article candidates emitted by public discovery', () => {
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
  assert.throws(
    () => authorizePublicSource(state, 'https://www.nature.com/articles/example'),
    /SOURCE_NOT_AUTHORIZED_BY_DISCOVERY.*pageType=weak/,
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
});

test('discovery authorization rejects a third public discovery attempt', () => {
  const state = createDiscoveryAuthorization();
  reserveDiscoveryAttempt(state, { query: 'first', category: 'general' });
  recordDiscoveryResult(state, { query: 'first', category: 'general', candidates: [] });
  reserveDiscoveryAttempt(state, { query: 'second', category: 'science' });
  recordDiscoveryResult(state, { query: 'second', category: 'science', candidates: [] });

  assert.equal(state.exhausted, true);
  assert.equal(state.stopReason, 'no-article-candidates');
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
