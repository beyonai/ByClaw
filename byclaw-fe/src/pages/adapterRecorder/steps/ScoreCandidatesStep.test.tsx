import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
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

  it('asks for consent before rerunning AI scoring', () => {
    const onRunScore = jest.fn();
    const confirm = jest.spyOn(Modal, 'confirm').mockReturnValue({ destroy: jest.fn(), update: jest.fn() });
    render(
      <ScoreCandidatesStep
        loading={false}
        llmSynthesis
        candidates={[]}
        sentCandidateIds={[]}
        onRunScore={onRunScore}
        onNext={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '使用 AI 重新评分' }));

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ okText: '同意并重新评分' }));
    const options = confirm.mock.calls[0][0] as { onOk: () => void };
    options.onOk();
    expect(onRunScore).toHaveBeenCalledWith(undefined, true);
    confirm.mockRestore();
  });

  it('separates unapplied AI output from applied scoring', () => {
    render(
      <ScoreCandidatesStep
        loading={false}
        llmSynthesis
        candidates={[]}
        sentCandidateIds={[]}
        llmRawJson="not valid json"
        onRunScore={jest.fn()}
        onNext={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /AI 评分结果/ }));

    expect(screen.getByText('已应用的 AI 评分')).toBeInTheDocument();
    expect(screen.getByText('本次模型返回尚未应用到候选，当前仍使用规则评分。')).toBeInTheDocument();
    expect(screen.getByText('原始模型返回（未解析）')).toBeInTheDocument();
  });
});
