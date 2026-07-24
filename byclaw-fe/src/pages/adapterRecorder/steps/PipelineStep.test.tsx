import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { RankCandidate } from '../types/recorder';
import PipelineStep from './PipelineStep';

const candidate: RankCandidate = {
  id: 'cand_juejin_search',
  endpoint: {
    method: 'GET',
    host: 'api.juejin.cn',
    pathname: '/search_api/v1/search',
    urlTemplate: 'https://api.juejin.cn/search_api/v1/search',
  },
  score: 99,
  confidence: 'high',
  reviewRequired: false,
};

jest.mock('./ScoreCandidatesStep', () => ({ onSelectionChange, onNext }: any) => (
  <>
    <button type="button" onClick={() => onSelectionChange(['cand_juejin_search'])}>
      选择候选
    </button>
    <button type="button" onClick={onNext}>
      下一步
    </button>
  </>
));

jest.mock('./GenerateStep', () => ({ selectedCandidates, onRunGenerate }: any) => (
  <>
    <div data-testid="selected-candidate-ids">
      {selectedCandidates.map((candidate: RankCandidate) => candidate.id).join(',')}
    </div>
    <button type="button" onClick={onRunGenerate}>
      生成
    </button>
  </>
));

function Harness({ onRunGenerate }: { onRunGenerate: (ids?: string[]) => void }) {
  const [subStep, setSubStep] = useState<'candidates' | 'generate'>('candidates');
  return (
    <PipelineStep
      loading={false}
      llmSynthesis={false}
      subStep={subStep}
      candidates={[candidate]}
      onRunScore={jest.fn()}
      onGoToGenerate={() => setSubStep('generate')}
      onGoToCandidates={() => setSubStep('candidates')}
      onRunGenerate={onRunGenerate}
      onVerifyDraft={jest.fn()}
      onSaveDraft={jest.fn()}
    />
  );
}

test('keeps selected candidate IDs when switching to generation and forwards them to generation', () => {
  const onRunGenerate = jest.fn();
  render(<Harness onRunGenerate={onRunGenerate} />);

  fireEvent.click(screen.getByRole('button', { name: '选择候选' }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));

  expect(screen.getByTestId('selected-candidate-ids')).toHaveTextContent('cand_juejin_search');
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  expect(onRunGenerate).toHaveBeenCalledWith(['cand_juejin_search']);
});
