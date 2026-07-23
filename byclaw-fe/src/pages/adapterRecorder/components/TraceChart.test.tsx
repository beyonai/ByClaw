import { render } from '@testing-library/react';
import TraceChart from './TraceChart';

describe('TraceChart', () => {
  it('renders repeated endpoints without duplicate React keys', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <TraceChart
        entries={[
          { requestId: 'request-a', method: 'POST', pathname: '/vc/setting', url: 'https://example.com/vc/setting' },
          { requestId: 'request-b', method: 'POST', pathname: '/vc/setting', url: 'https://example.com/vc/setting' },
        ]}
      />
    );

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
