import { selectCandidateData } from './candidateSelection';
import type { InitResult, RankCandidate } from '../types/recorder';

const candidateA: RankCandidate = {
  id: 'candidate-a',
  endpoint: { method: 'GET', urlTemplate: 'https://a.test/a', host: 'a.test', pathname: '/a' },
  score: 90,
  confidence: 'high',
  reviewRequired: false,
};
const candidateB: RankCandidate = {
  ...candidateA,
  id: 'candidate-b',
  endpoint: { ...candidateA.endpoint, pathname: '/b' },
};
const preview = { generatedSource: 'export default { from: "a" };' } as InitResult;

describe('selectCandidateData', () => {
  it('clears the draft preview and egress acknowledgement when candidate changes', () => {
    const next = selectCandidateData(
      {
        candidates: [candidateA, candidateB],
        selectedCandidateId: candidateA.id,
        draftPreview: preview,
        llmEgressAck: 1,
      },
      candidateB.id,
      (candidate) => `site/${candidate.id}`
    );

    expect(next).toEqual(
      expect.objectContaining({
        selectedCandidateId: candidateB.id,
        adapterName: 'site/candidate-b',
        draftPreview: undefined,
        llmEgressAck: undefined,
      })
    );
  });

  it('keeps the preview when the same candidate is reselected', () => {
    const next = selectCandidateData(
      { candidates: [candidateA], selectedCandidateId: candidateA.id, draftPreview: preview, llmEgressAck: 1 },
      candidateA.id,
      (candidate) => `site/${candidate.id}`
    );

    expect(next.draftPreview).toBe(preview);
    expect(next.llmEgressAck).toBe(1);
  });
});
