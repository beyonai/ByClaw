import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockMessageError = jest.fn();
const mockMessageSuccess = jest.fn();
const mockMessageWarning = jest.fn();
const mockOpenedWindow = { opener: window } as unknown as Window;
const mockWindowOpen = jest.spyOn(window, 'open');

jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/connector', () => ({
  cancelConnectorAuthorization: jest.fn(),
  getConnectorAuthorization: jest.fn(),
  queryConnectorList: jest.fn(),
  queryAllConnectors: jest.fn(),
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
const mockStartConnectorAuthorization = startConnectorAuthorization as jest.MockedFunction<
  typeof startConnectorAuthorization
>;
const mockUpdateConnectorEnable = updateConnectorEnable as jest.MockedFunction<typeof updateConnectorEnable>;

type TerminalErrorClassifier = (authorization: { status: string; errorMessage?: string }) => string | undefined;

const getTerminalError = (
  ConnectorControlModule as typeof ConnectorControlModule & {
    getConnectorAuthorizationTerminalError?: TerminalErrorClassifier;
  }
).getConnectorAuthorizationTerminalError;

describe('ConnectorControl authorization states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenedWindow.opener = window;
    mockWindowOpen.mockReturnValue(mockOpenedWindow);
    mockCancelConnectorAuthorization.mockResolvedValue(true);
    mockUpdateConnectorEnable.mockResolvedValue(true);
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
    jest.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即前往授权' }));
      await Promise.resolve();
    });

    expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ id: 9 })]);

    await act(async () => {
      jest.advanceTimersByTime(3000);
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
