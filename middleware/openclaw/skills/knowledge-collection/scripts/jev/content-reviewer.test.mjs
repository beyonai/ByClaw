import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewAmbiguousContent } from './content-reviewer.mjs';
import { analyzeWebMarkdown } from '../web-content-analysis.mjs';
import { createTopicContract, assessMaterializedTopic } from '../topic-relevance.mjs';

const markdown = '# DeepSeek Harness\n\n' + Array.from({ length: 5 }, (_, index) =>
  `DeepSeek Harness article paragraph ${index} describes implementation and verification in detail.`).join('\n\n');
const contract = createTopicContract('DeepSeek Harness');
const inputFor = (body, title = '') => ({ request: 'DeepSeek Harness', markdown: body, title, contract,
  analysis: analyzeWebMarkdown(body, { title }), topic: assessMaterializedTopic(contract, { markdown: body, title }) });
const confident = async () => ({ ok: true, document: { model: 'test',
  answers: { evidence: { type: 'choice', choice: 'e0', confidence: 0.95 } } } });

test('recovers only an existing title and reruns structural and topical validation', async () => {
  const result = await reviewAmbiguousContent(inputFor(markdown), { callJev: confident });
  assert.equal(result.diagnostic.status, 'used');
  assert.equal(result.analysis.title, 'DeepSeek Harness');
  assert.equal(result.analysis.confidence, 'high');
  assert.equal(result.topic.status, 'matched');
});

test('challenge, short body, incomplete paper and explicit topic rejection cannot be overridden', async () => {
  const short = inputFor('# DeepSeek Harness\n\nshort');
  const challenge = inputFor(`${markdown}\n\ncaptcha`, 'DeepSeek Harness');
  const incompletePaper = inputFor(markdown, 'DeepSeek Harness');
  incompletePaper.analysis.confidence = 'low';
  incompletePaper.analysis.reasonCodes = ['incomplete-arxiv-structure'];
  const mismatch = inputFor(markdown, 'DeepSeek Harness');
  mismatch.topic = { status: 'unmatched' };
  for (const input of [short, challenge, incompletePaper, mismatch]) {
    const result = await reviewAmbiguousContent(input, { callJev: () => { throw new Error('hard gate must skip inference'); } });
    assert.equal(result.diagnostic.status, 'skipped');
    assert.equal(result.analysis, input.analysis);
    assert.equal(result.topic, input.topic);
  }
});

test('unknown topic uses actual bounded excerpts and cannot accept an invented choice', async () => {
  const input = inputFor(markdown, 'System architecture');
  input.topic = { status: 'unknown' };
  const result = await reviewAmbiguousContent(input, { callJev: async (payload) => {
    assert.ok(Object.values(payload.state.evidence).every((value) => value.length <= 2000 && markdown.includes(value)));
    return confident();
  } });
  assert.equal(result.topic.status, 'matched');
  const invalid = await reviewAmbiguousContent(input, { callJev: async () => ({ ok: true, document: {
    answers: { evidence: { type: 'choice', choice: 'e999', confidence: 1 } },
  } }) });
  assert.equal(invalid.topic, input.topic);
});

test('low confidence and provider failure preserve the original rejection', async () => {
  const input = inputFor(markdown);
  for (const response of [{ ok: false, diagnostic: { code: 'TIMEOUT' } },
    { ok: true, document: { answers: { evidence: { type: 'choice', choice: 'e0', confidence: 0.5 } } } }]) {
    const result = await reviewAmbiguousContent(input, { callJev: async () => response });
    assert.equal(result.analysis, input.analysis);
    assert.equal(result.diagnostic.status, 'fallback');
  }
});
