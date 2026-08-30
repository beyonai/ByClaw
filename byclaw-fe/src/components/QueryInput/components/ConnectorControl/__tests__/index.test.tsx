import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal } from 'antd';

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
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: { emit: jest.fn() } }));
jest.mock('@umijs/max', () => ({
  useSelector: (selector: (state: any) => unknown) => selector({ user: { userInfo: { userId: 1 } } }),
}));
jest.mock('@/service/connector', () => ({
  cancelConnectorAuthorization: jest.fn(),
  getConnectorAuthorization: jest.fn(),
  queryConnectorList: jest.fn(),
  queryAllConnectors: jest.fn(),
  revokeConnectorAuthorization: jest.fn(),
  startConnectorAuthorization: jest.fn(),
  startConnectorCredentialAuthorization: jest.fn(),
  updateConnectorEnable: jest.fn(),
}));
jest.mock('@/service/devloop', () => ({
  createGlobalOperationAccount: jest.fn(),
  deleteOperationAccount: jest.fn(),
  listGlobalOperationAccounts: jest.fn(),
  loginOperationAccount: jest.fn(),
  updateOperationAccount: jest.fn(),
}));
jest.mock('@umijs/max', () => {
  const intl = {
    formatMessage: ({ id }: { id: string }) =>
      ({
        'projectSpace.operation.account.add': '新增账号',
        'connector.accounts.title': '账号',
      }[id] || id),
  };
  return {
    useSelector: (selector: (state: any) => any) =>
      selector({
        user: {
          userInfo: {
            userId: 1,
          },
        },
      }),
    useIntl: () => intl,
  };
});
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
  startConnectorCredentialAuthorization,
  updateConnectorEnable,
  type ConnectorAuthorization,
} from '@/service/connector';
import {
  createGlobalOperationAccount,
  deleteOperationAccount,
  listGlobalOperationAccounts,
  updateOperationAccount,
} from '@/service/devloop';
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
const mockStartConnectorCredentialAuthorization = startConnectorCredentialAuthorization as jest.MockedFunction<
  typeof startConnectorCredentialAuthorization
>;
const mockUpdateConnectorEnable = updateConnectorEnable as jest.MockedFunction<typeof updateConnectorEnable>;
const mockCreateGlobalOperationAccount = createGlobalOperationAccount as jest.MockedFunction<
  typeof createGlobalOperationAccount
>;
const mockDeleteOperationAccount = deleteOperationAccount as jest.MockedFunction<typeof deleteOperationAccount>;
const mockListGlobalOperationAccounts = listGlobalOperationAccounts as jest.MockedFunction<
  typeof listGlobalOperationAccounts
