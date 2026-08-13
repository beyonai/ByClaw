import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/service/connector', () => ({
  createUserMcpService: jest.fn(),
  deleteUserMcpService: jest.fn(),
  queryUserMcpServices: jest.fn(),
  startConnectorAuthorization: jest.fn(),
  updateUserMcpService: jest.fn(),
  updateUserMcpServiceEnabled: jest.fn(),
  validateUserMcpService: jest.fn(),
}));

import { queryUserMcpServices, updateUserMcpServiceEnabled, type UserMcpService } from '@/service/connector';
import UserMcpManager from '../index';

const mockQueryUserMcpServices = queryUserMcpServices as jest.MockedFunction<typeof queryUserMcpServices>;
const mockUpdateUserMcpServiceEnabled = updateUserMcpServiceEnabled as jest.MockedFunction<
  typeof updateUserMcpServiceEnabled
>;

const service = (resourceId: number, resourceName: string, enableFlag: 'Y' | 'N'): UserMcpService => ({
  resourceId,
  resourceCode: `mcp-${resourceId}`,
  resourceName,
  sourceContent: JSON.stringify({
    domainURL: 'https://8.8.8.8',
    metaContent: { mcpType: 'streamable-http', mcpServerUrl: '/mcp', authProfile: { mode: 'NONE' } },
  }),
  definitionRevision: 1,
  endpointFingerprint: `fp-${resourceId}`,
  tools: [],
  enableFlag,
  connected: enableFlag === 'Y',
  credentialState: 'READY',
});

describe('UserMcpManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryUserMcpServices.mockResolvedValue([service(11, 'MCP A', 'Y'), service(22, 'MCP B', 'N')]);
    mockUpdateUserMcpServiceEnabled.mockResolvedValue(true);
  });

  it('lists multiple services and disables only the selected instance', async () => {
    render(<UserMcpManager active connectorId={9} />);

    expect(await screen.findByText('MCP A')).toBeInTheDocument();
    expect(screen.getByText('MCP B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: '停用MCP A' }));

    await waitFor(() => expect(mockUpdateUserMcpServiceEnabled).toHaveBeenCalledWith(11, false));
    expect(mockUpdateUserMcpServiceEnabled).not.toHaveBeenCalledWith(22, expect.anything());
  });

  it('does not load instances while the connector drawer is closed', () => {
    render(<UserMcpManager active={false} connectorId={9} />);

    expect(mockQueryUserMcpServices).not.toHaveBeenCalled();
  });
});
