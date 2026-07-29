import { render, screen } from '@testing-library/react';
import { CandidateTable, DraftCard } from './pipelineShared';
import type { PipelineDraft, RankCandidate } from '../types/recorder';

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

describe('DraftCard verify state', () => {
  it('shows a generated draft pending verification as untested', () => {
    const draft: PipelineDraft = {
      id: 'draft_0',
      candidateId: 'cand_search',
      site: 'example_com',
      name: 'search',
      source: 'export default {};',
      score: 99,
      confidence: 'high',
      reason: '',
      risks: [],
      notes: [],
      staticOk: true,
      staticViolations: [],
      verify: { ok: false, rows: 0, fieldCount: 0, reasons: ['pending verification'] },
      usable: false,
    };

    render(<DraftCard draft={draft} source={draft.source} onSourceChange={jest.fn()} />);

    expect(screen.getByText('未测试')).toBeInTheDocument();
    expect(screen.queryByText('Verify 未通过')).not.toBeInTheDocument();
    expect(screen.queryByText('verify 未达标(静态检查或抽取不符),仍可保存,但建议修改后再存')).not.toBeInTheDocument();
  });
});