>;
const mockUpdateOperationAccount = updateOperationAccount as jest.MockedFunction<typeof updateOperationAccount>;

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
    mockCreateGlobalOperationAccount.mockResolvedValue({ accountId: 88 });
    mockDeleteOperationAccount.mockResolvedValue(undefined);
    mockUpdateOperationAccount.mockResolvedValue(undefined);
    mockListGlobalOperationAccounts.mockResolvedValue([
      {
        accountId: 7,
        platformCode: 'CustomLink',
        accountName: 'ima',
        accountCode: 'custom',
        customUrl: 'https://ima.qq.com/wikis/',
        loginStatus: 'online',
      },
    ]);
    mockStartConnectorAuthorization.mockReset();
    mockStartConnectorCredentialAuthorization.mockReset();
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
    Modal.destroyAll();
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

  it('shows all global custom accounts and the add account action in the configuration drawer', async () => {
    render(<ConnectorControl canAuthorize />);

    expect(mockListGlobalOperationAccounts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByText('查看全部连接器'));

    expect(await screen.findByText('ima')).toBeInTheDocument();
    expect(screen.getByText('https://ima.qq.com/wikis/')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增账号/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '账号操作' })).toBeInTheDocument();
    expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(1);
  });

  it('mixes global account cards with connector cards and keeps the add action in the drawer header', async () => {
    render(<ConnectorControl canAuthorize />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByText('查看全部连接器'));

    const drawerContent = screen.getByText('连接器配置').closest('.ant-drawer-content');
    expect(drawerContent).not.toBeNull();
    const drawerHeader = drawerContent?.querySelector('.ant-drawer-header');
    expect(drawerHeader).not.toBeNull();
    expect(within(drawerHeader as HTMLElement).getByRole('button', { name: /新增账号/ })).toBeInTheDocument();
    expect(within(drawerContent as HTMLElement).queryByRole('heading', { name: '账号' })).not.toBeInTheDocument();

    const connectorCard = (await within(drawerContent as HTMLElement).findByText('企业微信')).closest('.connectorItem');
    const accountCard = (await within(drawerContent as HTMLElement).findByText('ima')).closest('.accountCard');
    expect(connectorCard).not.toBeNull();
    expect(accountCard).not.toBeNull();
    expect(connectorCard?.parentElement).toBe(accountCard?.parentElement);
    expect(connectorCard).toHaveClass('compactItem');
    expect(accountCard).not.toHaveClass('compactItem');
    expect(accountCard).toHaveClass('accountCardDrawerCompact');
    expect(drawerContent?.querySelector('.accountLoginNotice')).not.toBeInTheDocument();
    const accountCardFooter = accountCard?.querySelector('.accountCardFooter');
    expect(accountCardFooter).not.toBeNull();
    expect(accountCard?.querySelector('.accountPlatformName')?.parentElement).toBe(accountCardFooter);
    expect(accountCard?.querySelector('.accountCardActions')?.parentElement).toBe(accountCardFooter);
  });

  it('creates a global custom account without a project and refreshes the cards', async () => {
    render(<ConnectorControl canAuthorize />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByText('查看全部连接器'));
    fireEvent.click(await screen.findByRole('button', { name: /新增账号/ }));
    const accountModal = (await screen.findByText('projectSpace.operation.accountForm.addTitle')).closest(
      '[role="dialog"]'
    );
    expect(accountModal).not.toBeNull();
    expect(
      within(accountModal as HTMLElement).queryByText('projectSpace.operation.accountForm.field.platform')
    ).not.toBeInTheDocument();
    expect(within(accountModal as HTMLElement).queryAllByRole('radio')).toHaveLength(0);
    expect(
      await within(accountModal as HTMLElement).findByLabelText(
        'projectSpace.operation.accountForm.field.customLinkName'
      )
    ).toBeInTheDocument();
    expect(
      within(accountModal as HTMLElement).getByLabelText('projectSpace.operation.accountForm.field.customUrl')
    ).toBeInTheDocument();
    fireEvent.change(
      within(accountModal as HTMLElement).getByLabelText('projectSpace.operation.accountForm.field.customLinkName'),
      {
        target: { value: '微信公众号' },
      }
    );
    fireEvent.change(
      within(accountModal as HTMLElement).getByLabelText('projectSpace.operation.accountForm.field.customUrl'),
      {
        target: { value: 'https://mp.weixin.qq.com/' },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.accountForm.save' }));

    await waitFor(() =>
      expect(mockCreateGlobalOperationAccount).toHaveBeenCalledWith({
        platformCode: 'CustomLink',
        accountCode: '',
        accountName: '微信公众号',
        customUrl: 'https://mp.weixin.qq.com/',
      })
    );
    expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(2);
  });

  it('edits a global custom account with its platform fixed and refreshes the cards', async () => {
    render(<ConnectorControl canAuthorize />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByText('查看全部连接器'));
    fireEvent.mouseEnter(await screen.findByRole('button', { name: '账号操作' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByText('projectSpace.operation.account.edit'));

    expect(screen.queryByText('projectSpace.operation.accountForm.field.platform')).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('projectSpace.operation.accountForm.field.customLinkName'), {
      target: { value: 'IMA 知识库' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.accountForm.save' }));

    await waitFor(() =>
      expect(mockUpdateOperationAccount).toHaveBeenCalledWith({
        accountId: 7,
        platformCode: 'CustomLink',
        accountCode: '',
        accountName: 'IMA 知识库',
        customUrl: 'https://ima.qq.com/wikis/',
      })
    );
    expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(2);
  });

  it('confirms and deletes a global account before refreshing the cards', async () => {
    let resolveDelete!: () => void;
    mockDeleteOperationAccount.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    render(<ConnectorControl canAuthorize />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByText('查看全部连接器'));
    fireEvent.mouseEnter(await screen.findByRole('button', { name: '账号操作' }));
    fireEvent.click(await screen.findByText('projectSpace.operation.account.delete'));
    expect(await screen.findAllByText('projectSpace.operation.account.deleteConfirmTitle')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.account.deleteConfirmOk' }));

    await waitFor(() => expect(mockDeleteOperationAccount).toHaveBeenCalledWith(7));
    expect(screen.getByRole('button', { name: '账号操作' })).toHaveClass('ant-btn-loading');
    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(2));
    expect(mockMessageSuccess).toHaveBeenCalledWith('projectSpace.operation.account.deleteSuccess');
  });

  it('keeps the account available when deleting it fails', async () => {
    mockDeleteOperationAccount.mockRejectedValueOnce(new Error('delete failed'));
    render(<ConnectorControl canAuthorize />);

    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByText('查看全部连接器'));
    fireEvent.mouseEnter(await screen.findByRole('button', { name: '账号操作' }));
    fireEvent.click(await screen.findByText('projectSpace.operation.account.delete'));
    fireEvent.click(await screen.findByRole('button', { name: 'projectSpace.operation.account.deleteConfirmOk' }));

    await waitFor(() => expect(mockDeleteOperationAccount).toHaveBeenCalledWith(7));
    expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(1);
    expect(screen.getByText('ima')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '账号操作' })).not.toHaveClass('ant-btn-loading'));
  });

  it('keeps the refreshed account list when the initial request resolves last', async () => {
    const initialAccounts = [
      {
        accountId: 7,
        platformCode: 'CustomLink',
        accountName: 'ima',
        accountCode: 'custom',
        customUrl: 'https://ima.qq.com/wikis/',
        loginStatus: 'online',
      },
    ];
    const refreshedAccounts = [
      ...initialAccounts,
      {
        accountId: 8,
        platformCode: 'CustomLink',
        accountName: '微信公众号',
        accountCode: 'custom',
        customUrl: 'https://mp.weixin.qq.com/',
        loginStatus: 'online',
      },
    ];
    let resolveInitialRequest!: (accounts: typeof initialAccounts) => void;
    let resolveRefreshRequest!: (accounts: typeof refreshedAccounts) => void;
    mockListGlobalOperationAccounts
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialRequest = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefreshRequest = resolve;
          })
      );

    const { unmount } = render(<ConnectorControl canAuthorize />);

    try {
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      fireEvent.click(await screen.findByText('查看全部连接器'));
      await waitFor(() => expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(1));

      fireEvent.click(await screen.findByRole('button', { name: /新增账号/ }));
      expect(screen.queryByText('projectSpace.operation.accountForm.field.platform')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      fireEvent.change(screen.getByLabelText('projectSpace.operation.accountForm.field.customLinkName'), {
        target: { value: '微信公众号' },
      });
      fireEvent.change(screen.getByLabelText('projectSpace.operation.accountForm.field.customUrl'), {
        target: { value: 'https://mp.weixin.qq.com/' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.accountForm.save' }));

      await waitFor(() => expect(mockListGlobalOperationAccounts).toHaveBeenCalledTimes(2));
      await act(async () => {
        resolveRefreshRequest(refreshedAccounts);
        await Promise.resolve();
      });
      expect(await screen.findByText('微信公众号')).toBeInTheDocument();

      await act(async () => {
        resolveInitialRequest(initialAccounts);
        await Promise.resolve();
      });
      expect(screen.getByText('微信公众号')).toBeInTheDocument();
    } finally {
      unmount();
    }
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

  it('prioritizes enabled connectors in the three-item chat preview', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 1,
          connectorCode: 'lark',
          connectorName: '飞书',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: null,
        },
        {
          connectorId: 2,
          connectorCode: 'wecom',
          connectorName: '企业微信',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: null,
        },
        {
          connectorId: 3,
          connectorCode: 'dingtalk',
          connectorName: '钉钉',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: null,
        },
        {
          connectorId: 4,
          connectorCode: 'github',
          connectorName: 'GitHub',
          connectorType: 'SYSTEM',
          description: '',
          enableFlag: 'Y',
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 4,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);

    fireEvent.click(await screen.findByRole('button', { name: '查看已连接连接器' }));
    const dialog = screen.getByRole('dialog', { name: '连接器设置' });

    expect(await within(dialog).findByText('GitHub')).toBeInTheDocument();
    expect(within(dialog).getByText('飞书')).toBeInTheDocument();
    expect(within(dialog).getByText('企业微信')).toBeInTheDocument();
    expect(within(dialog).queryByText('钉钉')).not.toBeInTheDocument();
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
      fireEvent.click(within(authorizationDialog as HTMLElement).getByRole('button', { name: 'Close' }));

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
    const closeButton = within(authorizationDialog as HTMLElement).getByRole('button', { name: 'Close' });
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
    fireEvent.click(within(repeatedAuthorizationDialog as HTMLElement).getByRole('button', { name: 'Close' }));

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

  it('opens the IMA credential form from validated list metadata', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));

    const credentialHeading = await screen.findByRole('heading', { name: '连接 IMA' });
    expect(credentialHeading).toBeInTheDocument();
    expect(credentialHeading.closest('.ant-modal')).toHaveStyle({ width: '480px' });
    expect(screen.getByLabelText('Client ID')).toHaveAttribute('maxLength', '256');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByRole('link', { name: '前往IMA获取凭据' })).toHaveAttribute('href', 'https://ima.qq.com/openapi');
  });

  it('does not submit an empty IMA credential form', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存并连接' }));

    await screen.findByText('请输入Client ID');
    await waitFor(() => expect(mockStartConnectorAuthorization).not.toHaveBeenCalled());
  });

  it('submits IMA credentials once, closes on synchronous success, and refreshes the catalog', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    mockStartConnectorCredentialAuthorization.mockResolvedValue({
      authorizationId: 'ima-authorization-10',
      connectorId: 10,
      status: 'connected',
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'api-key' } });
    const queryCountBeforeSubmit = mockQueryAllConnectors.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));

    await waitFor(() => {
      expect(mockStartConnectorCredentialAuthorization).toHaveBeenCalledWith({
        connectorId: 10,
        redirectUrl: window.location.origin,
        credentials: { clientId: 'client-id', apiKey: 'api-key' },
        cancelToken: expect.any(AbortController),
      });
    });
    expect(mockStartConnectorAuthorization).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('heading', { name: '连接 IMA' })).not.toBeInTheDocument());
    await waitFor(() => expect(mockQueryAllConnectors.mock.calls.length).toBeGreaterThan(queryCountBeforeSubmit));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    expect(await screen.findByLabelText('Client ID')).toHaveValue('');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(mockGetConnectorAuthorization).not.toHaveBeenCalled();
    expect(mockMessageSuccess).toHaveBeenCalledWith('IMA 已连接');
  });

  it('clears IMA credential fields when credential verification fails without exposing the request error', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    mockStartConnectorCredentialAuthorization.mockRejectedValue('api-key-must-not-be-shown');

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'api-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));

    await waitFor(() => expect(mockMessageError).toHaveBeenCalledWith('IMA 凭据验证失败，请检查后重试'));
    expect(mockStartConnectorCredentialAuthorization).toHaveBeenCalledTimes(1);
    expect(mockStartConnectorAuthorization).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Client ID')).toHaveValue('');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.queryByText('api-key-must-not-be-shown')).not.toBeInTheDocument();
  });

  it('clears IMA credential fields when the credential modal is cancelled', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
    const credentialDialog = screen.getByRole('heading', { name: '连接 IMA' }).closest('[role="dialog"]');
    expect(credentialDialog).not.toBeNull();
    fireEvent.click(within(credentialDialog as HTMLElement).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    expect(await screen.findByLabelText('Client ID')).toHaveValue('');
  });

  it('keeps the existing OAuth authorization UI for non-IMA connectors', async () => {
    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));

    expect(await screen.findByRole('heading', { name: '连接 企业微信 作为 AI 知识库' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
  });

  it('opens and submits a generic dynamic credential form for Weixin Official Account API', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 12,
          connectorCode: 'weixin-official-api',
          connectorName: '微信公众号 API',
          connectorType: 'SYSTEM',
          description: '微信公众号官方 API',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://developers.weixin.qq.com/platform',
            helpLinkText: '前往微信开发者平台获取凭据',
            helpText:
              '连接器作用：安全保存公众号 AppID 和 AppSecret，并在启用时提供给数字员工。使用 bycli weixin create-draft 时会优先调用公众号官方 API 上传封面和正文图片、创建草稿；不会直接群发或正式发布文章，也不保存 access_token。\n\n获取步骤：\n1. 点击下方链接登录微信公众平台，使用公众号管理员或有开发权限的微信扫码。\n2. 登录后选择要连接的目标公众号，进入公众号后台。\n3. 打开“设置与开发” → “开发接口管理” → “基本配置”，找到公众号开发信息。\n4. 在开发者 ID 区域复制 AppID。\n5. 在 AppSecret 区域点击“查看”或“重置”，由管理员扫码确认后复制新值。\n6. 将 ByClaw 后端和任务沙箱出口 IP 加入 IP 白名单，避免 40164。\n7. 返回本页填写 AppID、AppSecret，点击“保存并连接”。\n\n安全提示：AppSecret 相当于 API 密码，请勿发送到聊天、截图、工单或代码仓库。重置后旧值失效，需要重新连接。',
            fields: [
              { key: 'appId', label: 'AppID', inputType: 'text', maxLength: 256 },
              { key: 'appSecret', label: 'AppSecret', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    mockStartConnectorCredentialAuthorization.mockResolvedValue({
      authorizationId: 'weixin-authorization-12',
      connectorId: 12,
      status: 'connected',
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));

    const credentialHeading = await screen.findByRole('heading', { name: '连接 微信公众号 API' });
    expect(credentialHeading).toBeInTheDocument();
    expect(credentialHeading.closest('.ant-modal')).toHaveStyle({ width: '640px' });
    const helpCard = screen.getByRole('region', { name: '凭据获取说明' });
    expect(helpCard).toHaveClass('credentialHelpCard');
    expect(screen.getByRole('heading', { name: '连接器作用' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '获取步骤' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('heading', { name: '安全提示' }).parentElement).toHaveClass('warningSection');
    expect(helpCard).toHaveTextContent('“设置与开发” → “开发接口管理” → “基本配置”');
    expect(helpCard).toHaveTextContent('不会直接群发或正式发布文章');
    expect(screen.getByRole('link', { name: '前往微信开发者平台获取凭据' })).toHaveAttribute(
      'href',
      'https://developers.weixin.qq.com/platform'
    );
    expect(helpCard.parentElement).toHaveClass('credentialFormBody');
    expect(screen.getByRole('button', { name: '保存并连接' }).parentElement).toHaveClass('credentialActions');
    fireEvent.change(screen.getByLabelText('AppID'), { target: { value: 'wx-app' } });
    fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'wx-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));

    await waitFor(() =>
      expect(mockStartConnectorCredentialAuthorization).toHaveBeenCalledWith({
        connectorId: 12,
        redirectUrl: window.location.origin,
        credentials: { appId: 'wx-app', appSecret: 'wx-secret' },
        cancelToken: expect.any(AbortController),
      })
    );
  });

  it('uses the common help card for unstructured credential guidance', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 13,
          connectorCode: 'generic-credential-connector',
          connectorName: '通用凭据连接器',
          connectorType: 'SYSTEM',
          description: '通用凭据连接器',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://example.com/credentials',
            helpText: '普通凭据说明',
            fields: [{ key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 }],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));

    const helpCard = await screen.findByRole('region', { name: '凭据获取说明' });
    expect(helpCard).toHaveClass('credentialHelpCard');
    expect(helpCard).toHaveTextContent('普通凭据说明');
  });

  it.each([
    ['CONNECTOR_CREDENTIAL_INVALID', 'AppID 或 AppSecret 无效，请检查后重试'],
    ['WEIXIN_IP_NOT_ALLOWLISTED', '请将 ByClaw 后端出口 IP 加入公众号 IP 白名单后重试'],
    ['CONNECTOR_VERIFICATION_TIMEOUT', '微信接口暂时不可用，凭据未保存，请稍后重试'],
    ['CONNECTOR_VERIFICATION_FAILED', '微信接口暂时不可用，凭据未保存，请稍后重试'],
    ['PROVIDER_PROTOCOL_ERROR', '微信公众号 API 凭据验证失败，请检查后重试'],
  ])('maps Weixin credential error %s to safe copy', async (errorCode, expected) => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 12,
          connectorCode: 'weixin-official-api',
          connectorName: '微信公众号 API',
          connectorType: 'SYSTEM',
          description: '微信公众号官方 API',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://developers.weixin.qq.com/platform',
            fields: [
              { key: 'appId', label: 'AppID', inputType: 'text', maxLength: 256 },
              { key: 'appSecret', label: 'AppSecret', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    mockStartConnectorCredentialAuthorization.mockResolvedValue({
      authorizationId: 'wx-failed',
      connectorId: 12,
      status: 'failed',
      errorCode,
      errorMessage: 'wx-secret must not be rendered',
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.change(screen.getByLabelText('AppID'), { target: { value: 'wx-app' } });
    fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'wx-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));

    await waitFor(() => expect(mockMessageError).toHaveBeenCalledWith(expected));
    expect(screen.queryByText(/wx-secret must not be rendered/)).not.toBeInTheDocument();
  });

  it('explains Weixin AppSecret revocation scope before unlinking', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 12,
          connectorCode: 'weixin-official-api',
          connectorName: '微信公众号 API',
          connectorType: 'SYSTEM',
          description: '微信公众号官方 API',
          enableFlag: 'Y',
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://developers.weixin.qq.com/platform',
            fields: [
              { key: 'appId', label: 'AppID', inputType: 'text', maxLength: 256 },
              { key: 'appSecret', label: 'AppSecret', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '更多微信公众号 API操作' }));
    fireEvent.click(await screen.findByText('取消授权'));

    expect(
      await screen.findByText('仅移除 ByClaw 保存的凭据，微信公众平台上的 AppSecret 仍保持有效')
    ).toBeInTheDocument();
    Modal.destroyAll();
  });

  it('does not show IMA revocation copy for another AK_SK connector', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 11,
          connectorCode: 'another-ak-sk',
          connectorName: '其他凭据连接器',
          connectorType: 'SYSTEM',
          description: '其他知识库',
          enableFlag: 'Y',
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://example.com/credentials',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '更多其他凭据连接器操作' }));
    fireEvent.click(await screen.findByText('取消授权'));

    expect(await screen.findByText('仅移除 ByClaw 保存的凭据，第三方平台上的凭据仍保持有效。')).toBeInTheDocument();
    expect(screen.queryByText('仅移除 ByClaw 保存的凭据，IMA 网站上的 API Key 仍保持有效。')).not.toBeInTheDocument();
    const refreshCount = mockQueryAllConnectors.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '确认取消授权' }));
    await waitFor(() => expect(mockRevokeConnectorAuthorization).toHaveBeenCalledWith(11));
    await waitFor(() => expect(mockQueryAllConnectors.mock.calls.length).toBeGreaterThan(refreshCount));
    Modal.destroyAll();
  });

  it('explains IMA API key revocation scope before unlinking', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: 'Y',
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await screen.findByText('IMA');
    fireEvent.click(await screen.findByRole('button', { name: '更多IMA操作' }));
    fireEvent.click(await screen.findByText('取消授权'));

    expect(await screen.findByText('仅移除 ByClaw 保存的凭据，IMA 网站上的 API Key 仍保持有效。')).toBeInTheDocument();
    const refreshCount = mockQueryAllConnectors.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '确认取消授权' }));
    await waitFor(() => expect(mockRevokeConnectorAuthorization).toHaveBeenCalledWith(10));
    await waitFor(() => expect(mockQueryAllConnectors.mock.calls.length).toBeGreaterThan(refreshCount));
    Modal.destroyAll();
  });

  it('closes local authorization from malformed IMA metadata', async () => {
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '连接 IMA 作为 AI 知识库' })).not.toBeInTheDocument()
    );
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即前往授权' })).not.toBeInTheDocument();
  });

  it.each(['', 'javascript:alert(1)', 'data:text/plain,credentials', '/ima/openapi', 'not a valid URL'])(
    'closes local authorization when the IMA help URL is unsafe: %s',
    async (helpUrl) => {
      mockQueryConnectorList.mockResolvedValue({
        list: [
          {
            connectorId: 10,
            connectorCode: 'ima-openapi',
            connectorName: 'IMA',
            connectorType: 'SYSTEM',
            description: 'IMA 知识库',
            enableFlag: null,
            authMode: 'AK_SK',
            credentialForm: {
              helpUrl,
              fields: [
                { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
                { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
              ],
            },
          },
        ],
        pageNum: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      });

      render(<ConnectorControl canAuthorize />);
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      fireEvent.click(await screen.findByRole('button', { name: '连接' }));

      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: '连接 IMA 作为 AI 知识库' })).not.toBeInTheDocument()
      );
      expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '立即前往授权' })).not.toBeInTheDocument();
    }
  );

  it('submits delayed IMA credential verification only once', async () => {
    let resolveCredentialVerification!: (authorization: ConnectorAuthorization) => void;
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    mockStartConnectorCredentialAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCredentialVerification = resolve;
        })
    );

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'api-key' } });
    const submitButton = screen.getByRole('button', { name: '保存并连接' });
    await act(async () => {
      fireEvent.click(submitButton);
      fireEvent.click(submitButton);
      await Promise.resolve();
    });

    await waitFor(() => expect(mockStartConnectorCredentialAuthorization).toHaveBeenCalledTimes(1));
    expect(mockStartConnectorAuthorization).not.toHaveBeenCalled();

    await act(async () => {
      resolveCredentialVerification({ authorizationId: 'ima-authorization-10', connectorId: 10, status: 'connected' });
      await Promise.resolve();
    });
  });

  it('keeps the IMA credential modal open while credential verification is in progress', async () => {
    let resolveCredentialVerification!: (authorization: ConnectorAuthorization) => void;
    let cancelToken: AbortController | undefined;
    mockQueryConnectorList.mockResolvedValue({
      list: [
        {
          connectorId: 10,
          connectorCode: 'ima-openapi',
          connectorName: 'IMA',
          connectorType: 'SYSTEM',
          description: 'IMA 知识库',
          enableFlag: null,
          authMode: 'AK_SK',
          credentialForm: {
            helpUrl: 'https://ima.qq.com/openapi',
            fields: [
              { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
              { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
            ],
          },
        },
      ],
      pageNum: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    mockStartConnectorCredentialAuthorization.mockImplementation((payload) => {
      cancelToken = payload.cancelToken;
      return new Promise((resolve) => {
        resolveCredentialVerification = resolve;
      });
    });

    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
      fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'api-key' } });
      fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockStartConnectorCredentialAuthorization).toHaveBeenCalledTimes(1));
    expect(cancelToken).toBeDefined();

    const messageSuccessCount = mockMessageSuccess.mock.calls.length;
    const refreshCount = mockQueryAllConnectors.mock.calls.length;
    const credentialDialog = screen.getByRole('heading', { name: '连接 IMA' }).closest('[role="dialog"]');
    expect(credentialDialog).not.toBeNull();
    const closeButton = within(credentialDialog as HTMLElement).queryByRole('button', { name: 'Close' });
    if (closeButton) {
      await act(async () => {
        fireEvent.click(closeButton);
        await Promise.resolve();
      });
    }
    expect(cancelToken?.signal.aborted).toBe(false);
    expect(screen.getByRole('heading', { name: '连接 IMA' })).toBeInTheDocument();

    await act(async () => {
      resolveCredentialVerification({ authorizationId: 'ima-authorization-10', connectorId: 10, status: 'connected' });
      await Promise.resolve();
    });
    expect(mockMessageSuccess).toHaveBeenCalledTimes(messageSuccessCount + 1);
    expect(mockQueryAllConnectors).toHaveBeenCalledTimes(refreshCount + 1);
  });

  it.each(['permission is lost', 'the component directly unmounts'])(
    'aborts an in-flight IMA credential verification when %s',
    async (mode) => {
      let cancelToken: AbortController | undefined;
      let resolveCredentialVerification!: (authorization: ConnectorAuthorization) => void;
      mockQueryConnectorList.mockResolvedValue({
        list: [
          {
            connectorId: 10,
            connectorCode: 'ima-openapi',
            connectorName: 'IMA',
            connectorType: 'SYSTEM',
            description: 'IMA 知识库',
            enableFlag: null,
            authMode: 'AK_SK',
            credentialForm: {
              helpUrl: 'https://ima.qq.com/openapi',
              fields: [
                { key: 'clientId', label: 'Client ID', inputType: 'text', maxLength: 256 },
                { key: 'apiKey', label: 'API Key', inputType: 'password', maxLength: 2048 },
              ],
            },
          },
        ],
        pageNum: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      });
      mockStartConnectorCredentialAuthorization.mockImplementation((payload) => {
        cancelToken = payload.cancelToken;
        return new Promise((resolve) => {
          resolveCredentialVerification = resolve;
        });
      });

      const { rerender, unmount } = render(<ConnectorControl canAuthorize />);
      fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
      fireEvent.click(await screen.findByRole('button', { name: '连接' }));
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
        fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'api-key' } });
        fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
        await Promise.resolve();
      });
      await waitFor(() => expect(mockStartConnectorCredentialAuthorization).toHaveBeenCalledTimes(1));

      const messageSuccessCount = mockMessageSuccess.mock.calls.length;
      const refreshCount = mockQueryAllConnectors.mock.calls.length;
      expect(cancelToken?.signal.aborted).toBe(false);
      if (mode === 'permission is lost') {
        rerender(<ConnectorControl canAuthorize={false} />);
      } else {
        unmount();
      }
      expect(cancelToken?.signal.aborted).toBe(true);
      await act(async () => {
        resolveCredentialVerification({
          authorizationId: 'ima-authorization-10',
          connectorId: 10,
          status: 'connected',
        });
        await Promise.resolve();
      });
      expect(mockMessageSuccess).toHaveBeenCalledTimes(messageSuccessCount);
      expect(mockQueryAllConnectors).toHaveBeenCalledTimes(refreshCount);
    }
  );

  it.each([
    ['the schema becomes invalid', { authMode: 'AK_SK', credentialForm: { helpUrl: '', fields: [] } }],
    ['the connector is replaced', { connectorCode: 'replacement-connector', authMode: null, credentialForm: null }],
  ])('aborts deferred IMA credentials when %s', async (_reason, update) => {
    let resolveCredentialVerification!: (authorization: ConnectorAuthorization) => void;
    let cancelToken: AbortController | undefined;
    const initial = {
      connectorId: 10,
      connectorCode: 'ima-openapi',
      connectorName: 'IMA',
      connectorType: 'SYSTEM' as const,
      description: 'IMA 知识库',
      enableFlag: null,
      authMode: 'AK_SK',
      credentialForm: {
        helpUrl: 'https://ima.qq.com/openapi',
        fields: [
          { key: 'clientId' as const, label: 'Client ID', inputType: 'text' as const, maxLength: 256 },
          { key: 'apiKey' as const, label: 'API Key', inputType: 'password' as const, maxLength: 2048 },
        ],
      },
    };
    mockQueryAllConnectors
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([{ ...initial, ...update }] as any);
    mockStartConnectorCredentialAuthorization.mockImplementation((payload) => {
      cancelToken = payload.cancelToken;
      return new Promise((resolve) => {
        resolveCredentialVerification = resolve;
      });
    });
    render(<ConnectorControl canAuthorize />);
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'api-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
    await waitFor(() => expect(cancelToken).toBeDefined());
    const successCount = mockMessageSuccess.mock.calls.length;
    const refreshCount = mockQueryAllConnectors.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '连接器设置' }));
    await waitFor(() => expect(cancelToken?.signal.aborted).toBe(true));
    await act(async () => {
      resolveCredentialVerification({ authorizationId: 'late', connectorId: 10, status: 'connected' });
    });
    expect(mockMessageSuccess).toHaveBeenCalledTimes(successCount);
    expect(mockQueryAllConnectors).toHaveBeenCalledTimes(refreshCount + 1);
  });
});
