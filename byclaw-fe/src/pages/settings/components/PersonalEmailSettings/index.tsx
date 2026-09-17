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
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
// @ts-ignore
import { getIntl, useIntl } from '@umijs/max';

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
  setDefaultPersonalEmailAccount,
} from '@/service/personalEmail';
import {
  ConnectorAuthorization,
  getConnectorAuthorization,
  queryAllConnectors,
  startConnectorAuthorization,
} from '@/service/connector';
import styles from './index.module.less';

const { Text } = Typography;

// 延迟翻译，避免模块加载时固定语言。
const getProviderNames = (): Record<string, string> => ({
  gmail: 'Gmail',
  fastmail: 'Fastmail',
  qq: getIntl().formatMessage({ id: 'ui.email.qq' }),
  'netease-163': getIntl().formatMessage({ id: 'ui.email.netease' }),
  'aliyun-mail': getIntl().formatMessage({ id: 'ui.email.aliyun' }),
  'microsoft-365': 'Outlook / Microsoft 365',
  iwhalecloud: 'iWhaleCloud',
  'custom-imap': getIntl().formatMessage({ id: 'ui.email.customImap' }),
});

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

// 延迟翻译，避免模块加载时固定语言。
const getCapabilityNames = (): Record<MailCapability, string> => ({
  list: getIntl().formatMessage({ id: 'ui.email.list' }),
  get: getIntl().formatMessage({ id: 'ui.email.read' }),
  search: getIntl().formatMessage({ id: 'ui.email.search' }),
  downloadAttachment: getIntl().formatMessage({ id: 'ui.email.downloadAttachment' }),
  send: getIntl().formatMessage({ id: 'ui.email.send' }),
  reply: getIntl().formatMessage({ id: 'ui.email.reply' }),
  delete: getIntl().formatMessage({ id: 'ui.email.delete' }),
});

const CANONICAL_CAPABILITIES = [
  'list',
  'get',
  'search',
  'downloadAttachment',
  'send',
  'reply',
  'delete',
] as MailCapability[];

// 延迟翻译，避免模块加载时固定语言。
const getRequirementText = (): Record<string, string> => ({
  AUTHORIZE_OAUTH2: getIntl().formatMessage({ id: 'ui.email.authorize' }),
  CREATE_API_TOKEN: getIntl().formatMessage({ id: 'ui.email.createToken' }),
  ENABLE_IMAP_SMTP: getIntl().formatMessage({ id: 'ui.email.enableImap' }),
  USE_AUTHORIZATION_CODE: getIntl().formatMessage({ id: 'ui.email.useAuthorizationCode' }),
  ADMIN_ENABLE_THIRD_PARTY_CLIENT: getIntl().formatMessage({ id: 'ui.email.adminEnable' }),
  USE_SECURITY_PASSWORD: getIntl().formatMessage({ id: 'ui.email.securityPassword' }),
  SIGN_IN_WITH_BROWSER_OR_CONFIGURE_EWS: getIntl().formatMessage({ id: 'ui.email.browserOrEws' }),
  PROVIDE_IMAP_SMTP_SETTINGS: getIntl().formatMessage({ id: 'ui.email.serverSettings' }),
  USE_APP_PASSWORD: getIntl().formatMessage({ id: 'ui.email.appPassword' }),
});

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
  provider
    ? getProviderNames()[provider.code] || provider.name
    : getIntl().formatMessage({ id: 'ui.email.unknownProvider' });

const getProviderCodeName = (code?: string) => {
  if (!code) return getIntl().formatMessage({ id: 'ui.email.unknownProvider' });
  if (getProviderNames()[code]) return getProviderNames()[code];
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(code) ? code : getIntl().formatMessage({ id: 'ui.email.unknownProvider' });
};

const capabilityText = (capability: MailCapability, status?: MailCapabilityStatus) => {
  const name = getCapabilityNames()[capability];
  if (status === 'NO') return getIntl().formatMessage({ id: 'ui.email.unsupported' }, { v0: name });
  if (status === 'CONDITIONAL_MOVE_OR_UIDPLUS')
    return getIntl().formatMessage({ id: 'ui.email.moveRequired' }, { v0: name });
  if (status === 'CONDITIONAL_EWS_ENTERPRISE_AUTH_OR_BROWSER_SSO') {
    return getIntl().formatMessage({ id: 'ui.email.ewsRequired' }, { v0: name });
  }
  if (status?.startsWith('CONDITIONAL_')) return getIntl().formatMessage({ id: 'ui.email.conditional' }, { v0: name });
  return name;
};

