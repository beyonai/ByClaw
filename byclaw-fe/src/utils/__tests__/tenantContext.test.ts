import { setMultiTenancyConfig } from '@/utils/multiTenancy';
jest.mock('@umijs/max', () => ({ getDvaApp: jest.fn() }));

import {
  clearSelectedEnterprise,
  getTenantContext,
  getTenantSwitchSeq,
  reloadChatForSpaceSwitch,
  selectEnterprise,
} from '../tenantContext';

describe('tenant context renewal', () => {
  beforeEach(() => {
    setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
    clearSelectedEnterprise();
    window.localStorage.setItem('SESSION', 'session');
  });

  it('keeps in-flight chat responses valid when renewing the same tenant', () => {
    selectEnterprise('123', 'first-token', '2099-01-01T00:00:00Z');
    const sequence = getTenantSwitchSeq();
    selectEnterprise('123', 'renewed-token', '2099-02-01T00:00:00Z');
    expect(getTenantSwitchSeq()).toBe(sequence);
    expect(getTenantContext()?.tenantContextToken).toBe('renewed-token');
    selectEnterprise('456', 'other-token', '2099-02-01T00:00:00Z');
    expect(getTenantSwitchSeq()).toBe(sequence + 1);
  });
});

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
