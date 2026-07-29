import { render, screen } from '@testing-library/react';
import AnalysisEvidencePanel from './AnalysisEvidencePanel';

describe('AnalysisEvidencePanel', () => {
  it('shows each method-host-path request once while preserving distinct endpoints', () => {
    render(
      <AnalysisEvidencePanel
        defaultOpen
        sampleA={{
          sampleName: 'A',
          entries: [
            {
              requestId: 'list-1',
              method: 'POST',
              host: 'mcs.snssdk.com',
              pathname: '/list',
              url: 'https://mcs.snssdk.com/list',
            },
            {
              requestId: 'list-2',
              method: 'POST',
              host: 'mcs.snssdk.com',
              pathname: '/list',
              url: 'https://mcs.snssdk.com/list',
            },
            {
              requestId: 'list-get',
              method: 'GET',
              host: 'mcs.snssdk.com',
              pathname: '/list',
              url: 'https://mcs.snssdk.com/list',
            },
            {
              requestId: 'other',
              method: 'POST',
              host: 'mcs.snssdk.com',
              pathname: '/other',
              url: 'https://mcs.snssdk.com/other',
            },
          ],
        }}
      />
    );

    expect(screen.getByText((_, element) => element?.textContent === '样本 A · 3 条请求')).toBeInTheDocument();
    expect(screen.getAllByText('mcs.snssdk.com')).toHaveLength(3);
    expect(screen.getAllByText('/list')).toHaveLength(2);
    expect(screen.getByText('/other')).toBeInTheDocument();
  });
});