const capabilityStatus = (
  capability: MailCapability,
  capabilities: MailCapability[] = [],
  statuses: Partial<Record<MailCapability, MailCapabilityStatus>> = {}
) => statuses[capability] || (capabilities.includes(capability) ? 'YES' : 'NO');

const connectionText = (account: PersonalEmailAccount) => {
  if (account.connectionState === 'READY') return getIntl().formatMessage({ id: 'ui.email.ready' });
  if (account.connectionState === 'CHECKING') return getIntl().formatMessage({ id: 'ui.email.checking' });
  if (account.connectionState === 'FAILED') {
    return account.status === 'AUTH_REQUIRED'
      ? getIntl().formatMessage({ id: 'ui.email.reauthorize' })
      : getIntl().formatMessage({ id: 'ui.email.checkSettings' });
  }
  if (account.status === 'AUTH_REQUIRED') return getIntl().formatMessage({ id: 'ui.email.awaitingAuthorization' });
  return getIntl().formatMessage({ id: 'ui.email.unchecked' });
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
  const [defaultMutationPending, setDefaultMutationPending] = useState(false);
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
  const defaultMutationPendingRef = useRef(false);

  const selectedProvider = providers.find((provider) => provider.code === selectedProviderCode);
  const isCustom = selectedProvider?.code === 'custom-imap';
  const isOAuth = selectedProvider?.authType === 'OAUTH2';
  const isIWhaleCloud = selectedProvider?.code === 'iwhalecloud';
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
      message.error(intl.formatMessage({ id: 'ui.email.loadFailed' }));
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
      defaultMutationPendingRef.current = false;
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
    form.setFieldsValue({ default: accounts.length === 0 });
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
      default: values.default,
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
        message.error(intl.formatMessage({ id: 'ui.email.saveFailed' }));
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
      if (matchingConnectors.length !== 1) throw new Error(intl.formatMessage({ id: 'ui.email.ambiguousConnector' }));
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
        message.error(intl.formatMessage({ id: 'ui.email.authorizationIncomplete' }));
        return;
      }
      const url = safeAuthorizationUrl(provider.code, nextAuthorization.authorizationUrl);
      if (!url) {
        message.error(intl.formatMessage({ id: 'ui.email.invalidAuthorizationUrl' }));
        invalidateOAuthFlow();
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      if (isOAuthContextCurrent(context))
        message.error(intl.formatMessage({ id: 'ui.email.startAuthorizationFailed' }));
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
        message.error(intl.formatMessage({ id: 'ui.email.authorizationIncomplete' }));
      }
    } catch {
      if (isOAuthContextCurrent(context))
        message.error(intl.formatMessage({ id: 'ui.email.authorizationCheckFailed' }));
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
      if (mountedRef.current) message.error(intl.formatMessage({ id: 'ui.email.operationFailed' }));
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

  const handleSetDefault = async (record: PersonalEmailAccount) => {
    if (!record.accountId || defaultMutationPendingRef.current) return;
    const accountKey = String(record.accountId);
    if (mutationPendingRef.current.has(accountKey)) return;
    defaultMutationPendingRef.current = true;
    mutationPendingRef.current.add(accountKey);
    setDefaultMutationPending(true);
    setMutatingAccountIds(new Set(mutationPendingRef.current));
    try {
      await setDefaultPersonalEmailAccount(record.accountId);
      if (!mountedRef.current) return;
      message.success(intl.formatMessage({ id: 'settings.email.defaultSuccess' }));
      await loadAccounts();
    } catch {
      if (mountedRef.current) message.error(intl.formatMessage({ id: 'ui.email.operationFailed' }));
    } finally {
      defaultMutationPendingRef.current = false;
      mutationPendingRef.current.delete(accountKey);
      if (mountedRef.current) {
        setDefaultMutationPending(false);
        setMutatingAccountIds(new Set(mutationPendingRef.current));
      }
    }
  };

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
      message.error(intl.formatMessage({ id: 'ui.email.connectionCheckFailed' }));
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
            <Space>
              <Text strong>{record.name}</Text>
              {record.default ? <Tag color="blue">{intl.formatMessage({ id: 'settings.email.default' })}</Tag> : null}
            </Space>
            <Text type="secondary">{record.displayName || record.display_name}</Text>
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'settings.email.provider' }),
        dataIndex: 'providerCode',
        width: 170,
        render: (code) => {
          const catalogProvider = providers.find((provider) => provider.code === code);
          return catalogProvider ? getProviderName(catalogProvider) : getProviderCodeName(code);
        },
      },
      {
        title: intl.formatMessage({ id: 'settings.email.capabilities' }),
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
        title: intl.formatMessage({ id: 'settings.email.connectionStatus' }),
        dataIndex: 'connectionState',
        width: 210,
        render: (_, record) => (
          <div className={styles.statusCell}>
            <Text type={record.connectionState === 'FAILED' ? 'danger' : undefined}>{connectionText(record)}</Text>
            <Text type="secondary">
              {record.lastCheckTime
                ? intl.formatMessage(
                    { id: 'ui.email.lastChecked' },
                    { v0: dayjs(record.lastCheckTime).format('YYYY-MM-DD HH:mm') }
                  )
                : intl.formatMessage({ id: 'ui.email.noChecks' })}
            </Text>
            <Button
              type="link"
              size="small"
              loading={checkingAccountIds.has(String(record.accountId))}
              disabled={mutatingAccountIds.has(String(record.accountId))}
              onClick={() => handleConnectionCheck(record)}
            >
              {intl.formatMessage({ id: 'settings.email.checkConnection' })}
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
            {!record.default ? (
              <Button
                type="link"
                size="small"
                loading={defaultMutationPending && mutatingAccountIds.has(String(record.accountId))}
                disabled={defaultMutationPending || checkingAccountIds.has(String(record.accountId))}
                onClick={() => handleSetDefault(record)}
              >
                {intl.formatMessage({ id: 'settings.email.setDefault' })}
              </Button>
            ) : null}
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
    [checkingAccountIds, defaultMutationPending, intl, mutatingAccountIds, providers]
  );

  const providerOptions = providers.map((provider) => ({ label: getProviderName(provider), value: provider.code }));
  const secretLabel =
    selectedProvider?.authType === 'API_TOKEN' ? 'API Token' : intl.formatMessage({ id: 'ui.email.secretLabel' });
  const requiresSecret =
    selectedAuthType === 'APP_PASSWORD' || selectedAuthType === 'API_TOKEN' || selectedAuthType === 'NTLM';
  const hasExistingSecret = editingAccount?.hasAuthCode && editingAccount.providerCode === selectedProvider?.code;
  const enterpriseAuthOptions = [{ label: intl.formatMessage({ id: 'ui.email.browserSignIn' }), value: 'BROWSER_SSO' }];
  if (advancedOpen) {
    enterpriseAuthOptions.push(
      { label: intl.formatMessage({ id: 'ui.email.ntlm' }), value: 'NTLM' },
      { label: intl.formatMessage({ id: 'ui.email.kerberos' }), value: 'KERBEROS' }
    );
  }

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
          message={intl.formatMessage({ id: 'settings.email.loadFailed' })}
          action={
            <Button onClick={() => void loadAccounts()} disabled={loading}>
              {intl.formatMessage({ id: 'settings.email.retryLoad' })}
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
          <div
            className={styles.catalogState}
            role="status"
            aria-label={intl.formatMessage({ id: 'ui.email.loadingProviders' })}
          >
            <Spin />
          </div>
        ) : providersError ? (
          <Alert
            type="error"
            showIcon
            message={intl.formatMessage({ id: 'settings.email.providerLoadFailed' })}
            action={
              <Button onClick={() => void loadProviders()}> {intl.formatMessage({ id: 'ui.email.retry' })} </Button>
            }
          />
        ) : providers.length === 0 ? (
          <Empty description={intl.formatMessage({ id: 'settings.email.noProviders' })} />
        ) : (
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item
              label={intl.formatMessage({ id: 'ui.email.provider' })}
              name="providerCode"
              rules={[{ required: true, message: intl.formatMessage({ id: 'ui.email.providerRequired' }) }]}
            >
              <Select
                options={providerOptions}
                onChange={(value) => handleProviderChange(value)}
                placeholder={intl.formatMessage({ id: 'ui.email.selectProvider' })}
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
                <Input placeholder={intl.formatMessage({ id: 'ui.email.workEmail' })} />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'settings.email.displayName' })} name="displayName">
                <Input placeholder={intl.formatMessage({ id: 'ui.email.senderName' })} />
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.default' })}
                name="default"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </div>

            {selectedProvider ? (
              <section
                className={styles.providerDetails}
                aria-label={intl.formatMessage(
                  { id: 'ui.email.providerSettings' },
                  { v0: getProviderName(selectedProvider) }
                )}
              >
                <div className={styles.providerHeading}>
                  <div>
                    <Text strong>{getProviderName(selectedProvider)}</Text>
                    <Text type="secondary">{selectedProvider.transport}</Text>
                  </div>
                  {!isCustom ? (
                    <Button type="link" onClick={() => setAdvancedOpen((open) => !open)}>
                      {' '}
                      {intl.formatMessage({ id: 'ui.email.advanced' })}{' '}
                    </Button>
                  ) : null}
                </div>
                {selectedProvider.setupRequirements.length > 0 ? (
                  <Alert
                    type="info"
                    showIcon
                    message={intl.formatMessage({ id: 'ui.email.settingsTips' })}
                    description={selectedProvider.setupRequirements.map((requirement) => (
                      <div key={requirement}>{getRequirementText()[requirement] || requirement}</div>
                    ))}
                  />
                ) : null}
                <div className={styles.capabilities} aria-label={intl.formatMessage({ id: 'ui.email.capabilities' })}>
                  {CANONICAL_CAPABILITIES.map((capability) => {
                    const status = capabilityStatus(
                      capability,
                      selectedProvider.capabilities,
                      selectedProvider.capabilityStatus
                    );
                    return <Tag key={capability}>{capabilityText(capability, status)}</Tag>;
                  })}
                </div>

                {isIWhaleCloud ? (
                  <>
                    <Alert type="warning" showIcon message={intl.formatMessage({ id: 'ui.email.browserDefault' })} />
                    <Form.Item label={intl.formatMessage({ id: 'ui.email.enterpriseAuth' })} name="authType">
                      <Select options={enterpriseAuthOptions} />
                    </Form.Item>
                  </>
                ) : null}

                {isCustom ? (
                  <>
                    <div className={styles.serverSection}>
                      <h3>IMAP</h3>
                      <div className={styles.serverGrid}>
                        <Form.Item
                          label={intl.formatMessage({ id: 'ui.email.imapServer' })}
                          name={['imap', 'host']}
                          rules={[{ required: true, message: intl.formatMessage({ id: 'ui.email.imapRequired' }) }]}
                        >
                          <Input placeholder="imap.example.com" />
                        </Form.Item>
                        <Form.Item
                          label={intl.formatMessage({ id: 'ui.email.imapPort' })}
                          name={['imap', 'port']}
                          rules={[{ required: true, message: intl.formatMessage({ id: 'ui.email.portRequired' }) }]}
                        >
                          <InputNumber min={1} max={65535} />
                        </Form.Item>
                        <Form.Item
                          label={intl.formatMessage({ id: 'ui.email.imapEncryption' })}
                          name={['imap', 'encryption']}
                          rules={[{ required: true }]}
                        >
                          <Select options={encryptionOptions} />
                        </Form.Item>
                      </div>
                    </div>
                    <div className={styles.serverSection}>
                      <h3>SMTP</h3>
                      <div className={styles.serverGrid}>
                        <Form.Item
                          label={intl.formatMessage({ id: 'ui.email.smtpServer' })}
                          name={['smtp', 'host']}
                          rules={[{ required: true, message: intl.formatMessage({ id: 'ui.email.smtpRequired' }) }]}
                        >
                          <Input placeholder="smtp.example.com" />
                        </Form.Item>
                        <Form.Item
                          label={intl.formatMessage({ id: 'ui.email.smtpPort' })}
                          name={['smtp', 'port']}
                          rules={[{ required: true, message: intl.formatMessage({ id: 'ui.email.portRequired' }) }]}
                        >
                          <InputNumber min={1} max={65535} />
                        </Form.Item>
                        <Form.Item
                          label={intl.formatMessage({ id: 'ui.email.smtpEncryption' })}
                          name={['smtp', 'encryption']}
                          rules={[{ required: true }]}
                        >
                          <Select options={encryptionOptions} />
                        </Form.Item>
                      </div>
                    </div>
                  </>
                ) : advancedOpen && (selectedProvider.imap || selectedProvider.smtp) ? (
                  <div
                    className={styles.readonlyServers}
                    aria-label={intl.formatMessage({ id: 'ui.email.defaultServers' })}
                  >
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
                    extra={hasExistingSecret ? intl.formatMessage({ id: 'ui.email.keepSecret' }) : undefined}
                    rules={[
                      {
                        required: !hasExistingSecret,
                        message: intl.formatMessage({ id: 'ui.email.enterField' }, { v0: secretLabel }),
                      },
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                ) : null}

                {isOAuth ? (
                  <div className={styles.oauthActions}>
                    <Button type="primary" loading={saving} onClick={handleOAuth}>
                      {selectedProvider.code === 'gmail'
                        ? intl.formatMessage({ id: 'ui.email.googleAuthorize' })
                        : intl.formatMessage({ id: 'ui.email.microsoftAuthorize' })}
                    </Button>
                    {authorization?.status === 'pending' ? (
                      <Button loading={saving} onClick={checkAuthorization}>
                        {' '}
                        {intl.formatMessage({ id: 'ui.email.checkAuthorization' })}{' '}
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
