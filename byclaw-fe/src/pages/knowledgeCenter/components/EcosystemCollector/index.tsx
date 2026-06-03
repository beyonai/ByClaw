import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ChromeOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileMarkdownOutlined,
  GithubOutlined,
  GlobalOutlined,
  LinkOutlined,
  MailOutlined,
  PlayCircleOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { getLocale, useIntl } from '@umijs/max';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Segmented,
  Select,
  Space,
  Tag,
  TreeSelect,
  Typography,
  message,
} from 'antd';
import classNames from 'classnames';
import {
  createEcosystemTask,
  handleEcosystemRunAction,
  queryEcosystemBrowserBridgeStatus,
  queryEcosystemConnections,
  queryEcosystemConnectors,
  queryEcosystemTasks,
  queryEcosystemRun,
  saveEcosystemConnection,
  startEcosystemRun,
  updateEcosystemTaskStatus,
  type EcosystemAgentStatus,
  type EcosystemConnection,
  type EcosystemConnector,
  type EcosystemRun,
  type EcosystemSignal,
  type EcosystemTask,
  type EcosystemTaskCreatePayload,
} from '@/service/knowledgeCenter';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { getSessionKey, getssoToken, getToken, ssotokenKey, tokenKey } from '@/utils/auth';
import styles from './index.module.less';

type OwnerType = 'personal' | 'enterprise';
type SourceKey = string;
type TaskStatus = 'idle' | 'ready' | 'running' | 'completed' | 'failed';
type BrowserExtensionBindStatus = 'idle' | 'checking' | 'binding' | 'bound' | 'missing' | 'upgrade' | 'expired';
type CollectMode = 'SERVER_OPENCLI' | 'USER_BROWSER_BRIDGE';

interface EcosystemCollectorProps {
  open: boolean;
  ownerType: OwnerType;
  catalogId: string;
  catalogList: Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>;
  initialSource?: SourceKey;
  initialSourceUrl?: string;
  initialScope?: string;
  initialCollectMode?: string;
  onCancel: () => void;
}

interface SourceOption {
  key: SourceKey;
  icon: React.ReactNode;
  requiresBridge: boolean;
  outputCount: number;
  accent: string;
}

interface KnowledgeBaseOption {
  value: string;
  label: string;
  catalogId?: string;
}

interface BrowserExtensionStatus {
  installed?: boolean;
  checking?: boolean;
  version?: string;
  protocolVersion?: string;
  binding?: {
    bound?: boolean;
    targetName?: string;
    tokenStatus?: string;
    tokenStatusName?: string;
    expiresAt?: string;
    warning?: {
      code?: string;
      message?: string;
      occurredAt?: string;
    } | null;
  };
  bridgeStatus?: {
    connected?: boolean;
    message?: string;
  };
}

interface BrowserExtensionPackageManifest {
  version?: string;
  fileName?: string;
  path?: string;
  sha256?: string;
  size?: number;
  installGuide?: string;
}

const { RangePicker } = DatePicker;
const { Text } = Typography;

const taskStatusMap: Record<TaskStatus, { color: string; messageId: string }> = {
  idle: { color: 'default', messageId: 'knowledgeCenter.ecosystem.status.idle' },
  ready: { color: 'processing', messageId: 'knowledgeCenter.ecosystem.status.ready' },
  running: { color: 'processing', messageId: 'knowledgeCenter.ecosystem.status.running' },
  completed: { color: 'success', messageId: 'knowledgeCenter.ecosystem.status.completed' },
  failed: { color: 'error', messageId: 'knowledgeCenter.ecosystem.status.failed' },
};

const runLocationNameIdMap: Record<string, string> = {
  LOCAL: 'knowledgeCenter.ecosystem.runLocation.local',
  SERVER: 'knowledgeCenter.ecosystem.runLocation.server',
};

const collectModeNameIdMap: Record<CollectMode, string> = {
  SERVER_OPENCLI: 'knowledgeCenter.ecosystem.collectMode.serverOpencli',
  USER_BROWSER_BRIDGE: 'knowledgeCenter.ecosystem.collectMode.userBrowserBridge',
};

const collectModeDescIdMap: Record<CollectMode, string> = {
  SERVER_OPENCLI: 'knowledgeCenter.ecosystem.collectMode.serverOpencliDesc',
  USER_BROWSER_BRIDGE: 'knowledgeCenter.ecosystem.collectMode.userBrowserBridgeDesc',
};

const browserLoginCollectModes: CollectMode[] = ['USER_BROWSER_BRIDGE'];
const collectModeValues: CollectMode[] = ['SERVER_OPENCLI', 'USER_BROWSER_BRIDGE'];

const plannedCollectModes: CollectMode[] = [];

const browserExtensionProtocolVersion = '1.1';
const browserExtensionMinVersion = '0.3.0';
const browserExtensionInstallPath = 'byclaw-fe/public/browser-extension/byclaw-browser-bridge';
const browserExtensionPackageCommand = 'pnpm --dir byclaw-fe package:browser-extension';
const browserExtensionLatestManifestPath = '/download/browser-extension/latest.json';
const browserExtensionFallbackPackagePath = `/download/browser-extension/byclaw-browser-bridge-v${browserExtensionMinVersion}.zip`;

const browserExtensionBindStatusNameIdMap: Record<BrowserExtensionBindStatus, string> = {
  idle: 'knowledgeCenter.ecosystem.browserExtension.waitingStatus',
  checking: 'knowledgeCenter.ecosystem.browserExtension.checkingStatus',
  binding: 'knowledgeCenter.ecosystem.browserExtension.bindingStatus',
  bound: 'knowledgeCenter.ecosystem.browserExtension.boundStatus',
  missing: 'knowledgeCenter.ecosystem.browserExtension.missingStatus',
  upgrade: 'knowledgeCenter.ecosystem.browserExtension.upgradeStatus',
  expired: 'knowledgeCenter.ecosystem.browserExtension.expiredStatus',
};

const browserExtensionTokenStatusNameIdMap: Record<string, string> = {
  UNBOUND: 'knowledgeCenter.ecosystem.browserExtension.token.unbound',
  MISSING: 'knowledgeCenter.ecosystem.browserExtension.token.missing',
  UNKNOWN: 'knowledgeCenter.ecosystem.browserExtension.token.unknown',
  VALID: 'knowledgeCenter.ecosystem.browserExtension.token.valid',
  EXPIRING_SOON: 'knowledgeCenter.ecosystem.browserExtension.token.expiringSoon',
  EXPIRED: 'knowledgeCenter.ecosystem.browserExtension.token.expired',
};

const authTypeNameIdMap: Record<string, string> = {
  BROWSER: 'knowledgeCenter.ecosystem.auth.browser',
  TOKEN: 'knowledgeCenter.ecosystem.auth.token',
  OAUTH: 'knowledgeCenter.ecosystem.auth.oauth',
  IMAP: 'knowledgeCenter.ecosystem.auth.imap',
  PUBLIC_URL: 'knowledgeCenter.ecosystem.auth.publicUrl',
};

const scheduleTypeNameIdMap: Record<string, string> = {
  once: 'knowledgeCenter.ecosystem.once',
  manual: 'knowledgeCenter.ecosystem.manual',
  daily: 'knowledgeCenter.ecosystem.daily',
  weekly: 'knowledgeCenter.ecosystem.weekly',
};

const scheduleHourOptions = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}));

const scheduleWeekdayMessageIdMap: Record<string, string> = {
  MONDAY: 'knowledgeCenter.ecosystem.weekday.monday',
  TUESDAY: 'knowledgeCenter.ecosystem.weekday.tuesday',
  WEDNESDAY: 'knowledgeCenter.ecosystem.weekday.wednesday',
  THURSDAY: 'knowledgeCenter.ecosystem.weekday.thursday',
  FRIDAY: 'knowledgeCenter.ecosystem.weekday.friday',
  SATURDAY: 'knowledgeCenter.ecosystem.weekday.saturday',
  SUNDAY: 'knowledgeCenter.ecosystem.weekday.sunday',
};

const scheduleWeekdayValues = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const runStatusColor = (status?: string) => {
  if (status === 'SUCCESS') {
    return 'success';
  }
  if (status === 'FAILED') {
    return 'error';
  }
  if (status === 'RUNNING') {
    return 'processing';
  }
  if (status === 'DISABLED' || status === 'ARCHIVED') {
    return 'default';
  }
  return 'default';
};

const formatTaskStatusName = (task: EcosystemTask, intl: ReturnType<typeof useIntl>) => {
  if (task.status === 'DISABLED') {
    return intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskStatus.disabled' });
  }
  if (task.status === 'ARCHIVED') {
    return intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskStatus.archived' });
  }
  return (
    task.lastRunStatusName || task.status || intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskStatus.notRun' })
  );
};

const sourcePresentationOverrides: Record<string, Partial<SourceOption>> = {
  github: { icon: <GithubOutlined />, accent: '#14161a' },
  web: { icon: <LinkOutlined />, accent: '#13a8a8' },
  mail: { icon: <MailOutlined />, accent: '#389e0d' },
  dingtalk: { icon: <ApiOutlined />, accent: '#d46b08' },
};

const sourceIconFor = (key: string) => {
  if (key === 'github') {
    return <GithubOutlined />;
  }
  if (key === 'web') {
    return <LinkOutlined />;
  }
  if (key === 'mail' || key.includes('mail')) {
    return <MailOutlined />;
  }
  if (key === 'dingtalk') {
    return <ApiOutlined />;
  }
  return <GlobalOutlined />;
};

