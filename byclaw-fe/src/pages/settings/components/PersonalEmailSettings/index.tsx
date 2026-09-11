import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
// @ts-ignore
import { useIntl } from '@umijs/max';

import {
  checkPersonalEmailConnection,
  deletePersonalEmailAccount,
  MailCapability,
  MailCapabilityStatus,
  MailEncryption,
  MailProvider,
  PersonalEmailAccount,
  PersonalEmailAccountSavePayload,
  queryMailProviders,
  queryPersonalEmailAccounts,
  savePersonalEmailAccount,
} from '@/service/personalEmail';
import {
  ConnectorAuthorization,
  getConnectorAuthorization,
  queryAllConnectors,
  startConnectorAuthorization,
} from '@/service/connector';
import styles from './index.module.less';

const { Text } = Typography;

const PROVIDER_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  fastmail: 'Fastmail',
  qq: 'QQ邮箱',
  'netease-163': '网易163邮箱',
  'aliyun-mail': '阿里邮箱',
  'microsoft-365': 'Outlook / Microsoft 365',
  'custom-imap': '自定义 IMAP',
};

const DOMAIN_PROVIDERS: Record<string, string> = {
  'gmail.com': 'gmail',
  'fastmail.com': 'fastmail',
  'qq.com': 'qq',
  '163.com': 'netease-163',
  'aliyun.com': 'aliyun-mail',
  'outlook.com': 'microsoft-365',
  'hotmail.com': 'microsoft-365',
  'live.com': 'microsoft-365',
};

const CAPABILITY_NAMES: Record<MailCapability, string> = {
  list: '收取列表',
  get: '读取邮件',
  search: '搜索',
  downloadAttachment: '下载附件',
  send: '发送',
  reply: '回复',
  delete: '删除',
};

const CANONICAL_CAPABILITIES = Object.keys(CAPABILITY_NAMES) as MailCapability[];

const REQUIREMENT_TEXT: Record<string, string> = {
  AUTHORIZE_OAUTH2: '使用服务商账号完成授权',
  CREATE_API_TOKEN: '在 Fastmail 设置中创建 API Token',
  ENABLE_IMAP_SMTP: '先在邮箱设置中开启 IMAP/SMTP 服务',
  USE_AUTHORIZATION_CODE: '使用邮箱生成的授权码，不要使用登录密码',
  ADMIN_ENABLE_THIRD_PARTY_CLIENT: '请管理员开启第三方客户端访问',
  USE_SECURITY_PASSWORD: '使用阿里邮箱安全密码',
  PROVIDE_IMAP_SMTP_SETTINGS: '填写 IMAP/SMTP 服务器设置',
  USE_APP_PASSWORD: '建议使用应用专用密码',
};

const encryptionOptions = [
  { label: 'TLS', value: 'tls' },
  { label: 'STARTTLS', value: 'starttls' },
  { label: 'SSL', value: 'ssl' },
];

const secureEncryption = (value?: string): MailEncryption | undefined =>
  value === 'tls' || value === 'starttls' || value === 'ssl' ? value : undefined;

const secureServerConfig = (server?: PersonalEmailAccount['imap']) =>
  server ? { ...server, encryption: secureEncryption(server.encryption) } : undefined;

const checkedCapabilityStatus = (
  value?: Partial<Record<MailCapability, MailCapabilityStatus>>
): Partial<Record<MailCapability, MailCapabilityStatus>> | undefined => {
  if (!value || Object.keys(value).length === 0) return undefined;
  const checked: Partial<Record<MailCapability, MailCapabilityStatus>> = {};
  CANONICAL_CAPABILITIES.forEach((capability) => {
    const status = value[capability];
    if (status === 'YES' || status === 'NO' || /^CONDITIONAL_[A-Z0-9_]+$/.test(status || '')) {
      checked[capability] = status;
    }
  });
  return Object.keys(checked).length > 0 ? checked : undefined;
};

const OAUTH_DESTINATIONS: Record<string, { origin: string; pathname: string }> = {
  gmail: { origin: 'https://accounts.google.com', pathname: '/o/oauth2/v2/auth' },
  'microsoft-365': {
    origin: 'https://login.microsoftonline.com',
    pathname: '/common/oauth2/v2.0/authorize',
  },
};

