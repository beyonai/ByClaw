import { render, screen } from '@testing-library/react';
import TraceChart from './TraceChart';

describe('TraceChart', () => {
  it('groups repeated endpoints by A/B sample and marks the selected candidate', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <TraceChart
        sampleA={{
          sampleName: 'A',
          entries: [
            {
              requestId: 'request-a1',
              method: 'GET',
              pathname: '/search',
              url: 'https://example.com/search',
              timing: { durationMs: 100 },
            },
            {
              requestId: 'request-a2',
              method: 'GET',
              pathname: '/search',
              url: 'https://example.com/search',
              timing: { durationMs: 300 },
            },
          ],
        }}
        sampleB={{
          sampleName: 'B',
          entries: [
            {
              requestId: 'request-b1',
              method: 'GET',
              pathname: '/search',
              url: 'https://example.com/search',
              timing: { durationMs: 200 },
            },
          ],
        }}
        candidates={[
          {
            id: 'candidate-search',
            endpoint: {
              method: 'GET',
              host: 'example.com',
              pathname: '/search',
              urlTemplate: 'https://example.com/search',
            },
            score: 99,
            confidence: 'high',
            reviewRequired: false,
          },
        ]}
        selectedId="candidate-search"
      />
    );

    expect(screen.getAllByText('GET /search')).toHaveLength(1);
    expect(screen.getByText('A 2 次 · 200 ms')).toBeInTheDocument();
    expect(screen.getByText('B 1 次 · 200 ms')).toBeInTheDocument();
    expect(screen.getByText('候选')).toBeInTheDocument();
    expect(screen.getByText('已选定')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
