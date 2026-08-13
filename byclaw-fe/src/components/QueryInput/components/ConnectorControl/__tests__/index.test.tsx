import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockMessageError = jest.fn();
const mockMessageSuccess = jest.fn();
const mockMessageWarning = jest.fn();
const mockOpenedWindow = { opener: window } as unknown as Window;
const mockWindowOpen = jest.spyOn(window, 'open');

// 连接器测试只关心授权交互，补充最小用户状态以兼容组件读取当前用户信息。
jest.mock('@umijs/max', () => ({
  useSelector: (selector: (state: { user: { userInfo: Record<string, unknown> } }) => unknown) =>
    selector({ user: { userInfo: { userId: 1 } } }),
}));

jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/components/QueryInput/components/UserMcpManager', () => () => null);
jest.mock('@/service/connector', () => ({
  cancelConnectorAuthorization: jest.fn(),
  getConnectorAuthorization: jest.fn(),
  queryConnectorList: jest.fn(),
  queryAllConnectors: jest.fn(),
  revokeConnectorAuthorization: jest.fn(),
  startConnectorAuthorization: jest.fn(),
  updateConnectorEnable: jest.fn(),
}));
jest.mock('@umijs/max', () => ({
  useSelector: (selector: (state: any) => any) =>
    selector({
      user: {
        userInfo: {
          userId: 1,
        },
      },
    }),
}));
jest.mock('antd', () => {
  const antd = jest.requireActual('antd');
  return {
    ...antd,
    message: {
      ...antd.message,
      error: (...args: unknown[]) => mockMessageError(...args),
      success: (...args: unknown[]) => mockMessageSuccess(...args),
      warning: (...args: unknown[]) => mockMessageWarning(...args),
    },
  };
});

import {
  cancelConnectorAuthorization,
  getConnectorAuthorization,
  queryAllConnectors,
  queryConnectorList,
  revokeConnectorAuthorization,
  startConnectorAuthorization,
  updateConnectorEnable,
  type ConnectorAuthorization,
} from '@/service/connector';
import ConnectorControl, * as ConnectorControlModule from '../index';

jest.setTimeout(15000);

const mockCancelConnectorAuthorization = cancelConnectorAuthorization as jest.MockedFunction<
  typeof cancelConnectorAuthorization
>;
const mockGetConnectorAuthorization = getConnectorAuthorization as jest.MockedFunction<
  typeof getConnectorAuthorization
>;
const mockQueryConnectorList = queryConnectorList as jest.MockedFunction<typeof queryConnectorList>;
const mockQueryAllConnectors = queryAllConnectors as jest.MockedFunction<typeof queryAllConnectors>;
const mockRevokeConnectorAuthorization = revokeConnectorAuthorization as jest.MockedFunction<
  typeof revokeConnectorAuthorization
>;
const mockStartConnectorAuthorization = startConnectorAuthorization as jest.MockedFunction<
  typeof startConnectorAuthorization
>;
const mockUpdateConnectorEnable = updateConnectorEnable as jest.MockedFunction<typeof updateConnectorEnable>;

type TerminalErrorClassifier = (authorization: { status: string; errorMessage?: string }) => string | undefined;
type CredentialExpirationFormatter = (
  value: string,
  now: string
) => { formattedTime: string; expired: boolean } | undefined;
type CredentialOffsetNormalizer = (value: string) => string;

const getTerminalError = (
  ConnectorControlModule as typeof ConnectorControlModule & {
    getConnectorAuthorizationTerminalError?: TerminalErrorClassifier;
  }
).getConnectorAuthorizationTerminalError;
const getCredentialExpirationDisplay = (
  ConnectorControlModule as typeof ConnectorControlModule & {
    getCredentialExpirationDisplay?: CredentialExpirationFormatter;
  }
).getCredentialExpirationDisplay;
const normalizeCredentialExpirationOffset = (
  ConnectorControlModule as typeof ConnectorControlModule & {
    normalizeCredentialExpirationOffset?: CredentialOffsetNormalizer;
  }
).normalizeCredentialExpirationOffset;

