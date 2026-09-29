jest.mock('@umijs/max', () => ({ getDvaApp: jest.fn() }));

import { reloadChatForSpaceSwitch } from '../tenantContext';

describe('reloadChatForSpaceSwitch', () => {
  it('keeps the configured public path when switching spaces', () => {
    window.publicPath = '/beyond/';
    Object.defineProperty(window, 'location', {
      value: { assign: jest.fn() },
      writable: true,
      configurable: true,
    });

    reloadChatForSpaceSwitch();

    expect(window.location.assign).toHaveBeenCalledWith('/beyond/chat');
  });
});
