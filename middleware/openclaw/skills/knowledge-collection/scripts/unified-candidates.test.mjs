import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeUnifiedCandidates, scoreUnifiedCandidate } from './unified-candidates.mjs';

test('unified scoring favors title matches and materializable full text', () => {
  const title = scoreUnifiedCandidate({ title: '巡检流程', snippet: '相关内容' }, '巡检流程');
  const weak = scoreUnifiedCandidate({ title: '其他文档', snippet: '巡检流程' }, '巡检流程');
  const full = scoreUnifiedCandidate({ title: '巡检流程', materializable: true, contentGranularity: 'full-text' }, '巡检流程');
  assert.ok(title > weak);
  assert.ok(full > title);
});

test('unified merge preserves both sources and removes only same-source duplicates', () => {
  const merged = mergeUnifiedCandidates('巡检', {
    publicCandidates: [
      { url: 'https://example.test/a', title: '巡检流程', content: '巡检' },
      { url: 'https://example.test/a', title: '巡检流程', content: '巡检' },
    ],
    cloudCandidates: [{
      itemId: 'cloud-a', title: '巡检流程', sourceUrl: 'cloud-knowledge://1/docs/a.md',
      resourceId: 1, filePath: '/docs/a.md', fileType: 'md', fileSize: 10,
      fileSignature: 'a'.repeat(64), materialization: { contentGranularity: 'full-text' },
    }],
  });
  assert.equal(merged.length, 2);
  assert.deepEqual(new Set(merged.map((item) => item.source)), new Set(['public-internet', 'cloud-knowledge']));
});
