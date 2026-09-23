import assert from 'node:assert/strict';
import test from 'node:test';
import { researchEvidenceContext } from './research-evidence.mjs';

const session = { task: { sourceScope: ['public-internet'], followups: ['evaluation', 'architecture', 'evaluation'] },
  research: { branches: [
    { status: 'done', query: 'architecture', researchGoal: 'architecture tradeoffs', followups: ['deployment', 'evaluation'] },
    { status: 'failed', query: 'unverified claim', researchGoal: 'unverified claim', followups: ['secret'] },
    { status: 'done', query: 'history', researchGoal: 'historical context', followups: [] },
  ] } };

test('research evidence uses completed topics and unanswered existing followups only', () => {
  assert.deepEqual(researchEvidenceContext(session, {}), {
    coveredSubtopics: ['architecture tradeoffs', 'historical context'],
    missingSubtopics: ['evaluation', 'deployment'],
  });
});

test('mixed-source research evidence is withheld without enterprise inference opt-in', () => {
  const mixed = { ...session, task: { ...session.task, sourceScope: ['public-internet', 'internal'] } };
  assert.deepEqual(researchEvidenceContext(mixed, {}), { coveredSubtopics: [], missingSubtopics: [] });
  assert.deepEqual(researchEvidenceContext(mixed, { TYPESAFE_ENTERPRISE_ENABLED: 'true' }),
    researchEvidenceContext(session, {}));
});

test('malformed research and long topics are harmless and bounded', () => {
  assert.deepEqual(researchEvidenceContext({ task: { sourceScope: ['public-internet'] }, research: { branches: {} } }),
    { coveredSubtopics: [], missingSubtopics: [] });
  const large = { task: { sourceScope: ['public-internet'], followups: Array.from({ length: 20 }, (_, i) => `topic ${i}`) },
    research: { branches: [{ status: 'done', query: 'covered', researchGoal: 'x'.repeat(300), followups: [null, 1] }] } };
  const result = researchEvidenceContext(large, {});
  assert.equal(result.coveredSubtopics[0].length, 200);
  assert.equal(result.missingSubtopics.length, 12);
});
