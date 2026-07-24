import type { InitResult, RankCandidate } from '../types/recorder';

interface CandidateSelectionData {
  candidates?: RankCandidate[];
  selectedCandidateId?: string;
  adapterName?: string;
  draftPreview?: InitResult;
  llmEgressAck?: number;
}

export function selectCandidateData<T extends CandidateSelectionData>(
  data: T,
  id: string,
  deriveName: (candidate: RankCandidate) => string
): T {
  const candidate = data.candidates?.find((item) => item.id === id);
  const changed = id !== data.selectedCandidateId;
  return {
    ...data,
    selectedCandidateId: id,
    adapterName: candidate ? deriveName(candidate) : data.adapterName,
    ...(changed ? { draftPreview: undefined, llmEgressAck: undefined } : {}),
  };
}