const sourceAccentFor = (key: string, index: number) => {
  const override = sourcePresentationOverrides[key];
  if (override?.accent) {
    return override.accent;
  }
  const accents = ['#165dff', '#13a8a8', '#722ed1', '#d46b08', '#389e0d', '#eb2f96'];
  return accents[index % accents.length];
};

const hasServerCredentialAuth = (authTypes?: string[]) =>
  !!authTypes?.some((authType) => ['PUBLIC_URL', 'TOKEN', 'OAUTH', 'IMAP'].includes(authType));

const isCollectModeValue = (value?: string): value is CollectMode => collectModeValues.includes(value as CollectMode);

const deriveCollectModes = (connector?: EcosystemConnector, source?: SourceOption): CollectMode[] => {
  if (!connector && !source) {
    return [];
  }
  const appendMode = (modes: CollectMode[], mode: CollectMode) => {
    if (!modes.includes(mode)) {
      modes.push(mode);
    }
  };
  if (connector?.collectModes?.length) {
    const modes = connector.collectModes.filter(isCollectModeValue) as CollectMode[];
    const needsBrowserAuth = connector.authTypes?.includes('BROWSER') ?? source?.requiresBridge;
    if (needsBrowserAuth || source?.requiresBridge || source?.key === 'mail') {
      appendMode(modes, 'USER_BROWSER_BRIDGE');
    }
    if (modes.length) {
      return modes;
    }
  }
  const modes: CollectMode[] = [];
  if (connector?.runLocations?.includes('SERVER') && hasServerCredentialAuth(connector.authTypes)) {
    modes.push('SERVER_OPENCLI');
  }
  const needsBrowserAuth = connector?.authTypes?.includes('BROWSER') ?? source?.requiresBridge;
  if (needsBrowserAuth) {
    appendMode(modes, 'USER_BROWSER_BRIDGE');
  }
  if (source?.key === 'mail') {
    appendMode(modes, 'USER_BROWSER_BRIDGE');
  }
  if (!modes.length) {
    modes.push(source?.requiresBridge ? 'USER_BROWSER_BRIDGE' : 'SERVER_OPENCLI');
  }
  return modes;
};

const defaultCollectModeFor = (connector?: EcosystemConnector, source?: SourceOption): CollectMode => {
  const modes = deriveCollectModes(connector, source);
  if (!modes.length) {
    return 'SERVER_OPENCLI';
  }
  if (connector?.defaultCollectMode && modes.includes(connector.defaultCollectMode as CollectMode)) {
    return connector.defaultCollectMode as CollectMode;
  }
  if (source?.key === 'mail' && modes.includes('USER_BROWSER_BRIDGE')) {
    return 'USER_BROWSER_BRIDGE';
  }
  if (modes.includes('SERVER_OPENCLI')) {
    return 'SERVER_OPENCLI';
  }
  return modes[0];
};

const authTypeForCollectMode = (collectMode: CollectMode, connector?: EcosystemConnector) => {
  if (browserLoginCollectModes.includes(collectMode)) {
    return 'BROWSER';
  }
  return connector?.authTypes?.find((authType) => authType !== 'BROWSER') || 'PUBLIC_URL';
};

const runLocationForCollectMode = (collectMode: CollectMode) =>
  collectMode === 'USER_BROWSER_BRIDGE' ? 'LOCAL' : 'SERVER';

const signalFields = ['project', 'product', 'customer', 'domain'] as const;
const ALL_CATALOG_VALUE = '__ALL__';

const isAllCatalogValue = (value?: string | number) => !value || `${value}` === ALL_CATALOG_VALUE;

const normalizeCatalogValue = (value?: string | number) => (isAllCatalogValue(value) ? undefined : value);