describe('ConnectorControl authorization states', () => {
  beforeEach(() => {
    // 上一用例若残留假计时器，异步列表加载与 findBy* 轮询都会卡住。
    jest.useRealTimers();
    jest.clearAllMocks();
    mockOpenedWindow.opener = window;
    mockWindowOpen.mockReturnValue(mockOpenedWindow);
    mockCancelConnectorAuthorization.mockResolvedValue(true);
    mockRevokeConnectorAuthorization.mockResolvedValue(true);
    mockUpdateConnectorEnable.mockResolvedValue(true);
    mockStartConnectorAuthorization.mockReset();
    mockGetConnectorAuthorization.mockReset();
    mockQueryAllConnectors.mockImplementation(async () => {
      const response = await mockQueryConnectorList({ pageNum: 1, pageSize: 100, keyword: '' });
      return response.list || [];
    });
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorCode: 'wecom',
          connectorId: 9,
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '企业知识库',
          enableFlag: null,
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    mockWindowOpen.mockRestore();
  });

  it('loads the connector list when the component mounts', async () => {
    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    await waitFor(() => {
      expect(mockQueryConnectorList).toHaveBeenCalledWith({ pageNum: 1, pageSize: 100, keyword: '' });
    });
  });

  it('keeps the latest connector list when an older request resolves last', async () => {
    const expiredConnectorPage = {
      list: [
        {
          connectorCode: 'wecom',
          connectorId: 9,
          connectorName: '企业微信',
          connectorType: 'SYSTEM' as const,
          description: '企业知识库',
          enableFlag: null,
          credentialExpiresAt: '2000-01-02T03:04:05+08:00',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    };
    const refreshedConnectorPage = {
      ...expiredConnectorPage,
      list: [
        {
          ...expiredConnectorPage.list[0],
          credentialExpiresAt: '2999-01-02T03:04:05+08:00',
        },
      ],
    };
    let resolveOlderRequest!: (page: typeof expiredConnectorPage) => void;
    let resolveLatestRequest!: (page: typeof refreshedConnectorPage) => void;
    mockQueryConnectorList
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlderRequest = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatestRequest = resolve;
          })
      );

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    try {
      await waitFor(() => expect(mockQueryConnectorList).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      await waitFor(() => expect(mockQueryConnectorList).toHaveBeenCalledTimes(2));

      await act(async () => {
        resolveLatestRequest(refreshedConnectorPage);
        await Promise.resolve();
      });
      expect(await screen.findByText('授权有效期至 2999-01-02 03:04:05')).toBeInTheDocument();

      await act(async () => {
        resolveOlderRequest(expiredConnectorPage);
        await Promise.resolve();
      });
      expect(screen.getByText('授权有效期至 2999-01-02 03:04:05')).toBeInTheDocument();
      expect(screen.queryByText('授权已于 2000-01-02 03:04:05 过期')).not.toBeInTheDocument();
    } finally {
      unmount();
    }
  });

  it('shows offset credential expiration without overriding the backend enable flag', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorCode: 'dingtalk',
          connectorId: 1,
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
          credentialExpiresAt: '2999-01-02T03:04:05+08:00',
        },
        {
          connectorCode: 'lark',
          connectorId: 2,
          connectorName: '飞书',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
          credentialExpiresAt: '2000-01-02T03:04:05+08:00',
        },
        {
          connectorCode: 'wecom',
          connectorId: 3,
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: null,
          credentialExpiresAt: 'not-a-date',
        },
        {
          connectorCode: 'custom',
          connectorId: 4,
          connectorName: '自定义连接器',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: null,
          credentialExpiresAt: null,
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 4,
      totalPages: 1,
    });

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    try {
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));

      expect(await screen.findByText('授权有效期至 2999-01-02 03:04:05')).toBeInTheDocument();
      expect(screen.getByText('授权已于 2000-01-02 03:04:05 过期')).toBeInTheDocument();
      expect(screen.getAllByText(/授权(?:有效期至|已于)/)).toHaveLength(2);
      expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
      expect(screen.getByRole('switch', { name: '停用飞书' })).toBeChecked();
    } finally {
      unmount();
    }
  });

  it('uses refresh-aware lifecycle metadata instead of presenting access token expiry as authorization expiry', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorCode: 'dingtalk',
          connectorId: 1,
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'READY',
          renewalMode: 'REFRESH_TOKEN',
          accessExpiresAt: '2000-01-02T03:04:05+08:00',
          refreshExpiresAt: '2999-01-02T03:04:05+08:00',
        },
        {
          connectorCode: 'lark',
          connectorId: 2,
          connectorName: '飞书',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'READY',
          renewalMode: 'REFRESH_TOKEN',
          accessExpiresAt: '2000-01-02T03:04:05+08:00',
          refreshExpiresAt: null,
        },
        {
          connectorCode: 'wecom',
          connectorId: 3,
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'N',
          credentialState: 'REAUTH_REQUIRED',
          renewalMode: 'PROBE_ONLY',
          accessExpiresAt: null,
          refreshExpiresAt: null,
        },
        {
          connectorCode: 'custom',
          connectorId: 4,
          connectorName: '临期连接器',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'EXPIRING',
          renewalMode: 'REFRESH_TOKEN',
          accessExpiresAt: null,
          refreshExpiresAt: '2998-01-02T03:04:05+08:00',
        },
        {
          connectorCode: 'wecom-probe',
          connectorId: 5,
          connectorName: '企微探测连接器',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'READY',
          renewalMode: 'PROBE_ONLY',
          accessExpiresAt: null,
          refreshExpiresAt: null,
          lastVerifiedAt: '2026-08-12T03:04:05+08:00',
        },
        {
          connectorCode: 'lark-refresh-with-expiry',
          connectorId: 6,
          connectorName: '飞书待续期',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'REFRESH_NEEDED',
          renewalMode: 'REFRESH_TOKEN',
          accessExpiresAt: '2000-01-02T03:04:05+08:00',
          refreshExpiresAt: '2999-01-02T03:04:05+08:00',
        },
        {
          connectorCode: 'lark-refresh-without-expiry',
          connectorId: 7,
          connectorName: '飞书待续期未知时间',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'REFRESH_NEEDED',
          renewalMode: 'REFRESH_TOKEN',
          accessExpiresAt: '2000-01-02T03:04:05+08:00',
          refreshExpiresAt: null,
        },
        {
          connectorCode: 'dingtalk-sync-pending',
          connectorId: 8,
          connectorName: '钉钉状态同步中',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'UNKNOWN',
          renewalMode: 'REFRESH_TOKEN',
          accessExpiresAt: null,
          refreshExpiresAt: null,
        },
        {
          connectorCode: 'generic-sync-pending',
          connectorId: 9,
          connectorName: '普通连接器状态同步中',
          connectorType: 'CUSTOM',
          description: '',
          enableFlag: 'Y',
          credentialState: 'UNKNOWN',
          renewalMode: 'NONE',
          accessExpiresAt: null,
          refreshExpiresAt: null,
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 9,
      totalPages: 1,
    });

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    try {
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      fireEvent.click(await screen.findByRole('button', { name: /查看全部连接器/ }));

      expect(await screen.findByText('将在下次使用时自动续期，预计授权有效至 2999-01-02 03:04:05')).toBeInTheDocument();
      expect(screen.getByText('将在下次使用时自动续期')).toBeInTheDocument();
      expect(screen.getAllByText('预计授权有效至 2999-01-02 03:04:05')).not.toHaveLength(0);
      expect(screen.getAllByText('自动续期')).not.toHaveLength(0);
      expect(screen.getAllByText('授权已失效，请重新连接')).not.toHaveLength(0);
      expect(screen.queryByText('授权已于 2000-01-02 03:04:05 过期')).not.toBeInTheDocument();

      expect(await screen.findAllByText('授权即将失效，预计有效至 2998-01-02 03:04:05')).not.toHaveLength(0);
      expect(screen.getAllByText('最近验证于 2026-08-12 03:04:05')).not.toHaveLength(0);
      expect(screen.getByText('自动续期，授权有效期同步中')).toBeInTheDocument();
      expect(screen.getByText('授权状态待同步')).toBeInTheDocument();
      expect(screen.queryByText(/企微探测连接器.*授权有效期至/)).not.toBeInTheDocument();
    } finally {
      unmount();
    }
  });

  it('parses legacy credential expiration in Asia/Shanghai independently of browser timezone', () => {
    expect(getCredentialExpirationDisplay?.('2026-08-10 08:30:00', '2026-08-10T00:30:01Z')).toEqual({
      formattedTime: '2026-08-10 08:30:00',
      expired: true,
    });
    expect(getCredentialExpirationDisplay?.('2026-08-10T08:30:00', '2026-08-10T00:29:59Z')).toEqual({
      formattedTime: '2026-08-10 08:30:00',
      expired: false,
    });
  });

  it.each([
    ['2026-08-10T00:30:00Z', '2026-08-10T00:29:59Z', false],
    ['2026-08-10T08:30:00+0800', '2026-08-10T00:30:01Z', true],
    ['2026-08-09T19:30:00-05:00', '2026-08-10T00:30:01Z', true],
  ])('compares %s as an absolute instant', (value, now, expired) => {
    expect(getCredentialExpirationDisplay?.(value, now)).toEqual({
      formattedTime: '2026-08-10 08:30:00',
      expired,
    });
  });

  it.each([
    ['2026-08-10T08:30:00+0800', '2026-08-10T08:30:00+08:00'],
    ['2026-08-10T08:30:00-0500', '2026-08-10T08:30:00-05:00'],
    ['2026-08-10T00:30:00Z', '2026-08-10T00:30:00Z'],
    ['2026-08-10T08:30:00+08:00', '2026-08-10T08:30:00+08:00'],
  ])('normalizes the credential expiration offset in %s', (value, expected) => {
    expect(normalizeCredentialExpirationOffset?.(value)).toBe(expected);
  });

  it('rejects an impossible calendar date even when the ISO value has an offset', () => {
    expect(getCredentialExpirationDisplay?.('2026-02-30T08:30:00+08:00', '2026-01-01T00:00:00Z')).toBeUndefined();
  });

  it.each(['2026-08-10T08:30:00+14:30', '2026-08-10T08:30:00+08:60'])(
    'rejects the illegal UTC offset in %s',
    (value) => {
      expect(getCredentialExpirationDisplay?.(value, '2026-01-01T00:00:00Z')).toBeUndefined();
    }
  );

  it('renders selected connectors as an avatar group and opens settings on click', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 1,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
        },
        {
          connectorId: 2,
          connectorCode: 'lark',
          connectorName: '飞书',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
    });
    const { container } = render(<ConnectorControl canAuthorize />);

    await waitFor(() => {
      expect(mockQueryConnectorList).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.ant-avatar-group')).not.toBeNull();
    });

    expect(container.querySelector('.ant-avatar-group')).not.toBeNull();
    expect(container.querySelectorAll('.ant-avatar')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '查看已连接连接器' }));
    expect(screen.getByRole('dialog', { name: '连接器设置' })).toBeInTheDocument();
  });

  it('does not show the view-all action when the connector list is empty', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [],
      pageNum: 1,
      pageSize: 100,
      total: 0,
      totalPages: 0,
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));

    await screen.findByText('暂无连接器');
    expect(screen.queryByText('查看全部连接器')).not.toBeInTheDocument();
  });

  it('uses the global enable endpoint and updates the toolbar state', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorCode: 'wecom',
          connectorId: 9,
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '企业知识库',
          enableFlag: 'N',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    const { container } = render(<ConnectorControl canAuthorize />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    const enableSwitch = await screen.findByRole('switch', { name: '启用企业微信' });
    fireEvent.click(enableSwitch);

    await waitFor(() => {
      expect(mockUpdateConnectorEnable).toHaveBeenCalledWith(9, true);
      expect(screen.getByRole('switch', { name: '停用企业微信' })).toBeChecked();
      expect(container.querySelector('.ant-avatar-group')).not.toBeNull();
    });
  });

  it('uses a management entry instead of the generic switch for the user MCP template', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorCode: 'user-mcp',
          connectorId: 19,
          connectorName: '自定义 MCP',
          connectorType: 'SYSTEM',
          description: '管理用户 MCP 服务',
          enableFlag: 'Y',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));

    const manageButton = await screen.findByRole('button', { name: '管理' });
    expect(screen.queryByRole('switch', { name: '停用自定义 MCP' })).not.toBeInTheDocument();
    fireEvent.click(manageButton);

    expect(await screen.findByText('连接器配置')).toBeInTheDocument();
    expect(mockUpdateConnectorEnable).not.toHaveBeenCalled();
  });

  it('shows account actions for enabled and disabled bindings but not unbound connectors', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 1,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
        },
        {
          connectorId: 2,
          connectorCode: 'lark',
          connectorName: '飞书',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'N',
        },
        {
          connectorId: 3,
          connectorCode: 'wecom',
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: null,
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 3,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));

    expect(await screen.findByRole('button', { name: '更多钉钉操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多飞书操作' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多企业微信操作' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '连接' })).toBeInTheDocument();
  });

  it('starts the existing authorization flow from the reauthorization menu item', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 1,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '更多钉钉操作' }));
    fireEvent.click(await screen.findByText('重新授权'));

    expect(await screen.findByRole('heading', { name: '连接 钉钉 作为 AI 知识库' })).toBeInTheDocument();
  });

  it('shows a direct connect action without an account menu for an expired binding', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 1,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: null,
          credentialExpiresAt: '2000-01-02T03:04:05+08:00',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));

    expect(await screen.findByText('授权已于 2000-01-02 03:04:05 过期')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多钉钉操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    expect(await screen.findByRole('heading', { name: '连接 钉钉 作为 AI 知识库' })).toBeInTheDocument();
  });

  it('confirms and revokes an existing connector authorization', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 1,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(await screen.findByRole('button', { name: '查看已连接连接器' }));
    fireEvent.click(await screen.findByRole('button', { name: '更多钉钉操作' }));
    fireEvent.click(await screen.findByText('取消授权'));

    expect(await screen.findAllByText('取消钉钉授权？')).not.toHaveLength(0);
    expect(screen.getByText('当前 CLI 登录凭证将被清除，再次使用时需要重新授权。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认取消授权' }));

    await waitFor(() => expect(mockRevokeConnectorAuthorization).toHaveBeenCalledWith(1));
  });

  it('clears stale expiration immediately when revocation succeeds and the list refresh fails', async () => {
    const connectedConnectorPage = {
      list: [
        {
          connectorId: 1,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM' as const,
          description: '',
          enableFlag: 'Y' as const,
          credentialExpiresAt: '2999-01-02T03:04:05+08:00',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    };
    mockQueryConnectorList
      .mockResolvedValueOnce(connectedConnectorPage)
      .mockResolvedValueOnce(connectedConnectorPage)
      .mockRejectedValue(new Error('refresh failed'));

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    expect(await screen.findByText('授权有效期至 2999-01-02 03:04:05')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多钉钉操作' }));
    fireEvent.click(await screen.findByText('取消授权'));
    fireEvent.click(await screen.findByRole('button', { name: '确认取消授权' }));

    await waitFor(() => expect(mockRevokeConnectorAuthorization).toHaveBeenCalledWith(1));
    expect(screen.queryByText('授权有效期至 2999-01-02 03:04:05')).not.toBeInTheDocument();
  });

  it('uses the backend error message when authorization is cancelled', () => {
    expect(
      getTerminalError?.({
        status: 'cancelled',
        errorMessage: '用户已取消授权',
      })
    ).toBe('用户已取消授权');
  });

  it('does not classify pending authorization as terminal', () => {
    expect(getTerminalError?.({ status: 'pending' })).toBeUndefined();
  });

  it('automatically opens a pending authorization URL and keeps the fallback link', async () => {
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com/authorize', '_blank');
    expect(mockOpenedWindow.opener).toBeNull();
    expect(screen.getByRole('link', { name: '打开 企业微信 授权页' })).toHaveAttribute(
      'href',
      'https://example.com/authorize'
    );
  });

  it('opens a new authorization phase once and keeps a continue link', async () => {
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      phase: 'app_initialization',
      authorizationUrl: 'https://example.com/initialize',
    });
    mockGetConnectorAuthorization
      .mockResolvedValueOnce({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
        phase: 'user_authorization',
        authorizationUrl: 'https://example.com/authorize-user',
      })
      .mockResolvedValue({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
        phase: 'user_authorization',
        authorizationUrl: 'https://example.com/authorize-user-refreshed',
      });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    jest.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com/initialize', '_blank');
    expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com/authorize-user', '_blank');
    expect(screen.getByRole('link', { name: '继续授权' })).toHaveAttribute(
      'href',
      'https://example.com/authorize-user'
    );

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });
    expect(mockWindowOpen).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: '继续授权' })).toHaveAttribute(
      'href',
      'https://example.com/authorize-user-refreshed'
    );
  });

  it('warns when automatic opening is blocked and keeps the fallback link', async () => {
    mockWindowOpen.mockReturnValueOnce(null);
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(mockMessageWarning).toHaveBeenCalledWith('浏览器已阻止自动打开，请点击“打开企业微信授权页”继续');
    expect(screen.getByRole('link', { name: '打开 企业微信 授权页' })).toBeInTheDocument();
  });

  it('rejects an unsafe authorization URL without opening or rendering it', async () => {
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'javascript:alert(1)',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith('授权服务返回了无效的授权链接');
    expect(screen.queryByRole('link', { name: '打开 企业微信 授权页' })).not.toBeInTheDocument();
  });

  it('does not open a page for a QR-only authorization response', async () => {
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      qrCodeUrl: 'https://example.com/qr.png',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: '企业微信授权二维码' })).toHaveAttribute(
      'src',
      'https://example.com/qr.png'
    );
  });

  it('does not open a page when the start response is already connected', async () => {
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'connected',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(mockMessageSuccess).toHaveBeenCalledWith('企业微信 已连接');
  });

  it('refreshes authoritative connector metadata after authorization succeeds', async () => {
    const expiredConnectorPage = {
      list: [
        {
          connectorCode: 'wecom',
          connectorId: 9,
          connectorName: '企业微信',
          connectorType: 'SYSTEM' as const,
          description: '企业知识库',
          enableFlag: null,
          credentialExpiresAt: '2000-01-02T03:04:05+08:00',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    };
    const refreshedConnectorPage = {
      ...expiredConnectorPage,
      list: [
        {
          ...expiredConnectorPage.list[0],
          enableFlag: 'Y' as const,
          credentialExpiresAt: '2999-01-02T03:04:05+08:00',
        },
      ],
    };
    mockQueryConnectorList
      .mockResolvedValueOnce(expiredConnectorPage)
      .mockResolvedValueOnce(expiredConnectorPage)
      .mockResolvedValue(refreshedConnectorPage);
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'connected',
      expiresAt: '2000-01-01T00:00:00Z',
    });

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    try {
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      expect(await screen.findByText('授权已于 2000-01-02 03:04:05 过期')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: '连接' }));
      const callsBeforeAuthorization = mockQueryConnectorList.mock.calls.length;

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockQueryConnectorList).toHaveBeenCalledTimes(callsBeforeAuthorization + 1);
      });
      expect(screen.queryByText('授权已于 2000-01-02 03:04:05 过期')).not.toBeInTheDocument();
      expect(screen.getByText('授权有效期至 2999-01-02 03:04:05')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: '停用企业微信' })).toBeChecked();
    } finally {
      unmount();
    }
  });

  it('keeps the connector enabled and clears stale expiration when the post-authorization refresh fails', async () => {
    const expiredConnectorPage = {
      list: [
        {
          connectorCode: 'wecom',
          connectorId: 9,
          connectorName: '企业微信',
          connectorType: 'SYSTEM' as const,
          description: '企业知识库',
          enableFlag: null,
          credentialExpiresAt: '2000-01-02T03:04:05+08:00',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    };
    mockQueryConnectorList
      .mockResolvedValueOnce(expiredConnectorPage)
      .mockResolvedValueOnce(expiredConnectorPage)
      .mockRejectedValue(new Error('refresh failed'));
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'connected',
    });

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={jest.fn()} />);

    try {
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      expect(await screen.findByText('授权已于 2000-01-02 03:04:05 过期')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: '连接' }));
      const callsBeforeAuthorization = mockQueryConnectorList.mock.calls.length;

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockQueryConnectorList).toHaveBeenCalledTimes(callsBeforeAuthorization + 1);
        expect(mockMessageWarning).toHaveBeenCalledWith('连接器已授权，但有效期刷新失败，请稍后重试');
      });
      expect(screen.getByRole('switch', { name: '停用企业微信' })).toBeChecked();
      expect(screen.queryByText('授权已于 2000-01-02 03:04:05 过期')).not.toBeInTheDocument();
    } finally {
      unmount();
    }
  });

  it.each([
    ['failed', '授权未完成，请重新发起连接'],
    ['expired', '授权任务已失效，请重新发起连接'],
    ['cancelled', '授权已取消，请重新发起连接'],
  ])('provides a fallback message for %s authorization', (status, expectedMessage) => {
    expect(getTerminalError?.({ status })).toBe(expectedMessage);
  });

  it.each([
    ['failed', '企业微信授权失败'],
    ['expired', '企业微信授权已过期'],
    ['cancelled', '用户已取消授权'],
  ] as const)(
    'stops polling and keeps the connector disabled when authorization is %s',
    async (status, errorMessage) => {
      const onChange = jest.fn();
      const terminalAuthorization: ConnectorAuthorization = {
        authorizationId: 'authorization-9',
        connectorId: 9,
        status,
        errorMessage,
      };
      let resolveAuthorizationStatus!: (authorization: ConnectorAuthorization) => void;
      mockStartConnectorAuthorization.mockResolvedValue({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
        authorizationUrl: 'https://example.com/authorize',
      });
      mockGetConnectorAuthorization.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAuthorizationStatus = resolve;
          })
      );

      render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      await screen.findByText('企业微信');
      fireEvent.click(screen.getByRole('button', { name: '连接' }));
      jest.useFakeTimers();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
        await Promise.resolve();
      });

      expect(screen.getByRole('link', { name: '打开 企业微信 授权页' })).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(6000);
        await Promise.resolve();
      });

      expect(mockGetConnectorAuthorization).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveAuthorizationStatus(terminalAuthorization);
        await Promise.resolve();
      });

      expect(mockMessageError).toHaveBeenCalledTimes(1);
      expect(mockMessageError).toHaveBeenCalledWith(errorMessage);
      expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);

      await act(async () => {
        jest.advanceTimersByTime(6000);
        await Promise.resolve();
      });

      expect(mockGetConnectorAuthorization).toHaveBeenCalledTimes(1);
      expect(mockMessageError).toHaveBeenCalledTimes(1);
    }
  );

  it('shows the connector as globally enabled when polling reaches connected', async () => {
    const onChange = jest.fn();
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });
    mockGetConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'connected',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorCode: 'wecom',
          connectorId: 9,
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '企业知识库',
          enableFlag: 'Y',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    jest.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: '停用企业微信' })).toBeChecked();

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).toHaveBeenCalledTimes(1);
  });

  it('ignores a connected response that arrives after the user cancels', async () => {
    const onChange = jest.fn();
    const connectedAuthorization = {
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'connected' as const,
    };
    let resolveAuthorizationStatus!: (authorization: typeof connectedAuthorization) => void;
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });
    mockGetConnectorAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuthorizationStatus = resolve;
        })
    );

    render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    jest.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(screen.getByRole('link', { name: '打开 企业微信 授权页' })).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消连接' }));
      await Promise.resolve();
      resolveAuthorizationStatus(connectedAuthorization);
      await Promise.resolve();
    });

    expect(mockCancelConnectorAuthorization).toHaveBeenCalledWith('authorization-9');
    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
  });

  it.each(['connected', 'failed'] as const)(
    'ignores a stale terminal %s start response without cancelling it',
    async (status) => {
      const onChange = jest.fn();
      let resolveStartAuthorization!: (authorization: ConnectorAuthorization) => void;
      mockStartConnectorAuthorization.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveStartAuthorization = resolve;
          })
      );

      render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      await screen.findByText('企业微信');
      fireEvent.click(screen.getByRole('button', { name: '连接' }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
        await Promise.resolve();
      });

      const authorizationDialog = screen
        .getByRole('heading', { name: '连接 企业微信 作为 AI 知识库' })
        .closest('[role="dialog"]');
      expect(authorizationDialog).not.toBeNull();
      fireEvent.click(within(authorizationDialog!).getByRole('button', { name: 'Close' }));

      await act(async () => {
        resolveStartAuthorization({
          authorizationId: 'authorization-9',
          connectorId: 9,
          status,
          errorMessage: status === 'failed' ? '授权失败' : undefined,
        });
        await Promise.resolve();
      });

      expect(mockCancelConnectorAuthorization).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
      expect(mockMessageError).not.toHaveBeenCalled();
      expect(mockMessageSuccess).not.toHaveBeenCalled();
      expect(mockWindowOpen).not.toHaveBeenCalled();
    }
  );

  it('cancels a stale pending start response once per authorization id', async () => {
    const onChange = jest.fn();
    const startResolvers: Array<(authorization: ConnectorAuthorization) => void> = [];
    mockCancelConnectorAuthorization.mockRejectedValue(new Error('cancel failed'));
    mockStartConnectorAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          startResolvers.push(resolve);
        })
    );

    render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    const authorizationDialog = screen
      .getByRole('heading', { name: '连接 企业微信 作为 AI 知识库' })
      .closest('[role="dialog"]');
    expect(authorizationDialog).not.toBeNull();
    const closeButton = within(authorizationDialog!).getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);
    fireEvent.click(closeButton);
    jest.useFakeTimers();

    await act(async () => {
      startResolvers[0]({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
        authorizationUrl: 'https://example.com/authorize',
      });
      await Promise.resolve();
    });

    expect(mockCancelConnectorAuthorization).toHaveBeenCalledTimes(1);
    expect(mockCancelConnectorAuthorization).toHaveBeenCalledWith('authorization-9');

    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    const repeatedAuthorizationDialog = screen
      .getByRole('heading', { name: '连接 企业微信 作为 AI 知识库' })
      .closest('[role="dialog"]');
    expect(repeatedAuthorizationDialog).not.toBeNull();
    fireEvent.click(within(repeatedAuthorizationDialog!).getByRole('button', { name: 'Close' }));

    await act(async () => {
      startResolvers[1]({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
        authorizationUrl: 'https://example.com/authorize',
      });
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).not.toHaveBeenCalled();
    expect(mockCancelConnectorAuthorization).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: '打开 企业微信 授权页' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
    expect(mockMessageError).not.toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it('shows a start failure without opening an empty URL or starting polling', async () => {
    const onChange = jest.fn();
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'failed',
      authorizationUrl: '',
      errorCode: 'PROVIDER_NOT_IMPLEMENTED',
      errorMessage: '企业微信授权暂未实现',
    });

    render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    jest.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(mockMessageError).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith('企业微信授权暂未实现');
    expect(screen.queryByRole('link', { name: '打开 企业微信 授权页' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);

    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledTimes(1);
  });

  it('ignores a deferred connected start response after unmount', async () => {
    const onChange = jest.fn();
    let resolveStartAuthorization!: (authorization: ConnectorAuthorization) => void;
    mockStartConnectorAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStartAuthorization = resolve;
        })
    );

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
    unmount();

    await act(async () => {
      resolveStartAuthorization({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'connected',
      });
      await Promise.resolve();
    });

    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
    expect(mockMessageSuccess).not.toHaveBeenCalled();
    expect(mockMessageError).not.toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it('invalidates a deferred pending start response when authorization permission is lost', async () => {
    const onChange = jest.fn();
    let resolveStartAuthorization!: (authorization: ConnectorAuthorization) => void;
    mockStartConnectorAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStartAuthorization = resolve;
        })
    );

    const { rerender } = render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
    rerender(<ConnectorControl canAuthorize={false} value={[]} onChange={onChange} />);
    jest.useFakeTimers();

    await act(async () => {
      resolveStartAuthorization({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
        authorizationUrl: 'https://example.com/authorize',
      });
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
    expect(mockMessageError).not.toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it('ignores a deferred connected status response after unmount', async () => {
    const onChange = jest.fn();
    let resolveAuthorizationStatus!: (authorization: ConnectorAuthorization) => void;
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });
    mockGetConnectorAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuthorizationStatus = resolve;
        })
    );

    const { unmount } = render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    unmount();

    await act(async () => {
      resolveAuthorizationStatus({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'connected',
      });
      await Promise.resolve();
    });

    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
    expect(mockMessageSuccess).not.toHaveBeenCalled();
    expect(mockMessageError).not.toHaveBeenCalled();
  });

  it('invalidates a deferred status response and stops polling when authorization permission is lost', async () => {
    const onChange = jest.fn();
    let resolveAuthorizationStatus!: (authorization: ConnectorAuthorization) => void;
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });
    mockGetConnectorAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuthorizationStatus = resolve;
        })
    );

    const { rerender } = render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).toHaveBeenCalledTimes(1);
    rerender(<ConnectorControl canAuthorize={false} value={[]} onChange={onChange} />);

    await act(async () => {
      resolveAuthorizationStatus({
        authorizationId: 'authorization-9',
        connectorId: 9,
        status: 'pending',
      });
      await Promise.resolve();
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(mockGetConnectorAuthorization).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);
    expect(mockMessageError).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('closes locally and sends only one background cancel while cancellation is slow', async () => {
    const onChange = jest.fn();
    let rejectCancelAuthorization!: (error: Error) => void;
    mockStartConnectorAuthorization.mockResolvedValue({
      authorizationId: 'authorization-9',
      connectorId: 9,
      status: 'pending',
      authorizationUrl: 'https://example.com/authorize',
    });
    mockCancelConnectorAuthorization.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectCancelAuthorization = reject;
        })
    );

    render(<ConnectorControl canAuthorize value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await waitFor(() => {
      expect(mockQueryAllConnectors).toHaveBeenCalled();
    });
    await screen.findByText('企业微信');
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    const cancelButton = screen.getByRole('button', { name: '取消连接' });
    fireEvent.click(cancelButton);
    fireEvent.click(cancelButton);

    expect(screen.queryByRole('link', { name: '打开 企业微信 授权页' })).not.toBeInTheDocument();
    expect(mockCancelConnectorAuthorization).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectCancelAuthorization(new Error('cancel failed'));
      await Promise.resolve();
    });

    expect(mockMessageError).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: '打开 企业微信 授权页' })).not.toBeInTheDocument();
  });
});
