import { render, screen } from '@testing-library/react';

import VncFrame from './VncFrame';

jest.mock('antd', () => ({
  Empty: () => null,
  theme: {
    useToken: () => ({ token: { colorBorderSecondary: '#eee', colorFillQuaternary: '#f5f5f5', borderRadius: 4 } }),
  },
}));

describe('VncFrame', () => {
  it('preserves the sandbox token while normalizing a relative VNC endpoint', () => {
    render(<VncFrame vncUrl="/v1/sandboxes/sandbox-1/proxy/8081?token=sandbox-token" />);

    expect(screen.getByTitle('vnc-recording')).toHaveAttribute(
      'src',
      'http://localhost/v1/sandboxes/sandbox-1/proxy/8081/?token=sandbox-token&autoconnect=true&resize=scale&reconnect=true'
    );
  });
});
