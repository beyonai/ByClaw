import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TenantSwitcher from '../TenantSwitcher';
import { getAvailableTenants, validateTenantSwitch } from '@/service/tenantContext';
import webSocketManager from '@/utils/websocket';
import { reloadChatForSpaceSwitch } from '@/utils/tenantContext';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/service/tenantContext', () => ({
  getAvailableTenants: jest.fn(),
  validateTenantSwitch: jest.fn(),
}));

jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: { switchTenant: jest.fn() },
}));

jest.mock('@/utils/tenantContext', () => ({
  getSelectedEnterpriseId: () => null,
  getTenantContext: () => null,
  hasStoredTenantSelection: () => false,
  clearSelectedEnterprise: jest.fn(),
  selectEnterprise: jest.fn(),
  reloadChatForSpaceSwitch: jest.fn(),
}));

describe('TenantSwitcher', () => {
  beforeEach(() => {
    setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
    jest.clearAllMocks();
    (getAvailableTenants as jest.Mock).mockResolvedValue([
      { enterpriseId: '123', enterpriseName: '测试租户', role: 'OWNER', provisionState: 'READY' },
    ]);
    (validateTenantSwitch as jest.Mock).mockResolvedValue({
      enterpriseId: '123',
      role: 'OWNER',
      tenantContextToken: 'context-token',
      expiresAt: '2099-01-01T00:00:00Z',
      contextVersion: 1,
    });
    (webSocketManager.switchTenant as jest.Mock).mockResolvedValue(undefined);
  });

  it('hides the tenant entry and does not load tenants when the config is missing', () => {
    setMultiTenancyConfig(null);
    render(<TenantSwitcher />);
    expect(screen.queryByRole('button', { name: 'tenantSwitcher.open' })).not.toBeInTheDocument();
    expect(getAvailableTenants).not.toHaveBeenCalled();
  });

  it('loads available tenants and switches HTTP and WebSocket context without reconnecting', async () => {
    render(<TenantSwitcher />);

    await waitFor(() => expect(getAvailableTenants).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'tenantSwitcher.open' }));
    fireEvent.click(await screen.findByText('测试租户'));

    await waitFor(() => {
      expect(validateTenantSwitch).toHaveBeenCalledWith('123');
      expect(webSocketManager.switchTenant).toHaveBeenCalledWith('123', 'context-token', '2099-01-01T00:00:00Z');
      expect(reloadChatForSpaceSwitch).toHaveBeenCalled();
    });
  });
});
