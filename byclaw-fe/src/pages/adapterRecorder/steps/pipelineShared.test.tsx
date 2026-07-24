import { render, screen } from '@testing-library/react';
import { CandidateTable } from './pipelineShared';
import type { RankCandidate } from '../types/recorder';

const candidate = (overrides: Partial<RankCandidate> = {}): RankCandidate => ({
  id: 'cand_search',
  endpoint: { method: 'GET', pathname: '/search' },
  score: 99,
  confidence: 'high',
  reviewRequired: false,
  ...overrides,
});

describe('CandidateTable score columns', () => {
  it('shows the LLM utility column only for successfully applied LLM scores', () => {
    const { rerender } = render(<CandidateTable candidates={[candidate({ llmUtilityScore: 95 })]} selectedIds={[]} />);

    expect(screen.queryByRole('columnheader', { name: 'LLM 效用' })).not.toBeInTheDocument();

    rerender(<CandidateTable candidates={[candidate({ llmUtilityScore: 95, scoredBy: 'llm' })]} selectedIds={[]} />);

    expect(screen.getByRole('columnheader', { name: 'Rank 置信' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'LLM 效用' })).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });
});
