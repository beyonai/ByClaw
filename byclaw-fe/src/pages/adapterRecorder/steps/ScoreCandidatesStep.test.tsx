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
  it('automatically starts AI scoring with consent when LLM synthesis is enabled', () => {
    const onRunScore = jest.fn();
    render(
      <ScoreCandidatesStep loading={false} llmSynthesis candidates={[]} onRunScore={onRunScore} onNext={jest.fn()} />
    );

    expect(onRunScore).toHaveBeenCalledTimes(1);
    expect(onRunScore).toHaveBeenCalledWith(undefined, true);
  });

  it('does not automatically score after the score stage completes with no selected candidates', () => {
    const onRunScore = jest.fn();
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

    expect(onRunScore).not.toHaveBeenCalled();
  });

  it('does not automatically score while loading', () => {
    const onRunScore = jest.fn();
    render(<ScoreCandidatesStep loading llmSynthesis candidates={[]} onRunScore={onRunScore} onNext={jest.fn()} />);

    expect(onRunScore).not.toHaveBeenCalled();
  });

  it('automatically starts AI scoring after loading completes', () => {
    const onRunScore = jest.fn();
    const { rerender } = render(
      <ScoreCandidatesStep loading llmSynthesis candidates={[]} onRunScore={onRunScore} onNext={jest.fn()} />
    );

    rerender(
      <ScoreCandidatesStep loading={false} llmSynthesis candidates={[]} onRunScore={onRunScore} onNext={jest.fn()} />
    );

    expect(onRunScore).toHaveBeenCalledTimes(1);
    expect(onRunScore).toHaveBeenCalledWith(undefined, true);
  });

  it('automatically starts local scoring without egress consent', () => {
    const onRunScore = jest.fn();
    render(
      <ScoreCandidatesStep
        loading={false}
        llmSynthesis={false}
        candidates={[]}
        onRunScore={onRunScore}
        onNext={jest.fn()}
      />
    );

    expect(onRunScore).toHaveBeenCalledTimes(1);
    expect(onRunScore).toHaveBeenCalledWith(undefined, false);
  });

  it('explains the limited data sent to the LLM', () => {
    render(
      <ScoreCandidatesStep loading={false} llmSynthesis candidates={[]} onRunScore={jest.fn()} onNext={jest.fn()} />
    );

    expect(
      screen.getByText(
        '仅将候选接口的 method、host、path 与本地评分发送给默认 LLM 做语义评分；不会发送 Cookie、请求体或可执行脚本。脚本仍由本地确定性模板生成。'
      )
    ).toBeInTheDocument();
  });

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
    expect(screen.getByText('模型最终返回')).toBeInTheDocument();
  });

  it('shows only final model content when the provider embeds thinking tags', () => {
    render(
      <ScoreCandidatesStep
        loading={false}
        llmSynthesis
        candidates={[]}
        sentCandidateIds={[]}
        llmRawJson={'<think>private reasoning</think>\n{"candidates":[]}'}
        onRunScore={jest.fn()}
        onNext={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /AI 评分结果/ }));
    fireEvent.click(screen.getByRole('button', { name: /模型最终返回/ }));

    expect(screen.getByDisplayValue('{"candidates":[]}')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/private reasoning/)).not.toBeInTheDocument();
  });
});
