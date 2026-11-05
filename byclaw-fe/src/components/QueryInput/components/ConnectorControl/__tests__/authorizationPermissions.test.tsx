import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useIntl } from '@umijs/max';
import { Modal, message } from 'antd';
import {
  getConnectorAuthorization,
  queryAllConnectors,
  startConnectorAuthorization,
  type ConnectorAuthorization,
  type ConnectorListItem,
} from '@/service/connector';
import zhCN from '@/locales/zh-CN';
import ConnectorControl from '..';

jest.mock('@umijs/max', () => ({
  useIntl: jest.fn(),
  useSelector: () => undefined,
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('../GlobalAccountSection', () => () => null);
jest.mock('@/service/connector', () => ({
  getConnectorAuthorization: jest.fn(),
  queryAllConnectors: jest.fn(),
  startConnectorAuthorization: jest.fn(),
}));

const mockQueryAllConnectors = queryAllConnectors as jest.MockedFunction<typeof queryAllConnectors>;
const mockStartAuthorization = startConnectorAuthorization as jest.MockedFunction<typeof startConnectorAuthorization>;
const mockGetAuthorization = getConnectorAuthorization as jest.MockedFunction<typeof getConnectorAuthorization>;
const messages: Record<string, string> = zhCN;
const connector: ConnectorListItem = {
  connectorId: 3,
  connectorCode: 'lark',
  connectorName: '飞书',
  connectorType: 'SYSTEM',
  description: '',
  enableFlag: 'Y',
};
const missingScopes = ['contact:contact:readonly', 'contact:user.employee_id:readonly'];

const authorize = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '连接' }));
  fireEvent.click(await screen.findByRole('button', { name: '立即前往授权' }));
};

