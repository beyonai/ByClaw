import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import PersonalEmailSettings from '..';
import {
  checkPersonalEmailConnection,
  deletePersonalEmailAccount,
  type MailProvider,
  queryMailProviders,
  queryPersonalEmailAccounts,
  savePersonalEmailAccount,
  setDefaultPersonalEmailAccount,
} from '@/service/personalEmail';
import { getConnectorAuthorization, queryAllConnectors, startConnectorAuthorization } from '@/service/connector';

jest.setTimeout(90000);

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/service/personalEmail', () => ({
  queryPersonalEmailAccounts: jest.fn(),
  queryMailProviders: jest.fn(),
  savePersonalEmailAccount: jest.fn(),
  deletePersonalEmailAccount: jest.fn(),
  setDefaultPersonalEmailAccount: jest.fn(),
  checkPersonalEmailConnection: jest.fn(),
}));

jest.mock('@/service/connector', () => ({
  queryAllConnectors: jest.fn(),
  startConnectorAuthorization: jest.fn(),
  getConnectorAuthorization: jest.fn(),
}));

const providers: MailProvider[] = [
  {
    code: 'gmail',
    name: 'Gmail',
    transport: 'Gmail API',
    authType: 'OAUTH2',
    connectorCode: 'gmail-mail',
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply', 'delete'],
    capabilityStatus: {
      list: 'YES',
      get: 'YES',
      search: 'YES',
      downloadAttachment: 'YES',
      send: 'YES',
      reply: 'YES',
      delete: 'YES',
    },
    setupRequirements: ['AUTHORIZE_OAUTH2'],
    advancedServerEditable: false,
  },
  {
    code: 'fastmail',
    name: 'Fastmail',
    transport: 'JMAP',
    authType: 'API_TOKEN',
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply', 'delete'],
    capabilityStatus: { list: 'YES', delete: 'YES' },
    setupRequirements: ['CREATE_API_TOKEN'],
    advancedServerEditable: false,
  },
  {
    code: 'qq',
    name: 'QQ Mail',
    transport: 'IMAP_SMTP',
    authType: 'APP_PASSWORD',
    imap: { host: 'imap.qq.com', port: 993, encryption: 'tls' },
    smtp: { host: 'smtp.qq.com', port: 465, encryption: 'tls' },
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply'],
    capabilityStatus: { list: 'YES', delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
    setupRequirements: ['ENABLE_IMAP_SMTP', 'USE_AUTHORIZATION_CODE'],
    advancedServerEditable: false,
  },
  {
    code: 'netease-163',
    name: 'NetEase 163 Mail',
    transport: 'IMAP_SMTP',
    authType: 'APP_PASSWORD',
    imap: { host: 'imap.163.com', port: 993, encryption: 'tls' },
    smtp: { host: 'smtp.163.com', port: 465, encryption: 'tls' },
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply'],
    capabilityStatus: { list: 'YES', delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
    setupRequirements: ['ENABLE_IMAP_SMTP', 'USE_AUTHORIZATION_CODE'],
    advancedServerEditable: false,
  },
  {
    code: 'aliyun-mail',
    name: 'Aliyun Mail',
    transport: 'IMAP_SMTP',
    authType: 'APP_PASSWORD',
    imap: { host: 'imap.qiye.aliyun.com', port: 993, encryption: 'tls' },
    smtp: { host: 'smtp.qiye.aliyun.com', port: 465, encryption: 'tls' },
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply'],
    capabilityStatus: { list: 'YES', delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
    setupRequirements: ['ADMIN_ENABLE_THIRD_PARTY_CLIENT', 'USE_SECURITY_PASSWORD'],
    advancedServerEditable: false,
  },
  {
    code: 'microsoft-365',
    name: 'Microsoft 365',
    transport: 'GRAPH',
    authType: 'OAUTH2',
    connectorCode: 'microsoft-mail',
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply', 'delete'],
    capabilityStatus: { list: 'YES', delete: 'YES' },
    setupRequirements: ['AUTHORIZE_OAUTH2'],
    advancedServerEditable: false,
  },
  {
    code: 'iwhalecloud',
    name: 'iWhaleCloud',
    transport: 'EXCHANGE_EWS_OWA',
    authType: 'BROWSER_SSO',
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply', 'delete'],
    capabilityStatus: { list: 'CONDITIONAL_EWS_ENTERPRISE_AUTH_OR_BROWSER_SSO' },
    setupRequirements: ['SIGN_IN_WITH_BROWSER_OR_CONFIGURE_EWS'],
    advancedServerEditable: false,
  },
  {
    code: 'custom-imap',
    name: 'Custom IMAP',
    transport: 'IMAP_SMTP',
    authType: 'APP_PASSWORD',
    capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply'],
    capabilityStatus: { list: 'YES', delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
    setupRequirements: ['PROVIDE_IMAP_SMTP_SETTINGS', 'USE_APP_PASSWORD'],
    advancedServerEditable: true,
  },
];

const mockQueryAccounts = queryPersonalEmailAccounts as jest.MockedFunction<typeof queryPersonalEmailAccounts>;
const mockQueryProviders = queryMailProviders as jest.MockedFunction<typeof queryMailProviders>;
const mockSave = savePersonalEmailAccount as jest.MockedFunction<typeof savePersonalEmailAccount>;
const mockCheck = checkPersonalEmailConnection as jest.MockedFunction<typeof checkPersonalEmailConnection>;
const mockDelete = deletePersonalEmailAccount as jest.MockedFunction<typeof deletePersonalEmailAccount>;
const mockSetDefault = setDefaultPersonalEmailAccount as jest.MockedFunction<typeof setDefaultPersonalEmailAccount>;
const mockQueryConnectors = queryAllConnectors as jest.MockedFunction<typeof queryAllConnectors>;
const mockStartAuthorization = startConnectorAuthorization as jest.MockedFunction<typeof startConnectorAuthorization>;
const mockGetAuthorization = getConnectorAuthorization as jest.MockedFunction<typeof getConnectorAuthorization>;

const openCreate = async () => {
  render(<PersonalEmailSettings />);
  await screen.findByRole('button', { name: 'settings.email.addAccount' });
  fireEvent.click(screen.getByRole('button', { name: 'settings.email.addAccount' }));
  await screen.findByLabelText('邮箱服务商');
};

const chooseProvider = async (name: string) => {
  fireEvent.mouseDown(screen.getByLabelText('邮箱服务商'));
  fireEvent.click(screen.getByText(name));
  await screen.findByRole('region', { name: `${name}设置` });
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('PersonalEmailSettings provider-first flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryAccounts.mockResolvedValue([]);
    mockQueryProviders.mockResolvedValue(providers.map((provider) => ({ ...provider })));
    mockSave.mockResolvedValue({ accountId: 1, email: 'person@example.com' });
    mockCheck.mockResolvedValue({ connectionState: 'READY', lastCheckTime: '2026-09-01T10:00:00+08:00' });
    mockQueryConnectors.mockResolvedValue([]);
    mockGetAuthorization.mockResolvedValue({ authorizationId: 'auth-1', connectorId: 91, status: 'connected' });
  });

  it('loads the provider catalog only once when the modal first opens', async () => {
    render(<PersonalEmailSettings />);
    await waitFor(() => expect(mockQueryAccounts).toHaveBeenCalledTimes(1));
    expect(mockQueryProviders).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'settings.email.addAccount' }));
    await waitFor(() => expect(mockQueryProviders).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.email.addAccount' }));
    await screen.findByLabelText('邮箱服务商');
    expect(mockQueryProviders).toHaveBeenCalledTimes(1);
  });

  it('shows a stable provider identity in the initial table without loading the modal catalog', async () => {
    mockQueryAccounts.mockResolvedValueOnce([
      { accountId: 1, name: 'QQ', email: 'person@qq.com', providerCode: 'qq', default: true },
      {
        accountId: 2,
        name: 'Hosted',
        email: 'person@hosted.example',
        providerCode: 'hosted-mail',
      },
    ]);

    render(<PersonalEmailSettings />);

    expect(await screen.findByText('QQ邮箱')).toBeInTheDocument();
    expect(screen.getByText('hosted-mail')).toBeInTheDocument();
    expect(screen.queryByText('未知服务商')).not.toBeInTheDocument();
    expect(mockQueryProviders).not.toHaveBeenCalled();
  });

  it('waits for the initial account load before deriving the first-account default', async () => {
    const accountsRequest = deferred<Awaited<ReturnType<typeof queryPersonalEmailAccounts>>>();
    mockQueryAccounts.mockReturnValueOnce(accountsRequest.promise);

    render(<PersonalEmailSettings />);
    const addButton = screen.getByRole('button', { name: 'settings.email.addAccount' });
    expect(addButton).toBeDisabled();

    await act(async () => {
      accountsRequest.resolve([
        { accountId: 1, name: 'Existing', email: 'existing@example.com', providerCode: 'custom-imap', default: true },
      ]);
    });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);
    await screen.findByLabelText('邮箱服务商');
    expect(screen.getByLabelText('settings.email.default')).not.toBeChecked();
  });

  it('keeps add guarded after an initial load failure and enables retry only after authoritative success', async () => {
    mockQueryAccounts.mockRejectedValueOnce(new Error('secret-bearing transport failure')).mockResolvedValueOnce([]);

    render(<PersonalEmailSettings />);

    expect(await screen.findByText('邮箱账号加载失败')).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: 'settings.email.addAccount' });
    expect(addButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试加载邮箱账号' }));
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);
    await screen.findByLabelText('邮箱服务商');
    expect(screen.getByLabelText('settings.email.default')).toBeChecked();
  });

  it('auto-detects 163 as a changeable default and submits no native server values', async () => {
    await openCreate();
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@163.com' } });

    expect(await screen.findByRole('region', { name: '网易163邮箱设置' })).toBeInTheDocument();
    expect(screen.queryByLabelText('IMAP服务器')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: '工作邮箱' } });
    fireEvent.change(screen.getByLabelText('授权码或应用密码'), { target: { value: 'app-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        name: '工作邮箱',
        email: 'person@163.com',
        providerCode: 'netease-163',
        authType: 'APP_PASSWORD',
        displayName: undefined,
        default: true,
        authCode: 'app-secret',
      })
    );
    await waitFor(() => expect(mockQueryAccounts).toHaveBeenCalledTimes(2));
  });

  it('does not overwrite a manually changed provider when the email domain changes', async () => {
    await openCreate();
    await chooseProvider('QQ邮箱');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@163.com' } });
    });
    expect(screen.getByRole('region', { name: 'QQ邮箱设置' })).toBeInTheDocument();
  });

  it('clears a stale automatic provider on an unknown domain but preserves a manual choice', async () => {
    await openCreate();
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@163.com' } });
    expect(await screen.findByRole('region', { name: '网易163邮箱设置' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@unknown.example' } });
    expect(await screen.findByRole('region', { name: '自定义 IMAP设置' })).toBeInTheDocument();

    await chooseProvider('Gmail');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'again@unknown.example' } });
    });
    expect(screen.getByRole('region', { name: 'Gmail设置' })).toBeInTheDocument();
  });

  it('preserves custom server fields while correcting an email that remains custom IMAP', async () => {
    await openCreate();
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'wrong@unknown.example' } });
    await screen.findByRole('region', { name: '自定义 IMAP设置' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('IMAP服务器'), { target: { value: 'imap.hosted.example' } });
      fireEvent.change(screen.getByLabelText('IMAP端口'), { target: { value: '993' } });
      fireEvent.change(screen.getByLabelText('SMTP服务器'), { target: { value: 'smtp.hosted.example' } });
      fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'right@hosted.example' } });
    });

    expect(screen.getByLabelText('IMAP服务器')).toHaveValue('imap.hosted.example');
    expect(screen.getByLabelText('IMAP端口')).toHaveValue('993');
    expect(screen.getByLabelText('SMTP服务器')).toHaveValue('smtp.hosted.example');
  });

  it('shows preset guidance while hiding native servers and exposes custom servers only on demand', async () => {
    await openCreate();
    await chooseProvider('QQ邮箱');
    expect(screen.getByText(/开启 IMAP\/SMTP/)).toBeInTheDocument();
    expect(screen.queryByLabelText('IMAP服务器')).not.toBeInTheDocument();

    await chooseProvider('自定义 IMAP');
    expect(screen.getByLabelText('IMAP服务器')).toBeInTheDocument();
    expect(screen.getByLabelText('SMTP服务器')).toBeInTheDocument();

    await chooseProvider('阿里邮箱');
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    expect(screen.getByText(/imap\.qiye\.aliyun\.com:993/)).toBeInTheDocument();
    expect(screen.getByText(/管理员开启第三方客户端/)).toBeInTheDocument();
  });

  it('removes plaintext encryption and requires a secure choice when editing legacy NONE values', async () => {
    mockQueryAccounts.mockResolvedValueOnce([
      {
        accountId: 6,
        name: 'Legacy custom',
        email: 'person@hosted.example',
        providerCode: 'custom-imap',
        authType: 'APP_PASSWORD',
        hasAuthCode: true,
        imap: { host: 'imap.hosted.example', port: 993, encryption: 'none' as never },
        smtp: { host: 'smtp.hosted.example', port: 465, encryption: 'NONE' as never },
      },
    ]);
    render(<PersonalEmailSettings />);
    await screen.findByText('person@hosted.example');
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    await screen.findByLabelText('IMAP加密');

    fireEvent.mouseDown(screen.getByLabelText('IMAP加密'));
    expect(screen.queryByText('None')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(mockSave).not.toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByLabelText('IMAP加密'));
    fireEvent.click(screen.getAllByText('TLS').at(-1) as HTMLElement);
    fireEvent.mouseDown(screen.getByLabelText('SMTP加密'));
    fireEvent.click(screen.getAllByText('STARTTLS').at(-1) as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0]).toMatchObject({
      imap: { encryption: 'tls' },
      smtp: { encryption: 'starttls' },
    });
  });

  it('uses password inputs and keeps an existing Fastmail token when no replacement is entered', async () => {
    mockQueryAccounts.mockResolvedValueOnce([
      {
        accountId: 7,
        name: 'Fastmail',
        email: 'person@fastmail.com',
        providerCode: 'fastmail',
        authType: 'API_TOKEN',
        hasAuthCode: true,
        default: true,
      },
    ]);
    render(<PersonalEmailSettings />);
    await screen.findByText('person@fastmail.com');
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    await screen.findByLabelText('API Token');
    expect(screen.getByLabelText('API Token')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][0]).not.toHaveProperty('authCode');
    await waitFor(() => expect(mockQueryAccounts).toHaveBeenCalledTimes(2));
  });

  it.each([
    {
      providerLabel: 'Gmail',
      providerCode: 'gmail',
      connectorCode: 'gmail-mail',
      connectorName: 'Gmail',
      email: 'person@gmail.com',
      authorizeButton: '使用 Google 授权并保存',
    },
    {
      providerLabel: 'Outlook / Microsoft 365',
      providerCode: 'microsoft-365',
      connectorCode: 'microsoft-mail',
      connectorName: 'Microsoft 365',
      email: 'person@outlook.com',
      authorizeButton: '使用 Microsoft 授权并保存',
    },
  ])(
    'authorizes $providerLabel with the existing connector flow and saves no credential material',
    async ({ providerLabel, providerCode, connectorCode, connectorName, email, authorizeButton }) => {
      mockQueryConnectors.mockResolvedValueOnce([
        {
          connectorId: 91,
          connectorCode,
          connectorName,
          connectorType: 'SYSTEM',
          description: connectorName,
          enableFlag: null,
        },
      ]);
      mockStartAuthorization.mockResolvedValueOnce({
        authorizationId: 'auth-1',
        connectorId: 91,
        status: 'connected',
      });
      await openCreate();
      await chooseProvider(providerLabel);
      fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: connectorName } });
      fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: email } });
      fireEvent.click(screen.getByRole('button', { name: authorizeButton }));

      await waitFor(() =>
        expect(mockStartAuthorization).toHaveBeenCalledWith({ connectorId: 91, redirectUrl: expect.any(String) })
      );
      await waitFor(() => expect(mockSave).toHaveBeenCalled());
      const payload = mockSave.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toMatchObject({ providerCode, authType: 'OAUTH2', email });
      expect(payload).not.toHaveProperty('credentialReference');
      expect(payload).not.toHaveProperty('accessToken');
      expect(payload).not.toHaveProperty('refreshToken');
      expect(payload).not.toHaveProperty('code');
      expect(payload).not.toHaveProperty('cookies');
      await waitFor(() => expect(mockQueryAccounts).toHaveBeenCalledTimes(2));
    }
  );

  it.each([
    [
      'Gmail',
      'gmail-mail',
      'person@gmail.com',
      '使用 Google 授权并保存',
      'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
    ],
    [
      'Outlook / Microsoft 365',
      'microsoft-mail',
      'person@outlook.com',
      '使用 Microsoft 授权并保存',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=safe',
    ],
  ])('opens only the grounded pending OAuth destination for %s', async (label, connectorCode, email, button, url) => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    mockQueryConnectors.mockResolvedValueOnce([
      {
        connectorId: 91,
        connectorCode,
        connectorName: label,
        connectorType: 'SYSTEM',
        description: label,
        enableFlag: null,
      },
    ]);
    mockStartAuthorization.mockResolvedValueOnce({
      authorizationId: 'pending-1',
      connectorId: 91,
      status: 'pending',
      authorizationUrl: url,
    });
    await openCreate();
    await chooseProvider(label);
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: label } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: button }));

    await waitFor(() => expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer'));
    open.mockRestore();
  });

  it.each([
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://user:password@accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com:8443/o/oauth2/v2/auth',
    'https://evil.example/o/oauth2/v2/auth',
    'https://accounts.google.com/evil',
    'not-a-url',
  ])('rejects an unsafe Gmail authorization destination: %s', async (url) => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    mockQueryConnectors.mockResolvedValueOnce([
      {
        connectorId: 91,
        connectorCode: 'gmail-mail',
        connectorName: 'Gmail',
        connectorType: 'SYSTEM',
        description: 'Gmail',
        enableFlag: null,
      },
    ]);
    mockStartAuthorization.mockResolvedValueOnce({
      authorizationId: 'pending-attack',
      connectorId: 91,
      status: 'pending',
      authorizationUrl: url,
    });
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: 'Gmail' } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 授权并保存' }));

    await waitFor(() => expect(mockStartAuthorization).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('ignores a stale OAuth response after email change and prevents duplicate authorization requests', async () => {
    const startRequest = deferred<Awaited<ReturnType<typeof startConnectorAuthorization>>>();
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    mockQueryConnectors.mockResolvedValueOnce([
      {
        connectorId: 91,
        connectorCode: 'gmail-mail',
        connectorName: 'Gmail',
        connectorType: 'SYSTEM',
        description: 'Gmail',
        enableFlag: null,
      },
    ]);
    mockStartAuthorization.mockReturnValueOnce(startRequest.promise);
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: 'Gmail' } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'first@gmail.com' } });
    const authorize = screen.getByRole('button', { name: '使用 Google 授权并保存' });
    fireEvent.click(authorize);
    fireEvent.click(authorize);
    await waitFor(() => expect(mockStartAuthorization).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'second@gmail.com' } });
    await act(async () => {
      startRequest.resolve({
        authorizationId: 'stale',
        connectorId: 91,
        status: 'pending',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=stale',
      });
    });

    await waitFor(() => expect(authorize).not.toBeDisabled());
    expect(open).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('invalidates a pending OAuth flow when the modal closes and reopens', async () => {
    const startRequest = deferred<Awaited<ReturnType<typeof startConnectorAuthorization>>>();
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    mockQueryConnectors.mockResolvedValueOnce([
      {
        connectorId: 91,
        connectorCode: 'gmail-mail',
        connectorName: 'Gmail',
        connectorType: 'SYSTEM',
        description: 'Gmail',
        enableFlag: null,
      },
    ]);
    mockStartAuthorization.mockReturnValueOnce(startRequest.promise);
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: 'Gmail' } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 授权并保存' }));
    await waitFor(() => expect(mockStartAuthorization).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.email.addAccount' }));
    await screen.findByLabelText('邮箱服务商');
    await act(async () => {
      startRequest.resolve({
        authorizationId: 'stale-close',
        connectorId: 91,
        status: 'pending',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=stale',
      });
    });

    await waitFor(() => expect(screen.getByLabelText('邮箱服务商')).toBeInTheDocument());
    expect(open).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('does not start authorization when the provider changes during connector lookup', async () => {
    const connectorRequest = deferred<Awaited<ReturnType<typeof queryAllConnectors>>>();
    mockQueryConnectors.mockReturnValueOnce(connectorRequest.promise);
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: 'Mail' } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 授权并保存' }));
    await waitFor(() => expect(mockQueryConnectors).toHaveBeenCalledTimes(1));
    await chooseProvider('Outlook / Microsoft 365');
    await act(async () => {
      connectorRequest.resolve([
        {
          connectorId: 91,
          connectorCode: 'gmail-mail',
          connectorName: 'Gmail',
          connectorType: 'SYSTEM',
          description: 'Gmail',
          enableFlag: null,
        },
      ]);
    });
    expect(mockStartAuthorization).not.toHaveBeenCalled();
  });

  it('deduplicates status checks and ignores a connected result after the bound email changes', async () => {
    const statusRequest = deferred<Awaited<ReturnType<typeof getConnectorAuthorization>>>();
    mockQueryConnectors.mockResolvedValueOnce([
      {
        connectorId: 91,
        connectorCode: 'gmail-mail',
        connectorName: 'Gmail',
        connectorType: 'SYSTEM',
        description: 'Gmail',
        enableFlag: null,
      },
    ]);
    mockStartAuthorization.mockResolvedValueOnce({
      authorizationId: 'pending-status',
      connectorId: 91,
      status: 'pending',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
    });
    mockGetAuthorization.mockReturnValueOnce(statusRequest.promise);
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: 'Gmail' } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'first@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 授权并保存' }));
    const statusButton = await screen.findByRole('button', { name: '检查授权状态' });
    fireEvent.click(statusButton);
    fireEvent.click(statusButton);
    expect(mockGetAuthorization).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'second@gmail.com' } });
    await act(async () => {
      statusRequest.resolve({ authorizationId: 'pending-status', connectorId: 91, status: 'connected' });
    });
    expect(mockSave).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('handles OAuth form validation locally without starting a request', async () => {
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 授权并保存' }));

    await screen.findByText('settings.email.addressRequired');
    expect(mockQueryConnectors).not.toHaveBeenCalled();
    expect(mockStartAuthorization).not.toHaveBeenCalled();
  });

  it('rejects an authorization response bound to a different connector', async () => {
    mockQueryConnectors.mockResolvedValueOnce([
      {
        connectorId: 91,
        connectorCode: 'gmail-mail',
        connectorName: 'Gmail',
        connectorType: 'SYSTEM',
        description: 'Gmail',
        enableFlag: null,
      },
    ]);
    mockStartAuthorization.mockResolvedValueOnce({
      authorizationId: 'wrong-connector',
      connectorId: 92,
      status: 'connected',
    });
    await openCreate();
    await chooseProvider('Gmail');
    fireEvent.change(screen.getByLabelText('settings.email.accountName'), { target: { value: 'Gmail' } });
    fireEvent.change(screen.getByLabelText('settings.email.address'), { target: { value: 'person@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 授权并保存' }));

    await waitFor(() => expect(mockStartAuthorization).toHaveBeenCalledTimes(1));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('shows honest capability and connection status, then isolates connection checking behind the service', async () => {
    mockQueryAccounts.mockResolvedValueOnce([
      {
        accountId: 8,
        name: 'QQ',
        email: 'person@qq.com',
        providerCode: 'qq',
        authType: 'APP_PASSWORD',
        capabilities: ['list', 'delete'],
        capabilityStatus: { list: 'YES', delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
        setupRequirements: ['ENABLE_IMAP_SMTP'],
        connectionState: 'FAILED',
        lastCheckTime: '2026-08-31T09:30:00+08:00',
        status: 'AUTH_REQUIRED',
        default: true,
      },
    ]);
    render(<PersonalEmailSettings />);
    const row = (await screen.findByText('person@qq.com')).closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('收取列表')).toBeInTheDocument();
    expect(within(row).getByText('删除（需要服务器支持 MOVE 或 UIDPLUS）')).toBeInTheDocument();
    expect(within(row).getByText('连接失败：需要重新授权')).toBeInTheDocument();
    expect(within(row).getByText(/2026-08-31/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: '检查连接' }));
    await waitFor(() => expect(mockCheck).toHaveBeenCalledWith(8));
  });

  it('deduplicates a pending connection check and applies only its current result', async () => {
    const checkRequest = deferred<Awaited<ReturnType<typeof checkPersonalEmailConnection>>>();
    mockCheck.mockReturnValueOnce(checkRequest.promise);
    mockQueryAccounts.mockResolvedValueOnce([
      { accountId: 18, name: 'QQ', email: 'check@qq.com', providerCode: 'qq', connectionState: 'UNKNOWN' },
    ]);
    render(<PersonalEmailSettings />);
    const row = (await screen.findByText('check@qq.com')).closest('tr') as HTMLTableRowElement;
    const checkButton = within(row).getByRole('button', { name: '检查连接' });
    fireEvent.click(checkButton);
    fireEvent.click(checkButton);
    expect(mockCheck).toHaveBeenCalledTimes(1);

    await act(async () => {
      checkRequest.resolve({ connectionState: 'READY', lastCheckTime: '2026-09-01T12:00:00+08:00' });
    });
    expect(await within(row).findByText('连接就绪')).toBeInTheDocument();
    expect(within(row).getByText(/2026-09-01 12:00/)).toBeInTheDocument();
  });

  it.each(['AUTH_REQUIRED', 'UNAVAILABLE'])(
    'preserves catalog capability status when a %s check returns no capability map',
    async (status) => {
      mockCheck.mockResolvedValueOnce({
        connectionState: 'FAILED',
        status,
        capabilityStatus: {},
      });
      mockQueryAccounts.mockResolvedValueOnce([
        {
          accountId: 19,
          name: 'QQ',
          email: 'preserve@qq.com',
          providerCode: 'qq',
          capabilities: ['list'],
          capabilityStatus: { list: 'YES', search: 'CONDITIONAL_SERVER_SEARCH' },
        },
      ]);
      render(<PersonalEmailSettings />);
      const row = (await screen.findByText('preserve@qq.com')).closest('tr') as HTMLTableRowElement;
      fireEvent.click(within(row).getByRole('button', { name: '检查连接' }));
      await within(row).findByText(status === 'AUTH_REQUIRED' ? '连接失败：需要重新授权' : '连接失败：请检查设置');
      expect(within(row).getByText('搜索（需满足服务商条件）')).toBeInTheDocument();
    }
  );

  it('applies a non-empty authoritative capability update without spreading unknown response fields', async () => {
    mockCheck.mockResolvedValueOnce({
      connectionState: 'READY',
      capabilityStatus: { delete: 'YES' },
      unsafeUnknown: 'must-not-spread',
    } as Awaited<ReturnType<typeof checkPersonalEmailConnection>> & { unsafeUnknown: string });
    mockQueryAccounts.mockResolvedValueOnce([
      {
        accountId: 20,
        name: 'QQ',
        email: 'update@qq.com',
        providerCode: 'qq',
        capabilities: ['list'],
        capabilityStatus: { list: 'YES', delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
      },
    ]);
    render(<PersonalEmailSettings />);
    const row = (await screen.findByText('update@qq.com')).closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(row).getByRole('button', { name: '检查连接' }));
    await within(row).findByText('连接就绪');
    expect(within(row).getByText('删除')).toBeInTheDocument();
    expect(within(row).queryByText('删除（需要服务器支持 MOVE 或 UIDPLUS）')).not.toBeInTheDocument();
  });

  it('ignores non-canonical capability statuses returned by the service', async () => {
    mockCheck.mockResolvedValueOnce({
      connectionState: 'READY',
      capabilityStatus: { delete: 'UNTRUSTED' },
    } as unknown as Awaited<ReturnType<typeof checkPersonalEmailConnection>>);
    mockQueryAccounts.mockResolvedValueOnce([
      {
        accountId: 21,
        name: 'QQ',
        email: 'validate@qq.com',
        providerCode: 'qq',
        capabilities: ['list'],
        capabilityStatus: { delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
      },
    ]);
    render(<PersonalEmailSettings />);
    const row = (await screen.findByText('validate@qq.com')).closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(row).getByRole('button', { name: '检查连接' }));
    await within(row).findByText('连接就绪');
    expect(within(row).getByText('删除（需要服务器支持 MOVE 或 UIDPLUS）')).toBeInTheDocument();
  });

  it('bounds rejected account mutations and allows a safe retry', async () => {
    mockSetDefault.mockRejectedValueOnce(new Error('secret-bearing default failure')).mockResolvedValueOnce({});
    mockQueryAccounts.mockResolvedValue([
      { accountId: 21, name: 'One', email: 'one@qq.com', providerCode: 'qq', default: true },
      { accountId: 22, name: 'Two', email: 'two@qq.com', providerCode: 'qq', default: false },
    ]);
    render(<PersonalEmailSettings />);
    const secondRow = (await screen.findByText('two@qq.com')).closest('tr') as HTMLTableRowElement;
    const defaultButton = within(secondRow).getByRole('button', { name: 'settings.email.setDefault' });
    fireEvent.click(defaultButton);
    fireEvent.click(defaultButton);
    await waitFor(() => expect(mockSetDefault).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('邮箱账号操作失败，请稍后重试')).toBeInTheDocument();
    expect(screen.queryByText('secret-bearing default failure')).not.toBeInTheDocument();
    await waitFor(() => expect(defaultButton).toBeEnabled());
    fireEvent.click(defaultButton);
    await waitFor(() => expect(mockSetDefault).toHaveBeenCalledTimes(2));
  });

  it('globally locks set-default across accounts until the active mutation and reload finish', async () => {
    const firstMutation = deferred<Awaited<ReturnType<typeof setDefaultPersonalEmailAccount>>>();
    const secondMutation = deferred<Awaited<ReturnType<typeof setDefaultPersonalEmailAccount>>>();
    const firstReload = deferred<Awaited<ReturnType<typeof queryPersonalEmailAccounts>>>();
    mockSetDefault.mockReturnValueOnce(firstMutation.promise).mockReturnValueOnce(secondMutation.promise);
    const accounts = [
      { accountId: 41, name: 'Current', email: 'current@qq.com', providerCode: 'qq', default: true },
      { accountId: 42, name: 'Candidate A', email: 'candidate-a@qq.com', providerCode: 'qq', default: false },
      { accountId: 43, name: 'Candidate B', email: 'candidate-b@qq.com', providerCode: 'qq', default: false },
    ];
    mockQueryAccounts
      .mockResolvedValueOnce(accounts)
      .mockReturnValueOnce(firstReload.promise)
      .mockResolvedValue(accounts);
    render(<PersonalEmailSettings />);
    const rowA = (await screen.findByText('candidate-a@qq.com')).closest('tr') as HTMLTableRowElement;
    const rowB = screen.getByText('candidate-b@qq.com').closest('tr') as HTMLTableRowElement;
    const buttonA = within(rowA).getByRole('button', { name: 'settings.email.setDefault' });
    const buttonB = within(rowB).getByRole('button', { name: 'settings.email.setDefault' });

    fireEvent.click(buttonA);
    fireEvent.click(buttonB);
    expect(mockSetDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(buttonA).toBeDisabled();
      expect(buttonB).toBeDisabled();
    });

    await act(async () => {
      firstMutation.resolve({});
    });
    await waitFor(() => expect(mockQueryAccounts).toHaveBeenCalledTimes(2));
    expect(buttonA).toBeDisabled();
    expect(buttonB).toBeDisabled();
    fireEvent.click(buttonB);
    expect(mockSetDefault).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstReload.resolve(accounts);
    });
    await waitFor(() => {
      expect(buttonA).toBeEnabled();
      expect(buttonB).toBeEnabled();
    });
    fireEvent.click(buttonB);
    await waitFor(() => expect(mockSetDefault).toHaveBeenCalledTimes(2));
    await act(async () => {
      secondMutation.resolve({});
    });
    await waitFor(() => expect(buttonB).toBeEnabled());
  });

  it('keeps the newest account refresh when mutation-triggered loads resolve out of order', async () => {
    const olderRefresh = deferred<Awaited<ReturnType<typeof queryPersonalEmailAccounts>>>();
    const newerRefresh = deferred<Awaited<ReturnType<typeof queryPersonalEmailAccounts>>>();
    mockQueryAccounts
      .mockResolvedValueOnce([
        { accountId: 31, name: 'One', email: 'one@qq.com', providerCode: 'qq', default: true },
        { accountId: 32, name: 'Two', email: 'two@qq.com', providerCode: 'qq', default: false },
        { accountId: 33, name: 'Three', email: 'three@qq.com', providerCode: 'qq', default: false },
      ])
      .mockReturnValueOnce(olderRefresh.promise)
      .mockReturnValueOnce(newerRefresh.promise);
    mockSetDefault.mockResolvedValue({});
    mockDelete.mockResolvedValue(true);
    render(<PersonalEmailSettings />);
    const rowTwo = (await screen.findByText('two@qq.com')).closest('tr') as HTMLTableRowElement;
    const rowThree = screen.getByText('three@qq.com').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(rowTwo).getByRole('button', { name: 'settings.email.setDefault' }));
    fireEvent.click(within(rowThree).getByRole('button', { name: 'common.delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(mockSetDefault).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockQueryAccounts).toHaveBeenCalledTimes(3));

    await act(async () => {
      newerRefresh.resolve([
        { accountId: 33, name: 'Newest', email: 'newest@qq.com', providerCode: 'qq', default: true },
      ]);
    });
    expect(await screen.findByText('newest@qq.com')).toBeInTheDocument();
    await act(async () => {
      olderRefresh.resolve([
        { accountId: 32, name: 'Older', email: 'older@qq.com', providerCode: 'qq', default: true },
      ]);
    });
    await waitFor(() => expect(screen.queryByText('older@qq.com')).not.toBeInTheDocument());
    expect(screen.getByText('newest@qq.com')).toBeInTheDocument();
  });

  it.each([
    ['QQ', 'qq'],
    ['163', 'netease-163'],
    ['Aliyun', 'aliyun-mail'],
  ])(
    'renders all seven ordered operation statuses for %s including status-only conditional delete',
    async (label, code) => {
      mockQueryAccounts.mockResolvedValueOnce([
        {
          accountId: 9,
          name: label,
          email: `person@${code}.example`,
          providerCode: code,
          capabilities: ['list', 'get', 'search', 'downloadAttachment', 'send', 'reply'],
          capabilityStatus: { delete: 'CONDITIONAL_MOVE_OR_UIDPLUS' },
        },
      ]);

      render(<PersonalEmailSettings />);
      const row = (await screen.findByText(`person@${code}.example`)).closest('tr') as HTMLTableRowElement;
      const capabilityTags = within(row).getAllByText(
        /^(收取列表|读取邮件|搜索|下载附件|发送|回复|删除（需要服务器支持 MOVE 或 UIDPLUS）)$/
      );
      expect(capabilityTags).toHaveLength(7);
      expect(capabilityTags.map((tag) => tag.textContent)).toEqual([
        '收取列表',
        '读取邮件',
        '搜索',
        '下载附件',
        '发送',
        '回复',
        '删除（需要服务器支持 MOVE 或 UIDPLUS）',
      ]);
    }
  );

  it('uses code-aware guidance for enterprise and unknown conditional capabilities', async () => {
    mockQueryAccounts.mockResolvedValueOnce([
      {
        accountId: 10,
        name: 'Enterprise',
        email: 'person@enterprise.example',
        providerCode: 'iwhalecloud',
        capabilities: ['list'],
        capabilityStatus: {
          list: 'CONDITIONAL_EWS_ENTERPRISE_AUTH_OR_BROWSER_SSO',
          search: 'CONDITIONAL_UNKNOWN_POLICY',
        },
      },
    ]);

    render(<PersonalEmailSettings />);
    const row = (await screen.findByText('person@enterprise.example')).closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('收取列表（需要企业 EWS 认证或浏览器登录）')).toBeInTheDocument();
    expect(within(row).getByText('搜索（需满足服务商条件）')).toBeInTheDocument();
  });

  it('defaults iWhaleCloud to browser sign-in and offers secret-free enterprise auth guidance', async () => {
    await openCreate();
    await chooseProvider('iWhaleCloud');
    expect(screen.getByText('浏览器登录是默认方式；连接状态检查通过前不会标记为就绪。')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'iWhaleCloud设置' })).getByText('浏览器登录')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    fireEvent.mouseDown(screen.getByLabelText('企业认证方式'));
    expect(screen.getByText('NTLM（由企业凭据服务提供）')).toBeInTheDocument();
    expect(screen.getByText('Kerberos（使用当前企业身份）')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Kerberos.*密码/)).not.toBeInTheDocument();
    expect(screen.queryByText('连接就绪')).not.toBeInTheDocument();
  });
});