const extractKnowledgeBaseRows = (response: any): any[] => {
  const responseData = response?.data;
  const candidates = [
    response?.list,
    response?.rows,
    response?.records,
    responseData?.list,
    responseData?.rows,
    responseData?.records,
    responseData?.data?.list,
    responseData?.data?.rows,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
};

const compareSemver = (left?: string, right?: string) => {
  const leftParts = String(left || '0.0.0')
    .split('.')
    .map((item) => Number.parseInt(item, 10) || 0);
  const rightParts = String(right || '0.0.0')
    .split('.')
    .map((item) => Number.parseInt(item, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((leftParts[index] || 0) > (rightParts[index] || 0)) {
      return 1;
    }
    if ((leftParts[index] || 0) < (rightParts[index] || 0)) {
      return -1;
    }
  }
  return 0;
};

const EcosystemCollector: React.FC<EcosystemCollectorProps> = ({
  open,
  ownerType,
  catalogList,
  initialSource,
  initialSourceUrl,
  initialScope,
  initialCollectMode,
  onCancel,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const formValues = Form.useWatch([], form) || {};
  const [activeSource, setActiveSource] = useState<SourceKey>('');
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('idle');
  const [connectorList, setConnectorList] = useState<EcosystemConnector[]>([]);
  const [agentStatus, setAgentStatus] = useState<EcosystemAgentStatus | null>(null);
  const [knowledgeBaseOptions, setKnowledgeBaseOptions] = useState<KnowledgeBaseOption[]>([]);
  const [knowledgeBaseLoading, setKnowledgeBaseLoading] = useState(false);
  const [taskList, setTaskList] = useState<EcosystemTask[]>([]);
  const [connectionList, setConnectionList] = useState<EcosystemConnection[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [createdTask, setCreatedTask] = useState<EcosystemTask | null>(null);
  const [runResult, setRunResult] = useState<EcosystemRun | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [runActionLoading, setRunActionLoading] = useState<string | null>(null);
  const [browserExtensionBindStatus, setBrowserExtensionBindStatus] = useState<BrowserExtensionBindStatus>('idle');
  const [browserExtensionStatus, setBrowserExtensionStatus] = useState<BrowserExtensionStatus>({
    installed: false,
  });
  const [browserExtensionPackageManifest, setBrowserExtensionPackageManifest] =
    useState<BrowserExtensionPackageManifest | null>(null);
  const [browserExtensionPackageLoading, setBrowserExtensionPackageLoading] = useState(false);
  const browserExtensionPingTimerRef = useRef<number | null>(null);
  const browserExtensionAutoRefreshRef = useRef(false);
  const initialFormAppliedRef = useRef(false);
  const allCategoryName = intl.formatMessage({ id: 'digitalEmployees.skillSquare.allCategory' });
  const sourceOptions = useMemo(() => {
    return connectorList
      .filter((connector) => connector.connectorCode)
      .map((connector, index) => {
        const key = connector.connectorCode;
        const override = sourcePresentationOverrides[key];
        return {
          key,
          icon: override?.icon || sourceIconFor(key),
          requiresBridge: connector.requiresBrowserAuth ?? false,
          outputCount: override?.outputCount || 6,
          accent: override?.accent || sourceAccentFor(key, index),
        };
      });
  }, [connectorList]);
  const formatSourceName = (sourceKey: string, connector?: EcosystemConnector) => {
    if (connector?.connectorName) {
      return connector.connectorName;
    }
    return intl.formatMessage({
      id: `knowledgeCenter.ecosystem.source.${sourceKey}`,
      defaultMessage: sourceKey || intl.formatMessage({ id: 'common.none' }),
    });
  };
  const scheduleWeekdayOptions = useMemo(
    () =>
      scheduleWeekdayValues.map((value) => ({
        value,
        label: intl.formatMessage({ id: scheduleWeekdayMessageIdMap[value] }),
      })),
    [intl]
  );
  const catalogTreeData = useMemo(
    () => [
      {
        catalogId: ALL_CATALOG_VALUE,
        catalogName: allCategoryName,
        pcatalogId: -1,
      },
      ...catalogList,
    ],
    [allCategoryName, catalogList]
  );

  useEffect(() => {
    if (!open) {
      initialFormAppliedRef.current = false;
      return;
    }
    if (initialFormAppliedRef.current) {
      return;
    }
    initialFormAppliedRef.current = true;
    const nextSource = initialSource || '';
    const nextSourceOption = sourceOptions.find((source) => source.key === nextSource) || sourceOptions[0];
    const nextCollectMode = isCollectModeValue(initialCollectMode)
      ? initialCollectMode
      : defaultCollectModeFor(undefined, nextSourceOption);
    setActiveSource(nextSource);
    setTaskStatus('idle');
    form.setFieldsValue({
      knowledgeBaseId: undefined,
      outputFormat: 'markdown',
      scheduleType: 'once',
      scheduleHour: 9,
      scheduleDayOfWeek: 'MONDAY',
      sourceUrl: initialSourceUrl || '',
      scope: initialScope || '',
      signalTags: ['ByKC', '生态采集'],
      catalogId: ALL_CATALOG_VALUE,
      project: '',
      product: '',
      customer: '',
      domain: '',
      connectionId: undefined,
      connectionName: '',
      connectionToken: '',
      account: '',
      imapHost: '',
      imapPort: 993,
      imapSsl: 'true',
      imapFolder: 'INBOX',
      chromeProfile: '',
      collectMode: nextCollectMode,
    });
  }, [form, initialCollectMode, initialScope, initialSource, initialSourceUrl, open, sourceOptions]);

  useEffect(() => {
    if (!open || !sourceOptions.length) {
      return;
    }
    const preferredSource = sourceOptions.find((source) => source.key === initialSource)?.key;
    const nextSource =
      activeSource && sourceOptions.some((source) => source.key === activeSource)
        ? activeSource
        : preferredSource || sourceOptions[0].key;
    if (nextSource !== activeSource) {
      const nextSourceOption = sourceOptions.find((source) => source.key === nextSource);
      const nextConnector = connectorList.find((connector) => connector.connectorCode === nextSource);
      setActiveSource(nextSource);
      form.setFieldsValue({
        collectMode: defaultCollectModeFor(nextConnector, nextSourceOption),
      });
    }
  }, [activeSource, connectorList, form, initialSource, open, sourceOptions]);

  useEffect(() => {
    if (!open || !activeSource) {
      setConnectionList([]);
      setConnectionLoading(false);
      return;
    }

    let canceled = false;
    setInitializing(true);
    setKnowledgeBaseLoading(true);
    setCreatedTask(null);
    setRunResult(null);
    Promise.all([
      queryEcosystemConnectors(),
      queryEcosystemBrowserBridgeStatus(),
      listResourceUseAuth({
        pageNum: 1,
        pageSize: 200,
        ownerType,
        resourceBizTypeList: ['KG_DOC'],
      }),
      queryEcosystemTasks(),
    ])
      .then(([connectors, status, knowledgeBaseResponse, tasks]) => {
        if (canceled) {
          return;
        }
        setConnectorList(connectors || []);
        setAgentStatus(status || null);
        setTaskList(tasks || []);
        const rows = extractKnowledgeBaseRows(knowledgeBaseResponse);
        const options = rows
          .filter((item: any) => item?.resourceId)
          .map((item: any) => ({
            value: `${item.resourceId}`,
            label: item.resourceName || item.resourceCode || `${item.resourceId}`,
            catalogId: item.catalogId === undefined || item.catalogId === null ? undefined : `${item.catalogId}`,
          }));
        setKnowledgeBaseOptions(options);
        if (!form.getFieldValue('knowledgeBaseId') && options.length) {
          form.setFieldsValue({ knowledgeBaseId: options[0].value });
        }
      })
      .catch(() => {
        if (!canceled) {
          message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.backendUnavailable' }));
        }
      })
      .finally(() => {
        if (!canceled) {
          setInitializing(false);
          setKnowledgeBaseLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [form, intl, open, ownerType]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let canceled = false;
    setConnectionLoading(true);
    queryEcosystemConnections({ connectorCode: activeSource })
      .then((connections) => {
        if (canceled) {
          return;
        }
        const list = connections || [];
        setConnectionList(list);
        const firstConnection = list[0];
        form.setFieldsValue({
          connectionId: firstConnection?.connectionId,
          connectionName: firstConnection?.connectionName || '',
          chromeProfile: firstConnection?.runtimeConfig?.chromeProfile || '',
          connectionToken: '',
        });
      })
      .catch(() => {
        if (!canceled) {
          setConnectionList([]);
        }
      })
      .finally(() => {
        if (!canceled) {
          setConnectionLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [activeSource, agentStatus?.chromeProfile, form, open]);

  const currentSource = useMemo(
    () => sourceOptions.find((item) => item.key === activeSource) || sourceOptions[0],
    [activeSource, sourceOptions]
  );
  const currentSourceOutputCount = currentSource?.outputCount || 0;
  const currentConnector = useMemo(
    () => connectorList.find((item) => item.connectorCode === activeSource),
    [activeSource, connectorList]
  );
  const runtimeSupported = Boolean(currentSource);

  const activeSourceName = formatSourceName(activeSource, currentConnector);
  const ownerName = intl.formatMessage({ id: `knowledgeCenter.ecosystem.owner.${ownerType}` });
  const collectModes = useMemo(
    () => deriveCollectModes(currentConnector, currentSource),
    [currentConnector, currentSource]
  );
  const defaultCollectMode = useMemo(
    () => defaultCollectModeFor(currentConnector, currentSource),
    [currentConnector, currentSource]
  );
  useEffect(() => {
    if (!open) {
      return;
    }
    const currentCollectMode = form.getFieldValue('collectMode');
    if (!currentCollectMode || !collectModes.includes(currentCollectMode)) {
      form.setFieldsValue({ collectMode: defaultCollectMode });
    }
  }, [collectModes, defaultCollectMode, form, open]);
  const selectedCollectMode = (
    collectModes.includes(formValues.collectMode) ? formValues.collectMode : defaultCollectMode
  ) as CollectMode;
  const isUserBrowserBridgeMode = selectedCollectMode === 'USER_BROWSER_BRIDGE';
  const isBrowserExtensionMode = isUserBrowserBridgeMode;
  const usesLocalBrowserAuth = isUserBrowserBridgeMode;
  const requiresBrowserAuth = browserLoginCollectModes.includes(selectedCollectMode);
  const collectModeExecutable = !plannedCollectModes.includes(selectedCollectMode);
  const primaryAuthType = authTypeForCollectMode(selectedCollectMode, currentConnector);
  const primaryRunLocation = runLocationForCollectMode(selectedCollectMode);
  const formatByIdMap = (map: Partial<Record<string, string>>, value?: string) =>
    value && map[value] ? intl.formatMessage({ id: map[value] }) : value || intl.formatMessage({ id: 'common.none' });
  const selectedCollectModeName = formatByIdMap(collectModeNameIdMap, selectedCollectMode);
  const primaryAuthTypeName = formatByIdMap(authTypeNameIdMap, primaryAuthType);
  const primaryRunLocationName = formatByIdMap(runLocationNameIdMap, primaryRunLocation);
  const selectedConnection = connectionList.find((item) => item.connectionId === formValues.connectionId);
  const isMailImapMode = activeSource === 'mail' && primaryAuthType === 'IMAP';
  const needsCredentialInput = ['TOKEN', 'OAUTH', 'IMAP'].includes(primaryAuthType);
  const needsConnectionConfig = primaryAuthType !== 'PUBLIC_URL' && !usesLocalBrowserAuth;
  const connectionDescText = isBrowserExtensionMode
    ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.connectionDesc' })
    : needsConnectionConfig
      ? intl.formatMessage(
        { id: 'knowledgeCenter.ecosystem.connectionDescWithAuth' },
        { authType: primaryAuthTypeName, runLocation: primaryRunLocationName }
      )
      : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionDescPublic' });
  const activeCollectorName = selectedCollectModeName;
  const scheduleTypeName =
    formatByIdMap(scheduleTypeNameIdMap, formValues.scheduleType) ||
    intl.formatMessage({ id: 'knowledgeCenter.ecosystem.once' });
  const showScheduleConfig = formValues.scheduleType === 'daily' || formValues.scheduleType === 'weekly';
  const selectedCatalogIdForFilter = normalizeCatalogValue(formValues.catalogId);
  const selectedCatalogIdsForFilter = useMemo(() => {
    if (!selectedCatalogIdForFilter) {
      return undefined;
    }
    const ids = new Set<string>();
    const appendCatalogAndChildren = (currentCatalogId: string | number) => {
      const currentId = `${currentCatalogId}`;
      ids.add(currentId);
      catalogList
        .filter((item) => `${item.pcatalogId}` === currentId)
        .forEach((item) => appendCatalogAndChildren(item.catalogId));
    };
    appendCatalogAndChildren(selectedCatalogIdForFilter);
    return ids;
  }, [catalogList, selectedCatalogIdForFilter]);
  const filteredKnowledgeBaseOptions = useMemo(() => {
    if (!selectedCatalogIdsForFilter || knowledgeBaseOptions.every((item) => !item.catalogId)) {
      return knowledgeBaseOptions;
    }
    return knowledgeBaseOptions.filter((item) => item.catalogId && selectedCatalogIdsForFilter.has(item.catalogId));
  }, [knowledgeBaseOptions, selectedCatalogIdsForFilter]);
  const selectedCatalogName = isAllCatalogValue(formValues.catalogId)
    ? allCategoryName
    : catalogList.find((item) => `${item.catalogId}` === `${formValues.catalogId}`)?.catalogName || allCategoryName;
  const selectedKnowledgeBaseName =
    knowledgeBaseOptions.find((item) => item.value === formValues.knowledgeBaseId)?.label ||
    intl.formatMessage({ id: 'knowledgeCenter.ecosystem.defaultPersonalKnowledge' });
  const importDestinationName = `${selectedCatalogName} / ${selectedKnowledgeBaseName}`;

  const toText = intl.formatMessage({ id: 'common.to' });
  const dateRangeStart = formValues.dateRange?.[0]?.format?.('YYYY-MM-DD') || '';
  const dateRangeEnd = formValues.dateRange?.[1]?.format?.('YYYY-MM-DD') || '';

  useEffect(() => {
    if (!open || knowledgeBaseLoading) {
      return;
    }
    const currentKnowledgeBaseId = form.getFieldValue('knowledgeBaseId');
    const hasCurrentKnowledgeBase =
      currentKnowledgeBaseId && filteredKnowledgeBaseOptions.some((item) => item.value === `${currentKnowledgeBaseId}`);
    if (filteredKnowledgeBaseOptions.length && !hasCurrentKnowledgeBase) {
      form.setFieldsValue({ knowledgeBaseId: filteredKnowledgeBaseOptions[0].value });
      return;
    }
    if (!filteredKnowledgeBaseOptions.length && currentKnowledgeBaseId) {
      form.setFieldsValue({ knowledgeBaseId: undefined });
    }
  }, [filteredKnowledgeBaseOptions, form, knowledgeBaseLoading, open]);

  const dateRangeText = formValues.dateRange?.length
    ? `${dateRangeStart} ${toText} ${dateRangeEnd}`
    : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.rangeRecent' });

  const sourceUrlRules = useMemo(() => {
    if (isBrowserExtensionMode) {
      return [];
    }
    if (activeSource !== 'web') {
      return [];
    }
    return [
      {
        required: true,
        message: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.sourceUrlRequired' }),
      },
    ];
  }, [activeSource, intl, isBrowserExtensionMode]);

  const signalSummary = signalFields
    .map((field) => formValues[field])
    .filter(Boolean)
    .join(' / ');

  const formatRunLocations = (locations?: string[]) =>
    locations?.map((item) => formatByIdMap(runLocationNameIdMap, item)).join(' / ') ||
    intl.formatMessage({ id: runLocationNameIdMap[primaryRunLocation] });

  const formatAuthTypes = (authTypes?: string[]) =>
    authTypes?.map((item) => formatByIdMap(authTypeNameIdMap, item)).join(' / ') ||
    intl.formatMessage({ id: authTypeNameIdMap[primaryAuthType] || 'common.none' });

  const signalGroups = useMemo(() => {
    const signals = (runResult?.signals || createdTask?.signals || []) as EcosystemSignal[];
    return signals.reduce<Array<{ typeName: string; signals: EcosystemSignal[] }>>((groups, signal) => {
      const typeName = signal.signalTypeName || intl.formatMessage({ id: 'knowledgeCenter.ecosystem.signal.other' });
      const matched = groups.find((item) => item.typeName === typeName);
      if (matched) {
        matched.signals.push(signal);
      } else {
        groups.push({ typeName, signals: [signal] });
      }
      return groups;
    }, []);
  }, [createdTask?.signals, intl, runResult?.signals]);

  const recentTaskList = useMemo(() => taskList.slice(0, 5), [taskList]);

  const reloadTaskList = async () => {
    const tasks = await queryEcosystemTasks();
    setTaskList(tasks || []);
  };

  const reloadConnectionList = async () => {
    const connections = await queryEcosystemConnections({ connectorCode: activeSource });
    setConnectionList(connections || []);
    return connections || [];
  };

  const buildTaskPayload = (values: Record<string, any>): EcosystemTaskCreatePayload => {
    const selectedKnowledgeBase = knowledgeBaseOptions.find((item) => `${item.value}` === `${values.knowledgeBaseId}`);
    const scheduleConfig =
      values.scheduleType === 'daily' || values.scheduleType === 'weekly'
        ? {
          hour: values.scheduleHour ?? 9,
          dayOfWeek: values.scheduleDayOfWeek || 'MONDAY',
          timezone: 'Asia/Shanghai',
        }
        : undefined;
    return {
      taskName: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskName' }, { source: activeSourceName }),
      connectorCode: activeSource,
      connectionId: values.connectionId,
      sourceUrl: values.sourceUrl,
      scope: values.scope || dateRangeText,
      ownerType,
      runLocation: primaryRunLocation,
      collectMode: selectedCollectMode,
      scheduleType: values.scheduleType || 'once',
      scheduleConfig,
      importTarget: 'knowledgeBase',
      catalogId: normalizeCatalogValue(values.catalogId),
      knowledgeBaseId: values.knowledgeBaseId ? `${values.knowledgeBaseId}` : undefined,
      knowledgeBaseResourceId: values.knowledgeBaseId,
      knowledgeBaseName: selectedKnowledgeBase?.label,
      project: values.project,
      product: values.product,
      customer: values.customer,
      domain: values.domain,
      signalTags: values.signalTags || [],
    };
  };

  const buildBrowserExtensionBinding = (values: Record<string, any>) => {
    const captureDefaults = buildTaskPayload(values);
    return {
      protocolVersion: browserExtensionProtocolVersion,
      minPluginVersion: browserExtensionMinVersion,
      portalOrigin: window.location.origin,
      apiBase: '/byaiService',
      websocketPath: '/byaiService/ws',
      language: getLocale(),
      auth: {
        userCode: localStorage.getItem('uc') || '',
        headers: {
          [tokenKey]: getToken(),
          [ssotokenKey]: getssoToken(),
          'x-session-id': getSessionKey(),
        },
      },
      captureDefaults: {
        ...captureDefaults,
        collectMode: 'USER_BROWSER_BRIDGE',
        runLocation: 'LOCAL',
        scheduleType: 'manual',
        sourceUrl: undefined,
      },
    };
  };

  const publishBrowserExtensionBinding = async (providedValues?: Record<string, any>, silent = false) => {
    const values = providedValues || (await form.validateFields());
    setBrowserExtensionBindStatus('binding');
    window.postMessage(
      {
        source: 'BYCLAW_PORTAL',
        type: 'BYCLAW_CAPTURE_BIND',
        payload: buildBrowserExtensionBinding(values),
      },
      window.location.origin
    );
    setTaskStatus('ready');
    window.setTimeout(() => {
      setBrowserExtensionBindStatus((status) => (status === 'binding' ? 'idle' : status));
    }, 3000);
    if (!silent) {
      message.info(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.bindingSent' }));
    }
  };

  const deriveBrowserExtensionBindStatus = (status: BrowserExtensionStatus): BrowserExtensionBindStatus => {
    if (status.checking) {
      return 'checking';
    }
    if (!status.installed) {
      return 'missing';
    }
    if (status.version && compareSemver(status.version, browserExtensionMinVersion) < 0) {
      return 'upgrade';
    }
    if (!status.binding?.bound) {
      return 'idle';
    }
    if (status.binding?.tokenStatus === 'EXPIRED' || status.binding?.tokenStatus === 'MISSING') {
      return 'expired';
    }
    return 'bound';
  };

  const syncBrowserExtensionStatus = (status: BrowserExtensionStatus, successTip = false) => {
    const nextStatus = { ...status, checking: false };
    const nextBindStatus = deriveBrowserExtensionBindStatus(nextStatus);
    setBrowserExtensionStatus(nextStatus);
    setBrowserExtensionBindStatus(nextBindStatus);
    if (successTip && nextBindStatus === 'bound') {
      message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.bound' }));
    }
    const shouldRefreshToken =
      isBrowserExtensionMode &&
      status.binding?.bound &&
      ['EXPIRED', 'EXPIRING_SOON'].includes(status.binding?.tokenStatus || '') &&
      !browserExtensionAutoRefreshRef.current;
    if (shouldRefreshToken) {
      browserExtensionAutoRefreshRef.current = true;
      form
        .validateFields()
        .then((values) => publishBrowserExtensionBinding(values, true))
        .catch(() => undefined);
    }
  };

  const refreshBrowserExtensionStatus = () => {
    if (browserExtensionPingTimerRef.current) {
      window.clearTimeout(browserExtensionPingTimerRef.current);
    }
    setBrowserExtensionStatus((status) => ({ ...status, checking: true }));
    setBrowserExtensionBindStatus('checking');
    window.postMessage(
      {
        source: 'BYCLAW_PORTAL',
        type: 'BYCLAW_CAPTURE_PING',
        payload: {
          expectedProtocolVersion: browserExtensionProtocolVersion,
          minPluginVersion: browserExtensionMinVersion,
        },
      },
      window.location.origin
    );
    browserExtensionPingTimerRef.current = window.setTimeout(() => {
      setBrowserExtensionStatus({ installed: false, checking: false });
      setBrowserExtensionBindStatus('missing');
    }, 1800);
  };

  useEffect(() => {
    if (!open || !isBrowserExtensionMode) {
      return undefined;
    }
    const handleBrowserExtensionMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== 'BYCLAW_EXTENSION') {
        return;
      }
      if (browserExtensionPingTimerRef.current) {
        window.clearTimeout(browserExtensionPingTimerRef.current);
        browserExtensionPingTimerRef.current = null;
      }
      if (event.data?.type === 'BYCLAW_CAPTURE_PONG') {
        syncBrowserExtensionStatus(event.data.payload || {});
      }
      if (event.data?.type === 'BYCLAW_CAPTURE_BIND_ACK') {
        syncBrowserExtensionStatus(event.data.payload || {}, true);
      }
      if (event.data?.type === 'BYCLAW_CAPTURE_UNBIND_ACK') {
        syncBrowserExtensionStatus(event.data.payload || {});
        message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.unbound' }));
      }
    };
    window.addEventListener('message', handleBrowserExtensionMessage);
    return () => window.removeEventListener('message', handleBrowserExtensionMessage);
  }, [form, intl, isBrowserExtensionMode, open]);

  useEffect(() => {
    if (!open || !isBrowserExtensionMode) {
      return undefined;
    }
    browserExtensionAutoRefreshRef.current = false;
    refreshBrowserExtensionStatus();
    const timer = window.setInterval(refreshBrowserExtensionStatus, 15000);
    return () => {
      window.clearInterval(timer);
      if (browserExtensionPingTimerRef.current) {
        window.clearTimeout(browserExtensionPingTimerRef.current);
        browserExtensionPingTimerRef.current = null;
      }
    };
  }, [isBrowserExtensionMode, open]);

  useEffect(() => {
    if (!open || !isBrowserExtensionMode) {
      return;
    }
    fetch(browserExtensionLatestManifestPath, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        if (manifest?.path) {
          setBrowserExtensionPackageManifest(manifest);
        }
      })
      .catch(() => undefined);
  }, [isBrowserExtensionMode, open]);

  const resolveBrowserExtensionPackageUrl = (path?: string) => {
    const packagePath = path || browserExtensionFallbackPackagePath;
    return new URL(packagePath, window.location.origin).toString();
  };

  const handleDownloadBrowserExtensionPackage = async () => {
    setBrowserExtensionPackageLoading(true);
    try {
      let manifest = browserExtensionPackageManifest;
      if (!manifest?.path) {
        const response = await fetch(browserExtensionLatestManifestPath, { cache: 'no-store' });
        if (response.ok) {
          manifest = await response.json();
          setBrowserExtensionPackageManifest(manifest || null);
        }
      }
      window.location.href = resolveBrowserExtensionPackageUrl(manifest?.path);
    } catch (error) {
      window.location.href = resolveBrowserExtensionPackageUrl();
    } finally {
      setBrowserExtensionPackageLoading(false);
    }
  };

  const handleCopyBrowserExtensionPath = async () => {
    await navigator.clipboard?.writeText(browserExtensionInstallPath);
    message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.pathCopied' }));
  };

  const handleCopyBrowserExtensionPackageCommand = async () => {
    await navigator.clipboard?.writeText(browserExtensionPackageCommand);
    message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.packageCommandCopied' }));
  };

  const handleUnbindBrowserExtension = () => {
    setBrowserExtensionBindStatus('binding');
    window.postMessage(
      {
        source: 'BYCLAW_PORTAL',
        type: 'BYCLAW_CAPTURE_UNBIND',
      },
      window.location.origin
    );
  };

  const previewMarkdown = useMemo(
    () =>
      [
        `# ${activeSourceName} ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewTitleSuffix' })}`,
        '',
        `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewSource' })}: ${activeSourceName}`,
        `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewOwner' })}: ${ownerName}`,
        `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewCollector' })}: ${activeCollectorName}`,
        `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewRange' })}: ${dateRangeText}`,
        `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewTarget' })}: ${importDestinationName}`,
        `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewSignals' })}: ${
          signalSummary || intl.formatMessage({ id: 'common.none' })
        }`,
        runResult
          ? `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewCollectCount' })}: ${runResult.totalCount}`
          : '',
        runResult ? `- Markdown: ${runResult.markdownCount}` : '',
        runResult
          ? `- ${intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewAttachments' })}: ${runResult.assetCount}`
          : '',
        '',
        intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewBody' }),
      ]
        .filter((line) => line !== '')
        .join('\n'),
    [
      activeCollectorName,
      activeSourceName,
      dateRangeText,
      importDestinationName,
      intl,
      ownerName,
      runResult,
      signalSummary,
    ]
  );

  const handleSelectConnection = (connectionId?: string) => {
    const connection = connectionList.find((item) => item.connectionId === connectionId);
    form.setFieldsValue({
      connectionId,
      connectionName: connection?.connectionName || '',
      chromeProfile: connection?.runtimeConfig?.chromeProfile || '',
      account: connection?.credentialConfig?.account || '',
      imapHost: connection?.credentialConfig?.imapHost || '',
      imapPort: connection?.credentialConfig?.imapPort || 993,
      imapSsl: `${connection?.credentialConfig?.imapSsl ?? 'true'}`,
      imapFolder: connection?.credentialConfig?.imapFolder || 'INBOX',
      connectionToken: '',
    });
  };

  const handleSaveConnection = async () => {
    const values = form.getFieldsValue();
    if (needsCredentialInput && !values.connectionToken && !selectedConnection?.credentialConfig?.hasToken) {
      message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.credentialRequired' }));
      return;
    }
    if (isMailImapMode && (!values.account || !values.imapHost)) {
      message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.mailImapRequired' }));
      return;
    }
    try {
      setConnectionSaving(true);
      const connection = await saveEcosystemConnection({
        connectionId: values.connectionId,
        connectorCode: activeSource,
        authType: primaryAuthType,
        runLocation: primaryRunLocation,
        collectMode: selectedCollectMode,
        connectionName:
          values.connectionName ||
          intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionName' }, { source: activeSourceName }),
        token: values.connectionToken,
        account: values.account,
        imapHost: values.imapHost,
        imapPort: values.imapPort,
        imapSsl: values.imapSsl,
        imapFolder: values.imapFolder,
        chromeProfile: values.chromeProfile || selectedConnection?.runtimeConfig?.chromeProfile,
      });
      const connections = await reloadConnectionList();
      const nextConnection = connections.find((item) => item.connectionId === connection.connectionId) || connection;
      setConnectionList((prev) =>
        prev.some((item) => item.connectionId === nextConnection.connectionId) ? prev : [nextConnection, ...prev]
      );
      form.setFieldsValue({
        connectionId: nextConnection.connectionId,
        connectionName: nextConnection.connectionName,
        chromeProfile: nextConnection.runtimeConfig?.chromeProfile || values.chromeProfile || '',
        account: nextConnection.credentialConfig?.account || values.account || '',
        imapHost: nextConnection.credentialConfig?.imapHost || values.imapHost || '',
        imapPort: nextConnection.credentialConfig?.imapPort || values.imapPort || 993,
        imapSsl: `${nextConnection.credentialConfig?.imapSsl ?? values.imapSsl ?? 'true'}`,
        imapFolder: nextConnection.credentialConfig?.imapFolder || values.imapFolder || 'INBOX',
        connectionToken: '',
      });
      message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionSaved' }));
    } finally {
      setConnectionSaving(false);
    }
  };

  const handleGeneratePreview = async () => {
    await form.validateFields();
    setTaskStatus('ready');
    message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.previewGenerated' }));
  };

  const handleCreateTrialTask = async () => {
    try {
      const values = await form.validateFields();
      if (!runtimeSupported) {
        message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.unsupportedRuntimeWarning' }));
        return;
      }
      if (!collectModeExecutable) {
        message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.collectModePlannedWarning' }));
        return;
      }
      if (isBrowserExtensionMode) {
        await publishBrowserExtensionBinding(values);
        return;
      }
      if (needsConnectionConfig && !values.connectionId) {
        message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionRequired' }));
        return;
      }
      setSubmitting(true);
      setTaskStatus('running');
      const task = await createEcosystemTask(buildTaskPayload(values));
      setCreatedTask(task);
      const run = await startEcosystemRun({
        taskId: task.taskId,
        triggerType: 'MANUAL',
      });
      setRunResult(run);
      setTaskStatus(run.status === 'SUCCESS' ? 'completed' : run.status === 'RUNNING' ? 'running' : 'failed');
      await reloadTaskList();
      message.success(
        intl.formatMessage({
          id:
            run.status === 'RUNNING'
              ? 'knowledgeCenter.ecosystem.bridgeTaskDispatched'
              : 'knowledgeCenter.ecosystem.taskCompleted',
        })
      );
    } catch (error) {
      if (error) {
        setTaskStatus('failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryTask = async (task: EcosystemTask) => {
    try {
      setRunningTaskId(task.taskId);
      setCreatedTask(task);
      setTaskStatus('running');
      const run = await startEcosystemRun({
        taskId: task.taskId,
        triggerType: 'RETRY',
      });
      setRunResult(run);
      setTaskStatus(run.status === 'SUCCESS' ? 'completed' : run.status === 'RUNNING' ? 'running' : 'failed');
      await reloadTaskList();
      message.success(
        intl.formatMessage({
          id:
            run.status === 'RUNNING'
              ? 'knowledgeCenter.ecosystem.bridgeTaskDispatched'
              : 'knowledgeCenter.ecosystem.taskRerun',
        })
      );
    } catch (error) {
      if (error) {
        setTaskStatus('failed');
      }
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleOpenTaskRun = async (task: EcosystemTask) => {
    if (!task.lastRunId) {
      return;
    }
    const run = await queryEcosystemRun({ runId: task.lastRunId });
    setCreatedTask(task);
    setRunResult(run);
    setTaskStatus(run.status === 'SUCCESS' ? 'completed' : run.status === 'RUNNING' ? 'running' : 'failed');
  };

  const handleToggleTaskStatus = async (task: EcosystemTask) => {
    const nextStatus = task.status === 'DISABLED' ? 'CREATED' : 'DISABLED';
    try {
      setUpdatingTaskId(task.taskId);
      await updateEcosystemTaskStatus({
        taskId: task.taskId,
        status: nextStatus,
      });
      await reloadTaskList();
      message.success(
        intl.formatMessage({
          id:
            nextStatus === 'DISABLED'
              ? 'knowledgeCenter.ecosystem.taskDisabled'
              : 'knowledgeCenter.ecosystem.taskEnabled',
        })
      );
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handleRunAction = async (action: string) => {
    if (!runResult?.runId) {
      return;
    }
    try {
      setRunActionLoading(action);
      const run = await handleEcosystemRunAction({
        runId: runResult.runId,
        action,
      });
      setRunResult(run);
      setTaskStatus(
        run.status === 'SUCCESS'
          ? 'completed'
          : run.status === 'RUNNING'
            ? 'running'
            : run.status === 'SKIPPED'
              ? 'ready'
              : 'failed'
      );
      await reloadTaskList();
      message.success(
        intl.formatMessage({
          id:
            action === 'CANCEL'
              ? 'knowledgeCenter.ecosystem.runActionCancelled'
              : action === 'SKIP'
                ? 'knowledgeCenter.ecosystem.runActionSkipped'
                : 'knowledgeCenter.ecosystem.runUpdated',
        })
      );
    } finally {
      setRunActionLoading(null);
    }
  };

  const handleRefreshLocalAgentStatus = async () => {
    try {
      setInitializing(true);
      const status = await queryEcosystemBrowserBridgeStatus();
      setAgentStatus(status || null);
      message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.statusRefreshed' }));
    } finally {
      setInitializing(false);
    }
  };

  const browserExtensionTokenStatus = browserExtensionStatus.binding?.tokenStatus || 'UNBOUND';
  const browserExtensionTokenStatusName = browserExtensionTokenStatusNameIdMap[browserExtensionTokenStatus]
    ? intl.formatMessage({ id: browserExtensionTokenStatusNameIdMap[browserExtensionTokenStatus] })
    : browserExtensionStatus.binding?.tokenStatusName || browserExtensionTokenStatus;
  const browserExtensionStatusName = intl.formatMessage({
    id: browserExtensionBindStatusNameIdMap[browserExtensionBindStatus],
  });
  const browserExtensionStatusTagColor =
    browserExtensionBindStatus === 'bound'
      ? 'success'
      : browserExtensionBindStatus === 'expired'
        ? 'error'
        : browserExtensionBindStatus === 'upgrade'
          ? 'warning'
          : browserExtensionBindStatus === 'missing'
            ? 'default'
            : 'processing';
  const browserExtensionAlertType =
    browserExtensionBindStatus === 'expired'
      ? 'error'
      : browserExtensionBindStatus === 'upgrade'
        ? 'warning'
        : browserExtensionBindStatus === 'missing' || browserExtensionBindStatus === 'idle'
          ? 'info'
          : 'success';
  const browserExtensionAlertId =
    browserExtensionBindStatus === 'expired'
      ? 'knowledgeCenter.ecosystem.browserExtension.expiredTip'
      : browserExtensionBindStatus === 'upgrade'
        ? 'knowledgeCenter.ecosystem.browserExtension.upgradeTip'
        : browserExtensionBindStatus === 'missing'
          ? 'knowledgeCenter.ecosystem.browserExtension.installTip'
          : browserExtensionBindStatus === 'idle'
            ? 'knowledgeCenter.ecosystem.browserExtension.bindTip'
            : 'knowledgeCenter.ecosystem.browserExtension.readyTip';

  return (
    <Drawer
      title={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.title' })}
      open={open}
      width="100vw"
      onClose={onCancel}
      destroyOnHidden
      className={styles.drawer}
      footer={
        <div className={styles.footer}>
          <Button onClick={onCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
          <Space>
            <Button icon={<FileMarkdownOutlined />} onClick={handleGeneratePreview}>
              {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.generatePreview' })}
            </Button>
            <Button
              type="primary"
              icon={usesLocalBrowserAuth ? <ChromeOutlined /> : <PlayCircleOutlined />}
              loading={submitting || (isBrowserExtensionMode && browserExtensionBindStatus === 'binding')}
              onClick={handleCreateTrialTask}
            >
              {intl.formatMessage({
                id: isBrowserExtensionMode
                  ? 'knowledgeCenter.ecosystem.browserExtension.bindAndCapture'
                  : 'knowledgeCenter.ecosystem.createAndStart',
              })}
            </Button>
          </Space>
        </div>
      }
    >
      <div className={styles.body}>
        <div className={styles.sourcePanel}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.sources' })}</div>
            <div className={styles.sectionDesc}>
              {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.sourcesDesc' })}
            </div>
          </div>
          <div className={styles.sourceList}>
            {!sourceOptions.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.noDynamicSources' })}
              />
            ) : null}
            {sourceOptions.map((source) => {
              const selected = source.key === activeSource;
              const connector = connectorList.find((item) => item.connectorCode === source.key);
              const sourceRequiresBrowserAuth = connector?.requiresBrowserAuth ?? source.requiresBridge;
              return (
                <button
                  key={source.key}
                  type="button"
                  className={classNames(styles.sourceCard, { [styles.selectedSourceCard]: selected })}
                  style={{ '--source-accent': source.accent } as React.CSSProperties}
                  onClick={() => {
                    setActiveSource(source.key);
                    setTaskStatus('idle');
                    form.setFieldsValue({
                      connectionId: undefined,
                      connectionName: '',
                      connectionToken: '',
                      account: '',
                      imapHost: '',
                      imapPort: 993,
                      imapSsl: 'true',
                      imapFolder: 'INBOX',
                      chromeProfile: '',
                      collectMode: defaultCollectModeFor(connector, source),
                    });
                  }}
                >
                  <span className={styles.sourceIcon}>{source.icon}</span>
                  <span className={styles.sourceInfo}>
                    <span className={styles.sourceName}>{formatSourceName(source.key, connector)}</span>
                    <span className={styles.sourceMeta}>
                      {sourceRequiresBrowserAuth
                        ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.needBrowserLogin' })
                        : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.serverReady' })}
                    </span>
                    {connector ? (
                      <span className={styles.sourceDetailMeta}>
                        {formatRunLocations(connector.runLocations)} · {formatAuthTypes(connector.authTypes)}
                      </span>
                    ) : null}
                  </span>
                  {selected ? <CheckCircleOutlined className={styles.selectedIcon} /> : null}
                </button>
              );
            })}
          </div>
          <Alert
            className={styles.bridgeAlert}
            type={!runtimeSupported ? 'warning' : requiresBrowserAuth ? 'warning' : 'info'}
            showIcon
            message={
              !runtimeSupported
                ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.unsupportedRuntimeTitle' })
                : requiresBrowserAuth
                  ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserAuthRequired' })
                  : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.bridgeOptional' })
            }
            description={
              !runtimeSupported
                ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.unsupportedRuntimeDesc' })
                : undefined
            }
          />
          <div className={styles.agentSnapshot}>
            <div className={styles.agentHeader}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserLoginCapability' })}</span>
              <Space size={8}>
                <Tag color={agentStatus?.connected ? 'success' : 'default'}>
                  {initializing
                    ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.detecting' })
                    : agentStatus?.connected
                      ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.online' })
                      : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.offline' })}
                </Tag>
                <Button size="small" onClick={handleRefreshLocalAgentStatus} loading={initializing}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.refresh' })}
                </Button>
              </Space>
            </div>
            <div className={styles.agentDetails}>
              <div>
                {agentStatus?.agentName || intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.unboundDevice' })}
              </div>
              <div>
                {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.runtime' })}：
                {agentStatus?.runtimeName ||
                  intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.title' })}
                {agentStatus?.runtimeVersion ? ` ${agentStatus.runtimeVersion}` : ''}
              </div>
              <div>
                {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.channelStatus' })}：
                {agentStatus?.browserBridgeStatus ||
                  intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.offline' })}
              </div>
              <div>
                Profile：
                {agentStatus?.chromeProfile || intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.unbound' })}
              </div>
            </div>
            {agentStatus?.siteSessions?.length ? (
              <div className={styles.siteSessionList}>
                {agentStatus.siteSessions.map((site) => (
                  <Tag key={site.siteCode} color={site.status === 'LOGGED_IN' ? 'success' : 'default'}>
                    {site.siteName}：{site.statusName}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.mainPanel}>
          <Form
            form={form}
            layout="vertical"
            className={styles.configForm}
            onValuesChange={() => {
              if (taskStatus !== 'idle') {
                setTaskStatus('idle');
              }
              if (createdTask || runResult) {
                setCreatedTask(null);
                setRunResult(null);
              }
            }}
          >
            <div className={styles.collectConditionCard}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.collectConditions' })}
                </div>
                <div className={styles.sectionDesc}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.collectConditionsDesc' })}
                </div>
              </div>
              <div className={styles.conditionSummaryGrid}>
                <div className={styles.conditionSummaryItem}>
                  <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.conditionSource' })}</span>
                  <strong>{activeSourceName}</strong>
                </div>
                <div className={styles.conditionSummaryItem}>
                  <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.conditionCollector' })}</span>
                  <strong>{activeCollectorName}</strong>
                </div>
                <div className={styles.conditionSummaryItem}>
                  <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.conditionTrigger' })}</span>
                  <strong>{scheduleTypeName}</strong>
                </div>
                <div className={styles.conditionSummaryItem}>
                  <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.conditionRange' })}</span>
                  <strong>{dateRangeText}</strong>
                </div>
              </div>

              <Form.Item name="collectMode" className={styles.collectModeSelector}>
                <Segmented
                  block
                  options={collectModes.map((mode) => ({
                    value: mode,
                    label: intl.formatMessage({ id: collectModeNameIdMap[mode] }),
                    disabled: plannedCollectModes.includes(mode),
                  }))}
                />
              </Form.Item>

              <div className={styles.collectorStatusGrid}>
                {collectModes.map((mode) => {
                  const selected = mode === selectedCollectMode;
                  const planned = plannedCollectModes.includes(mode);
                  return (
                    <div
                      key={mode}
                      className={classNames(styles.collectorStatusItem, {
                        [styles.activeCollectorStatus]: selected,
                        [styles.disabledCollectorStatus]: planned,
                      })}
                    >
                      <div className={styles.collectorStatusTop}>
                        <span className={styles.collectorStatusIcon}>
                          {mode === 'SERVER_OPENCLI' ? <CloudSyncOutlined /> : <ChromeOutlined />}
                        </span>
                        <span className={styles.collectorStatusName}>
                          {intl.formatMessage({ id: collectModeNameIdMap[mode] })}
                        </span>
                        <Tag color={selected ? 'success' : planned ? 'default' : 'processing'}>
                          {intl.formatMessage({
                            id: planned
                              ? 'knowledgeCenter.ecosystem.collectMode.planned'
                              : selected
                                ? 'knowledgeCenter.ecosystem.collectMode.current'
                                : 'knowledgeCenter.ecosystem.collectMode.available',
                          })}
                        </Tag>
                      </div>
                      <div className={styles.collectorStatusDesc}>
                        {intl.formatMessage({ id: collectModeDescIdMap[mode] })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.connectionConfigBlock}>
                <div className={styles.connectionHeader}>
                  <div>
                    <div className={styles.connectionTitle}>
                      {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionConfig' })}
                    </div>
                    <div className={styles.connectionDesc}>{connectionDescText}</div>
                  </div>
                  <Tag color={selectedConnection?.status === 'READY' ? 'success' : 'warning'}>
                    {selectedConnection?.statusName ||
                      intl.formatMessage({
                        id: needsConnectionConfig
                          ? 'knowledgeCenter.ecosystem.connectionNotConfigured'
                          : 'knowledgeCenter.ecosystem.connectionNoNeed',
                      })}
                  </Tag>
                </div>

                {isUserBrowserBridgeMode ? (
                  <div className={styles.browserExtensionBlock}>
                    <div className={styles.browserExtensionHeader}>
                      <div>
                        <div className={styles.browserExtensionTitle}>
                          {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.title' })}
                        </div>
                        <div className={styles.browserExtensionDesc}>
                          {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.desc' })}
                        </div>
                      </div>
                      <Tag color={browserExtensionStatusTagColor}>{browserExtensionStatusName}</Tag>
                    </div>
                    <Alert
                      className={styles.browserExtensionAlert}
                      showIcon
                      type={browserExtensionAlertType}
                      message={intl.formatMessage(
                        { id: browserExtensionAlertId },
                        {
                          version: browserExtensionStatus.version || '-',
                          minVersion: browserExtensionMinVersion,
                          tokenStatus: browserExtensionTokenStatusName,
                        }
                      )}
                    />
                    <div className={styles.browserExtensionProtocol}>
                      <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.protocol' })}</span>
                      <code>{browserExtensionProtocolVersion}</code>
                      <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.version' })}</span>
                      <code>
                        {browserExtensionStatus.installed
                          ? browserExtensionStatus.version || '-'
                          : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.notDetected' })}
                      </code>
                      <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.minVersion' })}</span>
                      <code>{browserExtensionMinVersion}</code>
                      <span>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.tokenStatus' })}
                      </span>
                      <code>{browserExtensionTokenStatusName}</code>
                      <span>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.tokenExpiresAt' })}
                      </span>
                      <code>
                        {browserExtensionStatus.binding?.expiresAt ||
                          intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.tokenUnknown' })}
                      </code>
                      <span>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.installPath' })}
                      </span>
                      <code>{browserExtensionInstallPath}</code>
                      <span>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.packageCommand' })}
                      </span>
                      <code>{browserExtensionPackageCommand}</code>
                      <span>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.downloadPath' })}
                      </span>
                      <code>{browserExtensionPackageManifest?.path || browserExtensionFallbackPackagePath}</code>
                    </div>
                    {browserExtensionStatus.binding?.warning?.message ? (
                      <div className={styles.browserExtensionWarning}>
                        {browserExtensionStatus.binding.warning.message}
                      </div>
                    ) : null}
                    <div className={styles.browserExtensionActions}>
                      <Button
                        type="primary"
                        icon={<ChromeOutlined />}
                        loading={browserExtensionBindStatus === 'binding'}
                        onClick={() => publishBrowserExtensionBinding()}
                      >
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.bind' })}
                      </Button>
                      <Button
                        loading={browserExtensionBindStatus === 'checking'}
                        onClick={refreshBrowserExtensionStatus}
                      >
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.checkInstall' })}
                      </Button>
                      <Button
                        icon={<DownloadOutlined />}
                        loading={browserExtensionPackageLoading}
                        onClick={handleDownloadBrowserExtensionPackage}
                      >
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.downloadPackage' })}
                      </Button>
                      <Button icon={<CopyOutlined />} onClick={handleCopyBrowserExtensionPath}>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.copyPath' })}
                      </Button>
                      <Button icon={<CopyOutlined />} onClick={handleCopyBrowserExtensionPackageCommand}>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.copyPackageCommand' })}
                      </Button>
                      <Button
                        danger
                        disabled={!browserExtensionStatus.binding?.bound}
                        onClick={handleUnbindBrowserExtension}
                      >
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.browserExtension.unbind' })}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {needsConnectionConfig ? (
                  <>
                    <div className={styles.connectionFormGrid}>
                      <Form.Item
                        label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.savedConnection' })}
                        name="connectionId"
                      >
                        <Select
                          allowClear
                          loading={connectionLoading}
                          placeholder={intl.formatMessage({
                            id: 'knowledgeCenter.ecosystem.savedConnectionPlaceholder',
                          })}
                          options={connectionList.map((connection) => ({
                            value: connection.connectionId,
                            label: `${connection.connectionName} · ${connection.statusName}`,
                          }))}
                          onChange={handleSelectConnection}
                        />
                      </Form.Item>
                      <Form.Item
                        label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionNameLabel' })}
                        name="connectionName"
                      >
                        <Input
                          placeholder={intl.formatMessage(
                            { id: 'knowledgeCenter.ecosystem.connectionName' },
                            { source: activeSourceName }
                          )}
                        />
                      </Form.Item>
                      {isMailImapMode ? (
                        <>
                          <Form.Item
                            label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.mailAccount' })}
                            name="account"
                          >
                            <Input
                              placeholder={intl.formatMessage({
                                id: 'knowledgeCenter.ecosystem.mailAccountPlaceholder',
                              })}
                            />
                          </Form.Item>
                          <Form.Item
                            label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.imapHost' })}
                            name="imapHost"
                          >
                            <Input
                              placeholder={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.imapHostPlaceholder' })}
                            />
                          </Form.Item>
                          <Form.Item
                            label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.imapPort' })}
                            name="imapPort"
                          >
                            <Input placeholder="993" />
                          </Form.Item>
                          <Form.Item
                            label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.imapSsl' })}
                            name="imapSsl"
                          >
                            <Select
                              options={[
                                {
                                  value: 'true',
                                  label: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.enabled' }),
                                },
                                {
                                  value: 'false',
                                  label: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.disabled' }),
                                },
                              ]}
                            />
                          </Form.Item>
                          <Form.Item
                            label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.imapFolder' })}
                            name="imapFolder"
                          >
                            <Input placeholder="INBOX" />
                          </Form.Item>
                        </>
                      ) : null}
                      {needsCredentialInput ? (
                        <Form.Item
                          label={intl.formatMessage(
                            { id: 'knowledgeCenter.ecosystem.credentialLabel' },
                            { authType: primaryAuthTypeName }
                          )}
                          name="connectionToken"
                        >
                          <Input.Password
                            autoComplete="new-password"
                            placeholder={
                              selectedConnection?.credentialConfig?.hasToken
                                ? intl.formatMessage(
                                  { id: 'knowledgeCenter.ecosystem.tokenConfiguredLast4' },
                                  { last4: selectedConnection?.credentialConfig?.tokenLast4 || '****' }
                                )
                                : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.credentialPlaceholder' })
                            }
                          />
                        </Form.Item>
                      ) : null}
                    </div>
                    <div className={styles.connectionActionBar}>
                      <span>
                        {selectedConnection
                          ? intl.formatMessage(
                            { id: 'knowledgeCenter.ecosystem.recentCheck' },
                            {
                              time:
                                  selectedConnection.lastCheckTime ||
                                  intl.formatMessage({ id: 'knowledgeCenter.ecosystem.noRecentCheck' }),
                            }
                          )
                          : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionBindHint' })}
                      </span>
                      <Button loading={connectionSaving} onClick={handleSaveConnection}>
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.saveConnection' })}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>

              <div className={styles.formGrid}>
                <Form.Item
                  label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.scheduleType' })}
                  name="scheduleType"
                  rules={[{ required: true }]}
                >
                  <Segmented
                    block
                    options={[
                      {
                        value: 'once',
                        label: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.once' }),
                      },
                      {
                        value: 'manual',
                        label: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.manual' }),
                      },
                      {
                        value: 'daily',
                        label: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.daily' }),
                      },
                      {
                        value: 'weekly',
                        label: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.weekly' }),
                      },
                    ]}
                  />
                </Form.Item>
                <Form.Item label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.dateRange' })} name="dateRange">
                  <RangePicker className={styles.fullWidth} />
                </Form.Item>
              </div>
              {showScheduleConfig ? (
                <div className={styles.scheduleConfigGrid}>
                  {formValues.scheduleType === 'weekly' ? (
                    <Form.Item
                      label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.scheduleDayOfWeek' })}
                      name="scheduleDayOfWeek"
                      rules={[{ required: true }]}
                    >
                      <Select options={scheduleWeekdayOptions} />
                    </Form.Item>
                  ) : null}
                  <Form.Item
                    label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.scheduleHour' })}
                    name="scheduleHour"
                    rules={[{ required: true }]}
                  >
                    <Select options={scheduleHourOptions} />
                  </Form.Item>
                  <div className={styles.scheduleHint}>
                    {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.scheduleHint' })}
                  </div>
                </div>
              ) : null}

              <Form.Item
                label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.sourceUrl' })}
                name="sourceUrl"
                rules={sourceUrlRules}
              >
                <Input
                  placeholder={intl.formatMessage({
                    id: `knowledgeCenter.ecosystem.placeholder.${activeSource}`,
                    defaultMessage: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.placeholder.web' }),
                  })}
                />
              </Form.Item>

              <Form.Item label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.scope' })} name="scope">
                <Input.TextArea
                  rows={3}
                  maxLength={300}
                  showCount
                  placeholder={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.scopePlaceholder' })}
                />
              </Form.Item>
            </div>

            <div className={styles.signalConfigCard}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.signalConfigTitle' })}
                </div>
                <div className={styles.sectionDesc}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.signalConfigDesc' })}
                </div>
              </div>

              <div className={styles.signalGrid}>
                {signalFields.map((field) => (
                  <Form.Item
                    key={field}
                    label={intl.formatMessage({ id: `knowledgeCenter.ecosystem.signal.${field}` })}
                    name={field}
                  >
                    <Input
                      placeholder={intl.formatMessage(
                        { id: 'common.enter' },
                        { field: intl.formatMessage({ id: `knowledgeCenter.ecosystem.signal.${field}` }) }
                      )}
                    />
                  </Form.Item>
                ))}
              </div>

              <Form.Item label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.signalTags' })} name="signalTags">
                <Select
                  mode="tags"
                  tokenSeparators={[',']}
                  suffixIcon={<TagsOutlined />}
                  placeholder={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.signalTagsPlaceholder' })}
                />
              </Form.Item>
            </div>

            <div className={styles.importConfigCard}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.knowledgeBaseImport' })}
                </div>
                <div className={styles.sectionDesc}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.knowledgeBaseImportDesc' })}
                </div>
              </div>

              <div className={styles.formGrid}>
                <Form.Item
                  label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetCatalog' })}
                  name="catalogId"
                >
                  <TreeSelect
                    allowClear
                    treeData={catalogTreeData}
                    placeholder={allCategoryName}
                    treeDataSimpleMode={{
                      id: 'catalogId',
                      pId: 'pcatalogId',
                      rootPId: -1,
                    }}
                    fieldNames={{
                      label: 'catalogName',
                      value: 'catalogId',
                    }}
                    showSearch
                    treeNodeFilterProp="catalogName"
                  />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetKnowledgeBase' })}
                  name="knowledgeBaseId"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetKnowledgeBaseRequired' }),
                    },
                  ]}
                >
                  <Select
                    loading={knowledgeBaseLoading}
                    options={filteredKnowledgeBaseOptions}
                    placeholder={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetKnowledgeBasePlaceholder' })}
                    notFoundContent={
                      knowledgeBaseLoading
                        ? intl.formatMessage({ id: 'common.loading' })
                        : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.noKnowledgeBase' })
                    }
                  />
                </Form.Item>
              </div>
            </div>
          </Form>
        </div>

        <div className={styles.previewPanel}>
          <div className={styles.sectionHeader}>
            <div className={styles.previewHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.outputPreview' })}
                </div>
                <div className={styles.sectionDesc}>
                  {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.outputPreviewDesc' })}
                </div>
              </div>
              <Tag color={taskStatusMap[taskStatus].color}>
                {intl.formatMessage({ id: taskStatusMap[taskStatus].messageId })}
              </Tag>
            </div>
          </div>
          <div className={styles.metricGrid}>
            <div className={styles.metricItem}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.metricMarkdown' })}</span>
              <strong>{runResult?.markdownCount ?? currentSourceOutputCount}</strong>
            </div>
            <div className={styles.metricItem}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.metricAssets' })}</span>
              <strong>{runResult?.assetCount ?? Math.max(0, Math.floor(currentSourceOutputCount / 3))}</strong>
            </div>
            <div className={styles.metricItem}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.metricManifest' })}</span>
              <strong>1</strong>
            </div>
          </div>
          {createdTask ? (
            <div className={styles.taskResultBlock}>
              <div className={styles.resultLine}>
                <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskId' })}</span>
                <code>{createdTask.taskId}</code>
              </div>
              {runResult ? (
                <div className={styles.resultLine}>
                  <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.runId' })}</span>
                  <code>{runResult.runId}</code>
                </div>
              ) : null}
              <div className={styles.resultLine}>
                <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.resultTarget' })}</span>
                <strong>{runResult?.targetName || createdTask.targetName}</strong>
              </div>
            </div>
          ) : null}
          {recentTaskList.length ? (
            <div className={styles.taskHistoryBlock}>
              <Text className={styles.previewTitle}>
                {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.recentTasks' })}
              </Text>
              <div className={styles.taskHistoryList}>
                {recentTaskList.map((task) => (
                  <div key={task.taskId} className={styles.taskHistoryItem}>
                    <div className={styles.taskHistoryTop}>
                      <span>{task.taskName}</span>
                      <Tag color={runStatusColor(task.status === 'DISABLED' ? task.status : task.lastRunStatus)}>
                        {formatTaskStatusName(task, intl)}
                      </Tag>
                    </div>
                    <div className={styles.taskHistoryMeta}>
                      <span>{task.sourceName}</span>
                      <span>{task.scheduleTypeName || formatByIdMap(scheduleTypeNameIdMap, task.scheduleType)}</span>
                      <span>
                        {task.nextRunTime
                          ? intl.formatMessage(
                            { id: 'knowledgeCenter.ecosystem.nextRunTime' },
                            { time: task.nextRunTime }
                          )
                          : task.lastRunTime || task.createTime}
                      </span>
                    </div>
                    <div className={styles.taskHistoryActions}>
                      <Button size="small" disabled={!task.lastRunId} onClick={() => handleOpenTaskRun(task)}>
                        {intl.formatMessage({ id: 'common.view' })}
                      </Button>
                      <Button
                        size="small"
                        type={task.status === 'DISABLED' ? 'default' : 'primary'}
                        disabled={task.status === 'DISABLED'}
                        loading={runningTaskId === task.taskId}
                        onClick={() => handleRetryTask(task)}
                      >
                        {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.rerun' })}
                      </Button>
                      <Button
                        size="small"
                        loading={updatingTaskId === task.taskId}
                        onClick={() => handleToggleTaskStatus(task)}
                      >
                        {intl.formatMessage({
                          id:
                            task.status === 'DISABLED'
                              ? 'knowledgeCenter.ecosystem.enable'
                              : 'knowledgeCenter.ecosystem.disable',
                        })}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {runResult?.needActionMessage && runResult.needActionStatus !== 'SKIPPED' ? (
            <Alert
              className={styles.runAlert}
              type={runResult.status === 'SUCCESS' || runResult.status === 'RUNNING' ? 'info' : 'error'}
              showIcon
              message={runResult.needActionType || intl.formatMessage({ id: 'knowledgeCenter.ecosystem.runNotice' })}
              description={runResult.needActionMessage}
              action={
                <Space direction="vertical" size={6}>
                  {runResult.status === 'RUNNING' ? (
                    <Button
                      danger
                      size="small"
                      loading={runActionLoading === 'CANCEL'}
                      onClick={() => handleRunAction('CANCEL')}
                    >
                      {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.cancelRun' })}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    loading={runActionLoading === 'RECHECK_BROWSER_BRIDGE'}
                    onClick={() => handleRunAction('RECHECK_BROWSER_BRIDGE')}
                  >
                    {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.recheck' })}
                  </Button>
                  <Button size="small" loading={runActionLoading === 'SKIP'} onClick={() => handleRunAction('SKIP')}>
                    {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.skipCurrent' })}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={runActionLoading === 'RETRY'}
                    onClick={() => handleRunAction('RETRY')}
                  >
                    {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.rerun' })}
                  </Button>
                </Space>
              }
            />
          ) : null}
          {runResult?.steps?.length ? (
            <div className={styles.pipelineBlock}>
              <Text className={styles.previewTitle}>
                {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.pipeline' })}
              </Text>
              <div className={styles.pipelineList}>
                {runResult.steps.map((step) => (
                  <div key={step.stepCode} className={styles.pipelineStep}>
                    <div className={styles.pipelineStepTop}>
                      <span>{step.stepName}</span>
                      <Tag
                        color={step.status === 'SUCCESS' ? 'success' : step.status === 'SKIPPED' ? 'default' : 'error'}
                      >
                        {step.statusName}
                      </Tag>
                    </div>
                    <div className={styles.pipelineMessage}>{step.message}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className={styles.previewBlock}>
            <Text className={styles.previewTitle}>
              {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.markdownPreview' })}
            </Text>
            <pre>{previewMarkdown}</pre>
          </div>
          <div className={styles.manifestBlock}>
            <Text className={styles.previewTitle}>
              {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.manifest' })}
            </Text>
            <div className={styles.manifestLine}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.storagePath' })}</span>
              <code>{runResult?.storagePath || `ecosystem/users/{userId}/runs/{runId}/`}</code>
            </div>
            <div className={styles.manifestLine}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.outputFormat' })}</span>
              <code>raw / normalized / assets / manifest.json</code>
            </div>
            {runResult?.artifacts?.length ? (
              <div className={styles.artifactList}>
                {runResult.artifacts.map((artifact) => (
                  <div
                    key={`${artifact.artifactType}-${artifact.fileId || artifact.artifactName}`}
                    className={styles.artifactItem}
                  >
                    <span>
                      {artifact.artifactName}
                      {artifact.fileId ? <Tag>fileId：{artifact.fileId}</Tag> : null}
                    </span>
                    <code>{artifact.fileUrl || artifact.storagePath}</code>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.signalBlock}>
            <Text className={styles.previewTitle}>
              {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.identifiedSignals' })}
            </Text>
            {signalGroups.length ? (
              <div className={styles.signalGroupList}>
                {signalGroups.map((group) => (
                  <div key={group.typeName} className={styles.signalGroup}>
                    <div className={styles.signalGroupTitle}>{group.typeName}</div>
                    <div className={styles.signalTags}>
                      {group.signals.map((signal) => (
                        <Tag key={`${signal.signalType}-${signal.signalCode}`}>{signal.signalName}</Tag>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyHint}>
                {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.emptySignals' })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default EcosystemCollector;
