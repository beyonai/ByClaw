import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDiscoveryQueryMatches,
  assessCandidateTopic,
  assessMaterializedTopic,
  createTopicContract,
  isEligibleArticle,
} from './topic-relevance.mjs';

test('extracts a stable topic before removing collection orchestration text and paths', () => {
  const contract = createTopicContract(
    '采集一篇关于 DeepSeek 的文章，并保存到 /by/.sessions/200/00-collection/',
  );
  assert.equal(contract.required, true);
  assert.equal(contract.normalizedSubject, 'deepseek');
  assert.deepEqual(contract.strongAnchors, ['deepseek']);
  assert.deepEqual(contract.supportingAnchors, []);
  assert.equal(contract.source, 'task-query');
});

test('does not strip words that belong to the extracted Chinese subject', () => {
  const contract = createTopicContract('采集一篇关于文章推荐算法的文章');
  assert.equal(contract.required, true);
  assert.equal(contract.normalizedSubject, '文章推荐算法');
  assert.deepEqual(contract.strongAnchors, ['文章推荐算法']);
});

test('extracts a Chinese brand before a trailing cloud-delivery clause', () => {
  const contract = createTopicContract('采集一篇关于 米哈游 的文章并保存到云盘中');
  assert.equal(contract.required, true);
  assert.equal(contract.normalizedSubject, '米哈游');
  assert.deepEqual(contract.strongAnchors, ['米哈游']);
  assert.deepEqual(contract.supportingAnchors, []);
  assert.doesNotThrow(() => assertDiscoveryQueryMatches(
    contract,
    '米哈游 报道 访谈 公众号',
  ));
});

test('marks generic and multi-topic collection requests as not required', () => {
  const generic = createTopicContract('采集一篇文章并保存到 00-collection');
  assert.equal(generic.required, false);
  assert.equal(generic.notAppliedReason, 'no-specific-topic');

  const multi = createTopicContract('采集 DeepSeek 和 Qwen 各一篇文章');
  assert.equal(multi.required, false);
  assert.equal(multi.notAppliedReason, 'unsupported-multi-topic');
});

test('candidate relevance is independent from structural article classification', () => {
  const contract = createTopicContract('采集一篇关于 DeepSeek 的文章');
  const irrelevant = {
    pageType: 'article',
    url: 'https://arxiv.org/abs/2103.05770v1',
    title: 'Notebook articles: towards a transformative publishing experience',
  };
  const assessed = assessCandidateTopic(contract, irrelevant);
  assert.equal(assessed.status, 'unmatched');
  assert.match(assessed.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(isEligibleArticle({ ...irrelevant, topicRelevance: assessed }), false);

  const relevant = {
    pageType: 'article',
    url: 'https://arxiv.org/abs/2501.12948',
    title: 'DeepSeek-R1: Incentivizing Reasoning Capability in LLMs',
  };
  const relevantAssessment = assessCandidateTopic(contract, relevant);
  assert.equal(relevantAssessment.status, 'matched');
  assert.deepEqual(relevantAssessment.evidenceFields, ['title']);
  assert.equal(isEligibleArticle({ ...relevant, topicRelevance: relevantAssessment }), true);
});

test('Latin anchors use token boundaries instead of substring matching', () => {
  const contract = createTopicContract('collect an article about AI');
  assert.equal(assessCandidateTopic(contract, {
    url: 'https://example.com/news/said',
    title: 'The witness said nothing',
  }).status, 'unmatched');
  assert.equal(assessCandidateTopic(contract, {
    url: 'https://example.com/news/ai',
    title: 'AI changes software development',
  }).status, 'matched');
});

test('query drift is rejected without changing the immutable topic contract', () => {
  const contract = createTopicContract('采集一篇关于 DeepSeek 的文章');
  assert.doesNotThrow(() => assertDiscoveryQueryMatches(contract, 'DeepSeek-R1 paper'));
  assert.throws(
    () => assertDiscoveryQueryMatches(contract, 'Qwen paper'),
    /DISCOVERY_QUERY_DRIFT/,
  );
  assert.deepEqual(contract.strongAnchors, ['deepseek']);
});

test('materialized relevance ignores metadata and requires repeated body evidence', () => {
  const contract = createTopicContract('采集一篇关于 DeepSeek 的文章');
  const isolated = assessMaterializedTopic(contract, {
    title: 'Unrelated paper',
    markdown: [
      '---',
      'source: https://example.com/deepseek',
      'cover: ./deepseek-images/cover.jpg',
      '---',
      '',
      'This unrelated article mentions DeepSeek once.',
      '',
      'No further discussion follows.',
    ].join('\n'),
  });
  assert.equal(isolated.status, 'unmatched');

  const repeated = assessMaterializedTopic(contract, {
    title: 'Reasoning model report',
    markdown: [
      'DeepSeek introduces a reinforcement-learning approach.',
      '',
      'Benchmarks show how DeepSeek-R1 performs on reasoning tasks.',
    ].join('\n'),
  });
  assert.equal(repeated.status, 'matched');
  assert.deepEqual(repeated.evidenceFields, ['body']);
  assert.match(repeated.inputDigest, /^[a-f0-9]{64}$/);
});

test('not-required contracts preserve direct and unthemed workflows', () => {
  const contract = createTopicContract('采集一篇文章');
  assert.equal(assessCandidateTopic(contract, {}).status, 'not-required');
  assert.equal(assessMaterializedTopic(contract, { title: '', markdown: '' }).status, 'not-required');
  assert.equal(isEligibleArticle({
    pageType: 'article',
    topicRelevance: { status: 'not-required' },
  }), true);
});

test('a truncated materialized body with no match is unknown instead of conclusively unrelated', () => {
  const contract = createTopicContract('采集一篇关于 DeepSeek 的文章');
  const assessment = assessMaterializedTopic(contract, {
    title: 'Unrelated report',
    markdown: `# Report\n\n${'unrelated text '.repeat(50_000)}`,
  });
  assert.equal(assessment.status, 'unknown');
  assert.equal(assessment.reason, 'visible-text-limit-exceeded');
});