describe('connector authorization permission summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useIntl as jest.Mock).mockReturnValue({
      formatMessage: ({ id }: { id: string }, values: Record<string, string | number> = {}) =>
        (messages[id] || id).replace(/\{(\w+)\}/g, (_, key) => `${values[key] ?? `{${key}}`}`),
    });
    jest.spyOn(message, 'warning').mockImplementation(jest.fn());
    jest.spyOn(message, 'info').mockImplementation(jest.fn());
    jest.spyOn(message, 'success').mockImplementation(jest.fn());
    jest.spyOn(message, 'error').mockImplementation(jest.fn());
  });

  afterEach(() => {
    act(() => Modal.destroyAll());
    jest.restoreAllMocks();
  });

  it('keeps a partially authorized connector enabled and exposes the missing scopes', async () => {
    mockQueryAllConnectors.mockResolvedValue([{ ...connector, permissionStatus: 'partial', missingScopes }]);
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    const summary = await screen.findByRole('button', { name: '2 项权限未授予，查看详情' });
    expect(screen.getByRole('switch', { name: '停用飞书' })).toBeChecked();
    expect(screen.getByRole('switch', { name: '停用飞书' })).toBeEnabled();
    fireEvent.focus(summary);
    const tooltip = await screen.findByRole('tooltip');
    missingScopes.forEach((scope) => expect(tooltip).toHaveTextContent(scope));
    expect(message.error).not.toHaveBeenCalled();
  });

  it('warns after partial authorization and preserves the summary when the list refresh fails', async () => {
    mockQueryAllConnectors.mockResolvedValueOnce([{ ...connector, enableFlag: null }]);
    mockQueryAllConnectors.mockRejectedValue(new Error('list unavailable'));
    mockStartAuthorization.mockResolvedValue({
      authorizationId: 'authorization-1',
      connectorId: 3,
      status: 'connected',
      permissionStatus: 'partial',
      missingScopes,
    });
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    await authorize();

    await waitFor(() =>
      expect(message.warning).toHaveBeenCalledWith('飞书已连接，部分权限未授予，可在连接器中查看详情')
    );
    expect(screen.getByRole('switch', { name: '停用飞书' })).toBeChecked();
    expect(screen.getByRole('button', { name: '2 项权限未授予，查看详情' })).toBeInTheDocument();
    expect(message.success).not.toHaveBeenCalled();
    expect(message.error).not.toHaveBeenCalled();
  });

  it.each(['complete', undefined] as const)(
    'preserves the existing connected experience for permission status %s',
    async (permissionStatus) => {
      mockQueryAllConnectors.mockResolvedValue([{ ...connector, enableFlag: null }]);
      mockStartAuthorization.mockResolvedValue({
        authorizationId: 'authorization-1',
        connectorId: 3,
        status: 'connected',
        permissionStatus,
      } as ConnectorAuthorization);
      render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

      await authorize();

      await waitFor(() => expect(message.success).toHaveBeenCalledWith('飞书 已连接'));
      expect(message.warning).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /权限未授予/ })).not.toBeInTheDocument();
    }
  );

  it('distinguishes an explicitly unverified permission range from a complete grant', async () => {
    mockQueryAllConnectors.mockResolvedValue([{ ...connector, enableFlag: null }]);
    mockStartAuthorization.mockResolvedValue({
      authorizationId: 'authorization-1',
      connectorId: 3,
      status: 'connected',
      permissionStatus: 'unknown',
    });
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    await authorize();

    await waitFor(() => expect(message.info).toHaveBeenCalledWith('飞书已连接，权限范围暂未完整核实'));
    expect(message.success).not.toHaveBeenCalled();
    expect(message.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /权限未授予/ })).not.toBeInTheDocument();
  });

  it('shows partial permissions when a pending authorization completes during a status check', async () => {
    mockQueryAllConnectors
      .mockResolvedValueOnce([{ ...connector, enableFlag: null }])
      .mockResolvedValue([{ ...connector, permissionStatus: 'partial', missingScopes }]);
    mockStartAuthorization.mockResolvedValue({
      authorizationId: 'authorization-1',
      connectorId: 3,
      status: 'pending',
      authorizationUrl: 'https://accounts.feishu.cn/oauth/verify',
    });
    mockGetAuthorization.mockResolvedValue({
      authorizationId: 'authorization-1',
      connectorId: 3,
      status: 'connected',
      permissionStatus: 'partial',
      missingScopes,
    });
    jest.spyOn(window, 'open').mockReturnValue({ opener: null } as Window);
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    await authorize();
    fireEvent.click(await screen.findByRole('button', { name: '我已完成授权，立即检查' }));

    await waitFor(() =>
      expect(message.warning).toHaveBeenCalledWith('飞书已连接，部分权限未授予，可在连接器中查看详情')
    );
    expect(screen.getByRole('switch', { name: '停用飞书' })).toBeChecked();
    expect(screen.getByRole('button', { name: '2 项权限未授予，查看详情' })).toBeInTheDocument();
    expect(message.success).not.toHaveBeenCalled();
  });

  it('clears an old partial summary after a complete reauthorization', async () => {
    mockQueryAllConnectors
      .mockResolvedValueOnce([{ ...connector, permissionStatus: 'partial', missingScopes }])
      .mockRejectedValue(new Error('list unavailable'));
    mockStartAuthorization.mockResolvedValue({
      authorizationId: 'authorization-2',
      connectorId: 3,
      status: 'connected',
      permissionStatus: 'complete',
      missingScopes: [],
    });
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);
    expect(await screen.findByRole('button', { name: '2 项权限未授予，查看详情' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多飞书操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /重新授权/ }));
    fireEvent.click(await screen.findByRole('button', { name: '立即前往授权' }));

    await waitFor(() => expect(message.success).toHaveBeenCalledWith('飞书 已连接'));
    expect(screen.queryByRole('button', { name: /权限未授予/ })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '停用飞书' })).toBeChecked();
  });

  it('does not show a stale permission warning for an unbound connector', async () => {
    mockQueryAllConnectors.mockResolvedValue([
      { ...connector, enableFlag: null, permissionStatus: 'partial', missingScopes },
    ]);
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    expect(await screen.findByRole('button', { name: '连接' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /权限未授予/ })).not.toBeInTheDocument();
  });

  it.each(['complete', undefined] as const)(
    'clears another mounted picker’s partial summary after reauthorization with status %s',
    async (permissionStatus) => {
      mockQueryAllConnectors
        .mockResolvedValueOnce([{ ...connector, permissionStatus: 'partial', missingScopes }])
        .mockResolvedValueOnce([{ ...connector, permissionStatus: 'partial', missingScopes }])
        .mockResolvedValue([{ ...connector, permissionStatus, missingScopes: [] }]);
      mockStartAuthorization.mockResolvedValue({
        authorizationId: 'authorization-2',
        connectorId: 3,
        status: 'connected',
        permissionStatus,
        missingScopes: permissionStatus ? [] : undefined,
      });
      render(
        <>
          <ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />
          <ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />
        </>
      );
      expect(await screen.findAllByRole('button', { name: '2 项权限未授予，查看详情' })).toHaveLength(2);

      fireEvent.click(screen.getAllByRole('button', { name: '更多飞书操作' })[0]);
      fireEvent.click(await screen.findByRole('menuitem', { name: /重新授权/ }));
      fireEvent.click(await screen.findByRole('button', { name: '立即前往授权' }));

      await waitFor(() => expect(message.success).toHaveBeenCalledWith('飞书 已连接'));
      expect(screen.queryByRole('button', { name: /权限未授予/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole('switch', { name: '停用飞书' })).toHaveLength(2);
    }
  );
});
