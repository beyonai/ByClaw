import { fireEvent, render, screen } from '@testing-library/react';
import InitStep from './InitStep';
import type { InitResult, RankCandidate } from '../types/recorder';

const candidate: RankCandidate = {
  id: 'cand_example_search',
  endpoint: {
    method: 'GET',
    urlTemplate: 'https://example.com/search?q={q}',
    host: 'example.com',
    pathname: '/search',
  },
  score: 99,
  confidence: 'high',
  reviewRequired: false,
};

const preview: InitResult = {
  report: {
    adapterPath: '/by/.bycli/clis/example/search.js',
    reportPath: '/by/.bycli/sites/example/recorder/search-report.json',
    responsibleUseAcknowledgedAt: 0,
    releaseChannel: 'stub',
    localExperimentProfile: 'be-0',
    configSnapshotVersion: 1,
  },
  dryRun: { exists: false, changedLines: 3 },
  generatedSource: "export default { request: { path: '/search' } };",
};

describe('InitStep', () => {
  it('returns to the candidate page without previewing or writing', () => {
    const onBack = jest.fn();
    const onPreview = jest.fn();
    const onWrite = jest.fn();

    render(
      <InitStep
        loading={false}
        selectedCandidate={candidate}
        adapterName="example/search"
        preview={preview}
        onBack={onBack}
        onPreview={onPreview}
        onWrite={onWrite}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /返回候选/ }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('uses two columns for paths and full rows for the remaining draft metadata', () => {
    const { container } = render(
      <InitStep
        loading={false}
        selectedCandidate={candidate}
        adapterName="example/search"
        preview={preview}
        onBack={jest.fn()}
        onPreview={jest.fn()}
        onWrite={jest.fn()}
      />
    );

    expect(container.querySelectorAll('.ant-descriptions-row').length).toBe(3);
    expect(screen.getByText('Adapter 路径')).toBeVisible();
    expect(screen.getByText('报告路径')).toBeVisible();
  });
});
