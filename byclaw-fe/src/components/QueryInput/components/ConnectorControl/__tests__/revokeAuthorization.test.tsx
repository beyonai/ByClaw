import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useIntl } from '@umijs/max';
import { Modal, message } from 'antd';
import { queryAllConnectors, revokeConnectorAuthorization, type ConnectorListItem } from '@/service/connector';
import zhCN from '@/locales/zh-CN';
import ConnectorControl from '..';

jest.mock('@umijs/max', () => ({
  useIntl: jest.fn(),
  useSelector: () => undefined,
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('../GlobalAccountSection', () => () => null);
jest.mock('@/service/connector', () => ({
  queryAllConnectors: jest.fn(),
  revokeConnectorAuthorization: jest.fn(),
}));

const mockQueryAllConnectors = queryAllConnectors as jest.MockedFunction<typeof queryAllConnectors>;
const mockRevokeAuthorization = revokeConnectorAuthorization as jest.MockedFunction<
  typeof revokeConnectorAuthorization
>;
const messages: Record<string, string> = zhCN;
const connector: ConnectorListItem = {
  connectorId: 3,
  connectorCode: 'dingtalk',
  connectorName: '钉钉',
  connectorType: 'SYSTEM',
  description: '',
  enableFlag: 'Y',
};

const openRevokeConfirmation = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '更多钉钉操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /取消授权/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认取消授权' }));
  return dialog;
};

describe('connector authorization revocation', () => {
  const onStateChanged = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useIntl as jest.Mock).mockReturnValue({
      formatMessage: ({ id }: { id: string }, values: Record<string, string> = {}) =>
        (messages[id] || id).replace(/\{(\w+)\}/g, (_, key) => values[key] || `{${key}}`),
    });
    mockQueryAllConnectors.mockResolvedValue([connector]);
    jest.spyOn(message, 'error').mockImplementation(jest.fn());
    jest.spyOn(message, 'success').mockImplementation(jest.fn());
    window.addEventListener('byclaw-connector-state-changed', onStateChanged);
  });

  afterEach(() => {
    act(() => Modal.destroyAll());
    window.removeEventListener('byclaw-connector-state-changed', onStateChanged);
    jest.restoreAllMocks();
  });

  it('handles a failed revoke without rejecting the confirmation and keeps the connector available for retry', async () => {
    mockRevokeAuthorization.mockRejectedValueOnce(new Error('系统发生错误，请稍后重试'));
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    await openRevokeConfirmation();

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('取消授权失败，请稍后重试'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: '停用钉钉' })).toBeChecked();
    expect(screen.getByRole('button', { name: '更多钉钉操作' })).toBeEnabled();
    expect(message.success).not.toHaveBeenCalled();
    expect(onStateChanged).not.toHaveBeenCalled();
    expect(mockQueryAllConnectors).toHaveBeenCalledTimes(1);
    expect(mockRevokeAuthorization).toHaveBeenCalledWith(3);
  });

  it('refreshes the connector and publishes its disconnected state after a successful revoke', async () => {
    mockRevokeAuthorization.mockResolvedValueOnce(true);
    mockQueryAllConnectors
      .mockResolvedValueOnce([connector])
      .mockResolvedValueOnce([{ ...connector, enableFlag: null }]);
    render(<ConnectorControl canAuthorize inline userInfo={{ userId: 1 }} />);

    await openRevokeConfirmation();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: '连接' })).toBeInTheDocument();
    expect(message.success).toHaveBeenCalledWith('钉钉授权已取消');
    expect(message.error).not.toHaveBeenCalled();
    expect(onStateChanged).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { connectorId: 3, enableFlag: null } })
    );
    expect(mockQueryAllConnectors).toHaveBeenCalledTimes(2);
  });
});
