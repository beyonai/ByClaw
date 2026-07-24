import { render, screen } from '@testing-library/react';
import ScoreCandidatesStep from './ScoreCandidatesStep';

jest.mock('../components/AnalysisEvidencePanel', () => ({ scorePrompt }: { scorePrompt?: string }) => (
  <div data-testid="analysis-evidence-panel">{scorePrompt}</div>
));

jest.mock('./pipelineShared', () => ({
  CandidateTable: () => <div />,
}));

describe('ScoreCandidatesStep AI prompt', () => {
  it('does not render the AI prompt panel before score completes', () => {
    render(
      <ScoreCandidatesStep loading={false} llmSynthesis candidates={[]} onRunScore={jest.fn()} onNext={jest.fn()} />
    );

    expect(screen.queryByTestId('analysis-evidence-panel')).not.toBeInTheDocument();
  });

  it('renders the score-stage prompt after AI scoring completes', () => {
    render(
      <ScoreCandidatesStep
        loading={false}
        llmSynthesis
        candidates={[]}
        sentCandidateIds={[]}
        prompts={{ score: 'actual score prompt', generate: 'generate prompt', screenshotCount: 0 }}
        onRunScore={jest.fn()}
        onNext={jest.fn()}
      />
    );

    expect(screen.getByTestId('analysis-evidence-panel')).toHaveTextContent('actual score prompt');
  });
});
