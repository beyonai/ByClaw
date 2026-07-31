import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockMessageError = jest.fn();
const mockMessageSuccess = jest.fn();

jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/connector', () => ({
  cancelConnectorAuthorization: jest.fn(),
  getConnectorAuthorization: jest.fn(),
  queryConnectorList: jest.fn(),
  startConnectorAuthorization: jest.fn(),
  updateConnectorEnable: jest.fn(),
}));
jest.mock('antd', () => {
  const antd = jest.requireActual('antd');
  return {
    ...antd,
    message: {
      ...antd.message,
      error: (...args: unknown[]) => mockMessageError(...args),
      success: (...args: unknown[]) => mockMessageSuccess(...args),
    },
  };
});

import {
  cancelConnectorAuthorization,
  getConnectorAuthorization,
  queryConnectorList,
  startConnectorAuthorization,
  type ConnectorAuthorization,
} from '@/service/connector';
import ConnectorControl, * as ConnectorControlModule from '../index';

const mockCancelConnectorAuthorization = cancelConnectorAuthorization as jest.MockedFunction<
  typeof cancelConnectorAuthorization
>;
const mockGetConnectorAuthorization = getConnectorAuthorization as jest.MockedFunction<
  typeof getConnectorAuthorization
>;
const mockQueryConnectorList = queryConnectorList as jest.MockedFunction<typeof queryConnectorList>;
const mockStartConnectorAuthorization = startConnectorAuthorization as jest.MockedFunction<
  typeof startConnectorAuthorization
>;

type TerminalErrorClassifier = (authorization: { status: string; errorMessage?: string }) => string | undefined;

const getTerminalError = (
  ConnectorControlModule as typeof ConnectorControlModule & {
    getConnectorAuthorizationTerminalError?: TerminalErrorClassifier;
  }
).getConnectorAuthorizationTerminalError;

describe('ConnectorControl authorization states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelConnectorAuthorization.mockResolvedValue(true);
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

  it('selects the connector exactly once when polling reaches connected', async () => {
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

    const connectedSelections = onChange.mock.calls.filter(([connectors]) =>
      connectors.some((connector: { id: number }) => connector.id === 9)
    );
    expect(connectedSelections).toHaveLength(1);

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
