import { render, screen } from '@testing-library/react';
import Workbench from './index';

jest.mock('@umijs/max', () => ({ useSelector: () => null }));
jest.mock('./models/useRecorderSession', () => () => ({
  state: 'ranked',
  data: {
    health: { llmSynthesis: false },
    candidates: [],
    pipelineSubStep: 'candidates',
  },
  loading: false,
  error: null,
  actions: {},
}));
jest.mock('./components/StepRail', () => () => <div />);
jest.mock('./components/UserIdentityBar', () => () => null);
jest.mock('./steps/RankStep', () => () => <div data-testid="single-select-rank-step" />);
jest.mock('./steps/InitStep', () => () => <div data-testid="single-select-init-step" />);
jest.mock('./steps/PipelineStep', () => ({ llmSynthesis }: { llmSynthesis: boolean }) => (
  <div data-testid="pipeline-step">{llmSynthesis ? 'llm' : 'local'}</div>
));

test('uses the multi-select pipeline when LLM synthesis is disabled', () => {
  render(<Workbench />);

  expect(screen.getByTestId('pipeline-step')).toHaveTextContent('local');
  expect(screen.queryByTestId('single-select-rank-step')).not.toBeInTheDocument();
  expect(screen.queryByTestId('single-select-init-step')).not.toBeInTheDocument();
});
