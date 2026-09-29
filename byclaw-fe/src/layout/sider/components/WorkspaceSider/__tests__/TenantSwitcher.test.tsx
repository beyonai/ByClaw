import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TenantSwitcher from '../TenantSwitcher';
import { getAvailableTenants, validateTenantSwitch } from '@/service/tenantContext';
import webSocketManager from '@/utils/websocket';

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
}));

describe('TenantSwitcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAvailableTenants as jest.Mock).mockResolvedValue([
      { enterpriseId: '123', enterpriseName: '测试租户', role: 'OWNER', provisionState: 'READY' },
    ]);
    (validateTenantSwitch as jest.Mock).mockResolvedValue({ enterpriseId: '123', role: 'OWNER' });
    (webSocketManager.switchTenant as jest.Mock).mockResolvedValue(undefined);
  });

  it('loads available tenants and switches HTTP and WebSocket context without reconnecting', async () => {
    render(<TenantSwitcher />);

    await waitFor(() => expect(getAvailableTenants).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'tenantSwitcher.open' }));
    fireEvent.click(await screen.findByText('测试租户'));

    await waitFor(() => {
      expect(validateTenantSwitch).toHaveBeenCalledWith('123');
      expect(webSocketManager.switchTenant).toHaveBeenCalledWith('123');
    });
  });
});
