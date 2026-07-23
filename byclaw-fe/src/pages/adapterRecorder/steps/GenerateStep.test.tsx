import { render, screen } from '@testing-library/react';
import GenerateStep from './GenerateStep';
import type { RankCandidate } from '../types/recorder';

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

describe('GenerateStep', () => {
  it('shows the selected endpoint and its expected adapter name before generation', () => {
    render(
      <GenerateStep
        loading={false}
        llmSynthesis={false}
        selectedCandidates={[candidate]}
        onRunGenerate={jest.fn()}
        onBack={jest.fn()}
      />
    );

    expect(screen.getByText('将生成 1 个本地 adapter 草稿')).toBeInTheDocument();
    expect(screen.getByLabelText('GET api.juejin.cn/search_api/v1/search')).toBeInTheDocument();
    expect(screen.getByText(/api_juejin_cn\/search_api_v1_search\.js/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成 1 个 cli 脚本' })).toBeEnabled();
  });

  it('does not render completed score progress as active generation progress', () => {
    render(
      <GenerateStep
        loading={false}
        llmSynthesis={false}
        selectedCandidates={[candidate]}
        pipelineProgress={[{ stage: 'pipeline', status: 'done', durationMs: 0 }]}
        onRunGenerate={jest.fn()}
        onBack={jest.fn()}
      />
    );

    expect(screen.getByText('将生成 1 个本地 adapter 草稿')).toBeInTheDocument();
    expect(screen.queryByText('生成进度')).not.toBeInTheDocument();
  });
});