const safeAuthorizationUrl = (providerCode: string, value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const destination = OAUTH_DESTINATIONS[providerCode];
    if (
      !destination ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.origin !== destination.origin ||
      url.pathname !== destination.pathname
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const normalizedEmail = (value?: string) => value?.trim().toLowerCase() || '';

interface OAuthFlowContext {
  generation: number;
  modalSession: number;
  providerCode: string;
  connectorId?: number | string;
  accountId?: number | string;
  mode: 'add' | 'edit';
  email: string;
}

const getProviderName = (provider?: Pick<MailProvider, 'code' | 'name'>) =>
  provider ? PROVIDER_NAMES[provider.code] || provider.name : '未知服务商';

const getProviderCodeName = (code?: string) => {
  if (!code) return '未知服务商';
  if (PROVIDER_NAMES[code]) return PROVIDER_NAMES[code];
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(code) ? code : '未知服务商';
};

const capabilityText = (capability: MailCapability, status?: MailCapabilityStatus) => {
  const name = CAPABILITY_NAMES[capability];
  if (status === 'NO') return `${name}（不支持）`;
  if (status === 'CONDITIONAL_MOVE_OR_UIDPLUS') return `${name}（需要服务器支持 MOVE 或 UIDPLUS）`;
  if (status?.startsWith('CONDITIONAL_')) return `${name}（需满足服务商条件）`;
  return name;
};

const capabilityStatus = (
  capability: MailCapability,
  capabilities: MailCapability[] = [],
  statuses: Partial<Record<MailCapability, MailCapabilityStatus>> = {}
) => statuses[capability] || (capabilities.includes(capability) ? 'YES' : 'NO');

const connectionText = (account: PersonalEmailAccount) => {
  if (account.connectionState === 'READY') return '连接就绪';
  if (account.connectionState === 'CHECKING') return '正在检查';
  if (account.connectionState === 'FAILED') {
    return account.status === 'AUTH_REQUIRED' ? '连接失败：需要重新授权' : '连接失败：请检查设置';
  }
  if (account.status === 'AUTH_REQUIRED') return '等待授权';
  return '尚未检查';
};

const PersonalEmailSettings: React.FC = () => {
  const intl = useIntl();
  const [form] = Form.useForm<PersonalEmailAccountSavePayload>();
  const [loading, setLoading] = useState(false);
  const [accountsLoadState, setAccountsLoadState] = useState<'loading' | 'success' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<PersonalEmailAccount[]>([]);
  const [providers, setProviders] = useState<MailProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PersonalEmailAccount | null>(null);
  const [selectedProviderCode, setSelectedProviderCode] = useState<string>();
  const [providerSelectionSource, setProviderSelectionSource] = useState<'automatic' | 'manual'>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [authorization, setAuthorization] = useState<ConnectorAuthorization>();
  const [checkingAccountIds, setCheckingAccountIds] = useState<Set<string>>(new Set());
  const [mutatingAccountIds, setMutatingAccountIds] = useState<Set<string>>(new Set());
  const providerRequestRef = useRef<Promise<MailProvider[]> | null>(null);
  const mountedRef = useRef(true);
  const accountsAuthoritativeRef = useRef(false);
  const accountLoadGenerationRef = useRef(0);
  const oauthGenerationRef = useRef(0);
  const modalSessionRef = useRef(0);
  const modalOpenRef = useRef(false);
  const selectedProviderCodeRef = useRef<string>();
  const editingAccountRef = useRef<PersonalEmailAccount | null>(null);
  const emailRef = useRef('');
  const oauthRequestPendingRef = useRef(false);
  const authorizationStatusPendingRef = useRef(false);
  const activeOAuthContextRef = useRef<OAuthFlowContext>();
  const connectionPendingRef = useRef(new Set<string>());
  const connectionGenerationRef = useRef(new Map<string, number>());
  const mutationPendingRef = useRef(new Set<string>());

  const selectedProvider = providers.find((provider) => provider.code === selectedProviderCode);
  const isCustom = selectedProvider?.code === 'custom-imap';
  const isOAuth = selectedProvider?.authType === 'OAUTH2';
  const selectedAuthType = Form.useWatch('authType', form) || selectedProvider?.authType;

  const loadAccounts = async () => {
    const generation = ++accountLoadGenerationRef.current;
    setLoading(true);
    try {
      const res = await queryPersonalEmailAccounts();
      if (!mountedRef.current || generation !== accountLoadGenerationRef.current) return;
      setAccounts(Array.isArray(res) ? res : []);
      accountsAuthoritativeRef.current = true;
      setAccountsLoadState('success');
    } catch {
      if (!mountedRef.current || generation !== accountLoadGenerationRef.current) return;
      if (!accountsAuthoritativeRef.current) setAccountsLoadState('error');
      message.error('邮箱账号加载失败，请稍后重试');
    } finally {
      if (mountedRef.current && generation === accountLoadGenerationRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void loadAccounts();
    return () => {
      mountedRef.current = false;
      oauthGenerationRef.current += 1;
      modalOpenRef.current = false;
      accountLoadGenerationRef.current += 1;
      connectionGenerationRef.current.clear();
      mutationPendingRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  const invalidateOAuthFlow = () => {
    oauthGenerationRef.current += 1;
    oauthRequestPendingRef.current = false;
    authorizationStatusPendingRef.current = false;
    activeOAuthContextRef.current = undefined;
    if (mountedRef.current) {
      setAuthorization(undefined);
      setSaving(false);
    }
  };

  const closeModal = () => {
    invalidateOAuthFlow();
    modalSessionRef.current += 1;
    modalOpenRef.current = false;
    setModalOpen(false);
  };

  const loadProviders = async () => {
    if (providers.length > 0) return providers;
    if (providerRequestRef.current) return providerRequestRef.current;
    if (mountedRef.current) {
      setProvidersLoading(true);
      setProvidersError(false);
    }
    const request = queryMailProviders();
    providerRequestRef.current = request;
    try {
      const list = await request;
      const safeList = Array.isArray(list) ? list : [];
      if (mountedRef.current) setProviders(safeList);
      return safeList;
    } catch {
      if (mountedRef.current) setProvidersError(true);
      return [];
    } finally {
      providerRequestRef.current = null;
      if (mountedRef.current) setProvidersLoading(false);
    }
  };

  const openCreateModal = () => {
    invalidateOAuthFlow();
    modalSessionRef.current += 1;
    modalOpenRef.current = true;
    editingAccountRef.current = null;
    emailRef.current = '';
    selectedProviderCodeRef.current = undefined;
    setEditingAccount(null);
    setProviderSelectionSource(undefined);
    setSelectedProviderCode(undefined);
    setAdvancedOpen(false);
    setAuthorization(undefined);
    form.resetFields();
    setModalOpen(true);
    void loadProviders();
  };

  const openEditModal = (record: PersonalEmailAccount) => {
    invalidateOAuthFlow();
    modalSessionRef.current += 1;
    modalOpenRef.current = true;
    editingAccountRef.current = record;
    emailRef.current = normalizedEmail(record.email);
    selectedProviderCodeRef.current = record.providerCode || 'custom-imap';
    setEditingAccount(record);
    setProviderSelectionSource('manual');
    setSelectedProviderCode(record.providerCode || 'custom-imap');
    setAdvancedOpen(false);
    setAuthorization(undefined);
    form.setFieldsValue({
      ...record,
      providerCode: record.providerCode || 'custom-imap',
      authType: record.authType,
      displayName: record.displayName || record.display_name,
      authCode: undefined,
      imap: secureServerConfig(record.imap),
      smtp: secureServerConfig(record.smtp),
    });
    setModalOpen(true);
    void loadProviders();
  };

  const handleProviderChange = (providerCode: string, source: 'automatic' | 'manual' = 'manual') => {
    if (providerCode === selectedProviderCodeRef.current) {
      if (source === 'manual') setProviderSelectionSource('manual');
      return;
    }
    invalidateOAuthFlow();
    const provider = providers.find((item) => item.code === providerCode);
    selectedProviderCodeRef.current = providerCode;
    setSelectedProviderCode(providerCode);
    setProviderSelectionSource(source);
    setAdvancedOpen(false);
    setAuthorization(undefined);
    form.setFieldsValue({
      providerCode,
      authType: provider?.authType,
      authCode: undefined,
      imap: providerCode === 'custom-imap' ? { encryption: 'tls' } : undefined,
      smtp: providerCode === 'custom-imap' ? { encryption: 'tls' } : undefined,
    });
  };

  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    emailRef.current = normalizedEmail(event.target.value);
    invalidateOAuthFlow();
    if (providerSelectionSource === 'manual') return;
    const domain = event.target.value.trim().toLowerCase().split('@')[1];
    const providerCode = DOMAIN_PROVIDERS[domain];
    if (providerCode && providers.some((provider) => provider.code === providerCode)) {
      handleProviderChange(providerCode, 'automatic');
      return;
    }
    if (providers.some((provider) => provider.code === 'custom-imap')) {
      handleProviderChange('custom-imap', 'automatic');
    } else {
      selectedProviderCodeRef.current = undefined;
      setSelectedProviderCode(undefined);
      setProviderSelectionSource(undefined);
      form.setFieldsValue({
        providerCode: undefined,
        authType: undefined,
        authCode: undefined,
        imap: undefined,
        smtp: undefined,
      });
    }
  };

  const buildPayload = (values: PersonalEmailAccountSavePayload) => {
    const payload: PersonalEmailAccountSavePayload = {
      accountId: editingAccount?.accountId,
      name: values.name,
      email: values.email,
      providerCode: selectedProvider?.code,
      authType: values.authType || selectedProvider?.authType,
      displayName: values.displayName,
    };
    if (isCustom) {
      payload.imap = secureServerConfig(values.imap);
      payload.smtp = secureServerConfig(values.smtp);
    }
    if (values.authCode) payload.authCode = values.authCode;
    return payload;
  };

  const isOAuthContextCurrent = (context: OAuthFlowContext) =>
    mountedRef.current &&
    modalOpenRef.current &&
    oauthGenerationRef.current === context.generation &&
    modalSessionRef.current === context.modalSession &&
    selectedProviderCodeRef.current === context.providerCode &&
    editingAccountRef.current?.accountId === context.accountId &&
    (editingAccountRef.current ? 'edit' : 'add') === context.mode &&
    emailRef.current === context.email;

  const saveValues = async (values: PersonalEmailAccountSavePayload, context?: OAuthFlowContext) => {
    if (context && !isOAuthContextCurrent(context)) return;
    setSaving(true);
    try {
      await savePersonalEmailAccount(buildPayload(values));
      if (!mountedRef.current || (context && !isOAuthContextCurrent(context))) return;
      message.success(intl.formatMessage({ id: 'settings.email.saveSuccess' }));
      closeModal();
      await loadAccounts();
    } catch {
      if (mountedRef.current && (!context || isOAuthContextCurrent(context))) {
        message.error('邮箱账号保存失败，请检查设置后重试');
      }
    } finally {
      if (mountedRef.current && (!context || isOAuthContextCurrent(context))) setSaving(false);
    }
  };

  const handleOAuth = async () => {
    if (!selectedProvider?.connectorCode || oauthRequestPendingRef.current) return;
    const provider = selectedProvider;
    const context: OAuthFlowContext = {
      generation: ++oauthGenerationRef.current,
      modalSession: modalSessionRef.current,
      providerCode: provider.code,
      accountId: editingAccountRef.current?.accountId,
      mode: editingAccountRef.current ? 'edit' : 'add',
      email: normalizedEmail(form.getFieldValue('email')),
    };
    activeOAuthContextRef.current = context;
    oauthRequestPendingRef.current = true;
    setSaving(true);
    let values: PersonalEmailAccountSavePayload;
    try {
      values = await form.validateFields();
    } catch {
      if (isOAuthContextCurrent(context)) {
        oauthRequestPendingRef.current = false;
        setSaving(false);
      }
      return;
    }
    if (!isOAuthContextCurrent(context)) return;
    if (normalizedEmail(values.email) !== context.email) {
      invalidateOAuthFlow();
      return;
    }
    try {
      const connectors = await queryAllConnectors(provider.connectorCode);
      if (!isOAuthContextCurrent(context)) return;
      const matchingConnectors = connectors.filter((item) => item.connectorCode === provider.connectorCode);
      if (matchingConnectors.length !== 1) throw new Error('邮箱连接器配置不唯一');
      const [connector] = matchingConnectors;
      context.connectorId = connector.connectorId;
      const nextAuthorization = await startConnectorAuthorization({
        connectorId: connector.connectorId,
        redirectUrl: `${window.location.origin}${window.location.pathname}`,
      });
      if (
        !isOAuthContextCurrent(context) ||
        String(nextAuthorization.connectorId) !== String(connector.connectorId) ||
        !nextAuthorization.authorizationId
      ) {
        return;
      }
      setAuthorization(nextAuthorization);
      if (nextAuthorization.status === 'connected') {
        await saveValues(values, context);
        return;
      }
      if (nextAuthorization.status !== 'pending') {
        message.error('授权未完成，请重新发起');
        return;
      }
      const url = safeAuthorizationUrl(provider.code, nextAuthorization.authorizationUrl);
      if (!url) {
        message.error('授权地址校验失败，请重新发起');
        invalidateOAuthFlow();
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      if (isOAuthContextCurrent(context)) message.error('发起授权失败，请确认连接器可用后重试');
    } finally {
      if (isOAuthContextCurrent(context)) {
        oauthRequestPendingRef.current = false;
        setSaving(false);
      }
    }
  };

  const handleSave = async () => {
    if (isOAuth) {
      await handleOAuth();
      return;
    }
    try {
      const values = await form.validateFields();
      await saveValues(values);
    } catch {
      // Form validation already presents field-level guidance.
    }
  };

  const checkAuthorization = async () => {
    const context = activeOAuthContextRef.current;
    if (!authorization?.authorizationId || !context || authorizationStatusPendingRef.current) return;
    authorizationStatusPendingRef.current = true;
    setSaving(true);
    try {
      const current = await getConnectorAuthorization(authorization.authorizationId);
      if (
        !isOAuthContextCurrent(context) ||
        current.authorizationId !== authorization.authorizationId ||
        String(current.connectorId) !== String(context.connectorId)
      ) {
        return;
      }
      setAuthorization(current);
      if (current.status === 'connected') {
        let values: PersonalEmailAccountSavePayload;
        try {
          values = await form.validateFields();
        } catch {
          return;
        }
        if (isOAuthContextCurrent(context)) await saveValues(values, context);
      } else if (current.status !== 'pending') {
        message.error('授权未完成，请重新发起');
      }
    } catch {
      if (isOAuthContextCurrent(context)) message.error('授权状态检查失败，请稍后重试');
    } finally {
      if (isOAuthContextCurrent(context)) {
        authorizationStatusPendingRef.current = false;
        setSaving(false);
      }
    }
  };

  const runAccountMutation = async (
    record: PersonalEmailAccount,
    operation: () => Promise<unknown>,
    successMessageId: string
  ) => {
    if (!record.accountId) return;
    const accountKey = String(record.accountId);
    if (mutationPendingRef.current.has(accountKey)) return;
    mutationPendingRef.current.add(accountKey);
    setMutatingAccountIds(new Set(mutationPendingRef.current));
    try {
      await operation();
      if (!mountedRef.current) return;
      message.success(intl.formatMessage({ id: successMessageId }));
      await loadAccounts();
    } catch {
      if (mountedRef.current) message.error('邮箱账号操作失败，请稍后重试');
    } finally {
      mutationPendingRef.current.delete(accountKey);
      if (mountedRef.current) setMutatingAccountIds(new Set(mutationPendingRef.current));
    }
  };

  const handleDelete = (record: PersonalEmailAccount) =>
    runAccountMutation(
      record,
      () => deletePersonalEmailAccount(record.accountId as number | string),
      'settings.email.deleteSuccess'
    );

  const handleConnectionCheck = async (record: PersonalEmailAccount) => {
    if (!record.accountId) return;
    const accountKey = String(record.accountId);
    if (connectionPendingRef.current.has(accountKey)) return;
    connectionPendingRef.current.add(accountKey);
    const generation = (connectionGenerationRef.current.get(accountKey) || 0) + 1;
    connectionGenerationRef.current.set(accountKey, generation);
    setCheckingAccountIds(new Set(connectionPendingRef.current));
    setAccounts((items) =>
      items.map((item) => (item.accountId === record.accountId ? { ...item, connectionState: 'CHECKING' } : item))
    );
    try {
      const result = await checkPersonalEmailConnection(record.accountId);
      if (!mountedRef.current || connectionGenerationRef.current.get(accountKey) !== generation) return;
      const capabilityUpdate = checkedCapabilityStatus(result.capabilityStatus);
      setAccounts((items) =>
        items.map((item) => {
          if (item.accountId !== record.accountId) return item;
          return {
            ...item,
            connectionState: result.connectionState,
            lastCheckTime: result.lastCheckTime,
            status: result.status,
            capabilityStatus: capabilityUpdate
              ? { ...item.capabilityStatus, ...capabilityUpdate }
              : item.capabilityStatus,
          };
        })
      );
    } catch {
      if (!mountedRef.current || connectionGenerationRef.current.get(accountKey) !== generation) return;
      setAccounts((items) =>
        items.map((item) => (item.accountId === record.accountId ? { ...item, connectionState: 'FAILED' } : item))
      );
      message.error('连接检查失败，请检查账号设置');
    } finally {
      if (connectionGenerationRef.current.get(accountKey) === generation) {
        connectionPendingRef.current.delete(accountKey);
        if (mountedRef.current) setCheckingAccountIds(new Set(connectionPendingRef.current));
      }
    }
  };

  const columns: ColumnsType<PersonalEmailAccount> = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'settings.email.address' }),
        dataIndex: 'email',
        width: 220,
        render: (email) => <Text strong>{email || '-'}</Text>,
      },
      {
        title: intl.formatMessage({ id: 'settings.email.account' }),
        dataIndex: 'name',
        width: 180,
        render: (_, record) => (
          <div className={styles.accountCell}>
            <Text strong>{record.name}</Text>
            <Text type="secondary">{record.displayName || record.display_name}</Text>
          </div>
        ),
      },
      {
        title: '邮箱服务商',
        dataIndex: 'providerCode',
        width: 170,
        render: (code) => {
          const catalogProvider = providers.find((provider) => provider.code === code);
          return catalogProvider ? getProviderName(catalogProvider) : getProviderCodeName(code);
        },
      },
      {
        title: '能力',
        dataIndex: 'capabilities',
        width: 340,
        render: (_, record) => (
          <Space size={[4, 4]} wrap>
            {CANONICAL_CAPABILITIES.map((capability) => {
              const status = capabilityStatus(capability, record.capabilities, record.capabilityStatus);
              return (
                <Tag
                  key={capability}
                  color={status === 'NO' ? 'default' : status?.startsWith('CONDITIONAL_') ? 'gold' : 'green'}
                >
                  {capabilityText(capability, status)}
                </Tag>
              );
            })}
          </Space>
        ),
      },
      {
        title: '连接状态',
        dataIndex: 'connectionState',
        width: 210,
        render: (_, record) => (
          <div className={styles.statusCell}>
            <Text type={record.connectionState === 'FAILED' ? 'danger' : undefined}>{connectionText(record)}</Text>
            <Text type="secondary">
              {record.lastCheckTime
                ? `上次检查：${dayjs(record.lastCheckTime).format('YYYY-MM-DD HH:mm')}`
                : '尚无检查记录'}
            </Text>
            <Button
              type="link"
              size="small"
              loading={checkingAccountIds.has(String(record.accountId))}
              disabled={mutatingAccountIds.has(String(record.accountId))}
              onClick={() => handleConnectionCheck(record)}
            >
              检查连接
            </Button>
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'settings.email.updateTime' }),
        dataIndex: 'updateTime',
        width: 120,
        render: (value) => (value ? dayjs(value).format('YYYY-MM-DD') : '-'),
      },
      {
        title: intl.formatMessage({ id: 'common.operation' }),
        key: 'action',
        width: 190,
        fixed: 'right',
        render: (_, record) => (
          <Space>
            <Button
              type="link"
              size="small"
              disabled={
                mutatingAccountIds.has(String(record.accountId)) || checkingAccountIds.has(String(record.accountId))
              }
              onClick={() => openEditModal(record)}
            >
              {intl.formatMessage({ id: 'common.edit' })}
            </Button>
            <Popconfirm
              title={intl.formatMessage({ id: 'settings.email.confirmDelete' })}
              disabled={
                mutatingAccountIds.has(String(record.accountId)) || checkingAccountIds.has(String(record.accountId))
              }
              onConfirm={() => handleDelete(record)}
            >
              <Button
                type="link"
                size="small"
                danger
                loading={mutatingAccountIds.has(String(record.accountId))}
                disabled={checkingAccountIds.has(String(record.accountId))}
              >
                {intl.formatMessage({ id: 'common.delete' })}
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [checkingAccountIds, intl, mutatingAccountIds, providers]
  );

  const providerOptions = providers.map((provider) => ({ label: getProviderName(provider), value: provider.code }));
  const secretLabel = selectedProvider?.authType === 'API_TOKEN' ? 'API Token' : '授权码或应用密码';
  const requiresSecret =
    selectedAuthType === 'APP_PASSWORD' || selectedAuthType === 'API_TOKEN' || selectedAuthType === 'NTLM';
  const hasExistingSecret = editingAccount?.hasAuthCode && editingAccount.providerCode === selectedProvider?.code;

  return (
    <div className={styles.emailSettings}>
      <div className={styles.header}>
        <p>{intl.formatMessage({ id: 'settings.email.description' })}</p>
        <Button type="primary" disabled={accountsLoadState !== 'success'} onClick={openCreateModal}>
          {intl.formatMessage({ id: 'settings.email.addAccount' })}
        </Button>
      </div>

      {accountsLoadState === 'error' ? (
        <Alert
          type="error"
          showIcon
          message="邮箱账号加载失败"
          action={
            <Button onClick={() => void loadAccounts()} disabled={loading}>
              重试加载邮箱账号
            </Button>
          }
        />
      ) : null}

      <Card className={styles.tableCard}>
        <Table
          rowKey="accountId"
          loading={loading}
          columns={columns}
          dataSource={accounts}
          pagination={false}
          scroll={{ x: 1430 }}
          locale={{ emptyText: <Empty description={intl.formatMessage({ id: 'settings.email.empty' })} /> }}
        />
      </Card>

      <Modal
        title={
          editingAccount
            ? intl.formatMessage({ id: 'settings.email.editAccount' })
            : intl.formatMessage({ id: 'settings.email.addAccount' })
        }
        open={modalOpen}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={closeModal}
        width={720}
        className={styles.emailModal}
        wrapClassName={styles.emailModalWrap}
        destroyOnHidden
      >
        {providersLoading ? (
          <div className={styles.catalogState} role="status" aria-label="正在加载邮箱服务商">
            <Spin />
          </div>
        ) : providersError ? (
          <Alert
            type="error"
            showIcon
            message="邮箱服务商加载失败"
            action={<Button onClick={() => void loadProviders()}>重试</Button>}
          />
        ) : providers.length === 0 ? (
          <Empty description="暂无可用邮箱服务商" />
        ) : (
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item label="邮箱服务商" name="providerCode" rules={[{ required: true, message: '请选择邮箱服务商' }]}>
              <Select
                options={providerOptions}
                onChange={(value) => handleProviderChange(value)}
                placeholder="选择邮箱服务商"
              />
            </Form.Item>
            <div className={styles.formGrid}>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.address' })}
                name="email"
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'settings.email.addressRequired' }) },
                  { type: 'email', message: intl.formatMessage({ id: 'settings.email.addressInvalid' }) },
                ]}
              >
                <Input placeholder="name@example.com" onChange={handleEmailChange} />
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.accountName' })}
                name="name"
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.accountNameRequired' }) }]}
              >
                <Input placeholder="工作邮箱" />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'settings.email.displayName' })} name="displayName">
                <Input placeholder="发件人名称" />
              </Form.Item>
            </div>

            {selectedProvider ? (
              <section className={styles.providerDetails} aria-label={`${getProviderName(selectedProvider)}设置`}>
                <div className={styles.providerHeading}>
                  <div>
                    <Text strong>{getProviderName(selectedProvider)}</Text>
                    <Text type="secondary">{selectedProvider.transport}</Text>
                  </div>
                  {!isCustom ? (
                    <Button type="link" onClick={() => setAdvancedOpen((open) => !open)}>
                      高级设置
                    </Button>
                  ) : null}
                </div>
                {selectedProvider.setupRequirements.length > 0 ? (
                  <Alert
                    type="info"
                    showIcon
                    message="设置提示"
                    description={selectedProvider.setupRequirements.map((requirement) => (
                      <div key={requirement}>{REQUIREMENT_TEXT[requirement] || requirement}</div>
                    ))}
                  />
                ) : null}
                <div className={styles.capabilities} aria-label="邮箱能力">
                  {CANONICAL_CAPABILITIES.map((capability) => {
                    const status = capabilityStatus(
                      capability,
                      selectedProvider.capabilities,
                      selectedProvider.capabilityStatus
                    );
                    return <Tag key={capability}>{capabilityText(capability, status)}</Tag>;
                  })}
                </div>

                {isCustom ? (
                  <>
                    <div className={styles.serverSection}>
                      <h3>IMAP</h3>
                      <div className={styles.serverGrid}>
                        <Form.Item
                          label="IMAP服务器"
                          name={['imap', 'host']}
                          rules={[{ required: true, message: '请输入 IMAP 服务器' }]}
                        >
                          <Input placeholder="imap.example.com" />
                        </Form.Item>
                        <Form.Item
                          label="IMAP端口"
                          name={['imap', 'port']}
                          rules={[{ required: true, message: '请输入端口' }]}
                        >
                          <InputNumber min={1} max={65535} />
                        </Form.Item>
                        <Form.Item label="IMAP加密" name={['imap', 'encryption']} rules={[{ required: true }]}>
                          <Select options={encryptionOptions} />
                        </Form.Item>
                      </div>
                    </div>
                    <div className={styles.serverSection}>
                      <h3>SMTP</h3>
                      <div className={styles.serverGrid}>
                        <Form.Item
                          label="SMTP服务器"
                          name={['smtp', 'host']}
                          rules={[{ required: true, message: '请输入 SMTP 服务器' }]}
                        >
                          <Input placeholder="smtp.example.com" />
                        </Form.Item>
                        <Form.Item
                          label="SMTP端口"
                          name={['smtp', 'port']}
                          rules={[{ required: true, message: '请输入端口' }]}
                        >
                          <InputNumber min={1} max={65535} />
                        </Form.Item>
                        <Form.Item label="SMTP加密" name={['smtp', 'encryption']} rules={[{ required: true }]}>
                          <Select options={encryptionOptions} />
                        </Form.Item>
                      </div>
                    </div>
                  </>
                ) : advancedOpen && (selectedProvider.imap || selectedProvider.smtp) ? (
                  <div className={styles.readonlyServers} aria-label="服务商默认服务器">
                    {selectedProvider.imap ? (
                      <Text>
                        IMAP：{selectedProvider.imap.host}:{selectedProvider.imap.port}
                      </Text>
                    ) : null}
                    {selectedProvider.smtp ? (
                      <Text>
                        SMTP：{selectedProvider.smtp.host}:{selectedProvider.smtp.port}
                      </Text>
                    ) : null}
                  </div>
                ) : null}

                {requiresSecret ? (
                  <Form.Item
                    label={secretLabel}
                    name="authCode"
                    extra={hasExistingSecret ? '留空将保留现有凭据；仅在需要替换时输入新值。' : undefined}
                    rules={[{ required: !hasExistingSecret, message: `请输入${secretLabel}` }]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                ) : null}

                {isOAuth ? (
                  <div className={styles.oauthActions}>
                    <Button type="primary" loading={saving} onClick={handleOAuth}>
                      {selectedProvider.code === 'gmail' ? '使用 Google 授权并保存' : '使用 Microsoft 授权并保存'}
                    </Button>
                    {authorization?.status === 'pending' ? (
                      <Button loading={saving} onClick={checkAuthorization}>
                        检查授权状态
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default PersonalEmailSettings;
