import React, { useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ChromeOutlined,
  CloudSyncOutlined,
  FileMarkdownOutlined,
  GithubOutlined,
  GlobalOutlined,
  LinkOutlined,
  MailOutlined,
  PlayCircleOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
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
  detectEcosystemLocalAgent,
  handleEcosystemRunAction,
  queryEcosystemConnections,
  queryEcosystemConnectors,
  queryEcosystemLocalAgentStatus,
  queryEcosystemTasks,
  queryEcosystemRun,
  queryAuthDoc,
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
import styles from './index.module.less';

type OwnerType = 'personal' | 'enterprise';
type SourceKey = 'zhihu' | 'github' | 'web' | 'mail' | 'dingtalk';
type TaskStatus = 'idle' | 'ready' | 'running' | 'completed' | 'failed';

interface EcosystemCollectorProps {
  open: boolean;
  ownerType: OwnerType;
  catalogId: string;
  catalogList: Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>;
  initialSource?: SourceKey;
  initialSourceUrl?: string;
  initialScope?: string;
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

const sourceOptions: SourceOption[] = [
  {
    key: 'zhihu',
    icon: <GlobalOutlined />,
    requiresBridge: true,
    outputCount: 12,
    accent: '#165dff',
  },
  {
    key: 'github',
    icon: <GithubOutlined />,
    requiresBridge: false,
    outputCount: 18,
    accent: '#14161a',
  },
  {
    key: 'web',
    icon: <LinkOutlined />,
    requiresBridge: false,
    outputCount: 8,
    accent: '#13a8a8',
  },
  {
    key: 'mail',
    icon: <MailOutlined />,
    requiresBridge: false,
    outputCount: 24,
    accent: '#389e0d',
  },
  {
    key: 'dingtalk',
    icon: <ApiOutlined />,
    requiresBridge: true,
    outputCount: 16,
    accent: '#d46b08',
  },
];

const signalFields = ['project', 'product', 'customer', 'domain'] as const;

const EcosystemCollector: React.FC<EcosystemCollectorProps> = ({
  open,
  ownerType,
  catalogId,
  catalogList,
  initialSource,
  initialSourceUrl,
  initialScope,
  onCancel,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const formValues = Form.useWatch([], form) || {};
  const [activeSource, setActiveSource] = useState<SourceKey>('zhihu');
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
  const scheduleWeekdayOptions = useMemo(
    () =>
      scheduleWeekdayValues.map((value) => ({
        value,
        label: intl.formatMessage({ id: scheduleWeekdayMessageIdMap[value] }),
      })),
    [intl]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextSource =
      initialSource && sourceOptions.some((source) => source.key === initialSource) ? initialSource : 'zhihu';
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
      signalTags: ['ByKC', 'OpenCLI'],
      catalogId: catalogId || undefined,
      project: '',
      product: '',
      customer: '',
      domain: '',
      connectionId: undefined,
      connectionName: '',
      connectionToken: '',
      chromeProfile: '',
    });
  }, [catalogId, form, initialScope, initialSource, initialSourceUrl, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let canceled = false;
    setInitializing(true);
    setKnowledgeBaseLoading(true);
    setCreatedTask(null);
    setRunResult(null);
    Promise.all([
      queryEcosystemConnectors(),
      queryEcosystemLocalAgentStatus(),
      queryAuthDoc({ pageNum: 1, pageSize: 100, type: 'owner', resourceBizTypes: ['KG_DOC'] }),
      queryEcosystemTasks(),
    ])
      .then(([connectors, status, knowledgeBaseResponse, tasks]) => {
        if (canceled) {
          return;
        }
        setConnectorList(connectors || []);
        setAgentStatus(status || null);
        setTaskList(tasks || []);
        let rows: any[] = [];
        if (Array.isArray(knowledgeBaseResponse?.rows)) {
          rows = knowledgeBaseResponse.rows;
        } else if (Array.isArray(knowledgeBaseResponse?.list)) {
          rows = knowledgeBaseResponse.list;
        }
        const options = rows
          .filter((item: any) => item?.resourceId)
          .map((item: any) => ({
            value: `${item.resourceId}`,
            label: item.resourceName || item.resourceCode || `${item.resourceId}`,
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
  }, [open]);

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
          chromeProfile: firstConnection?.runtimeConfig?.chromeProfile || agentStatus?.chromeProfile || 'bykc-local',
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
    [activeSource]
  );
  const currentConnector = useMemo(
    () => connectorList.find((item) => item.connectorCode === activeSource),
    [activeSource, connectorList]
  );
  const runtimeSupported = activeSource === 'zhihu' || activeSource === 'web';

  const activeSourceName = intl.formatMessage({ id: `knowledgeCenter.ecosystem.source.${activeSource}` });
  const ownerName = intl.formatMessage({ id: `knowledgeCenter.ecosystem.owner.${ownerType}` });
  const requiresLocalAgent = currentConnector?.requiresLocalAgent ?? currentSource.requiresBridge;
  const primaryAuthType = currentConnector?.authTypes?.[0] || (requiresLocalAgent ? 'BROWSER' : 'PUBLIC_URL');
  const primaryRunLocation = currentConnector?.runLocations?.[0] || (requiresLocalAgent ? 'LOCAL' : 'SERVER');
  const formatByIdMap = (map: Record<string, string>, value?: string) =>
    value && map[value] ? intl.formatMessage({ id: map[value] }) : value || intl.formatMessage({ id: 'common.none' });
  const primaryAuthTypeName = formatByIdMap(authTypeNameIdMap, primaryAuthType);
  const primaryRunLocationName = formatByIdMap(runLocationNameIdMap, primaryRunLocation);
  const selectedConnection = connectionList.find((item) => item.connectionId === formValues.connectionId);
  const needsCredentialInput = ['TOKEN', 'OAUTH', 'IMAP'].includes(primaryAuthType);
  const needsConnectionConfig = primaryAuthType !== 'PUBLIC_URL';
  const connectionDescText = needsConnectionConfig
    ? intl.formatMessage(
      { id: 'knowledgeCenter.ecosystem.connectionDescWithAuth' },
      { authType: primaryAuthTypeName, runLocation: primaryRunLocationName }
    )
    : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionDescPublic' });
  const activeCollectorName = requiresLocalAgent
    ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.localCollector' })
    : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.serverCollector' });
  const scheduleTypeName =
    formatByIdMap(scheduleTypeNameIdMap, formValues.scheduleType) ||
    intl.formatMessage({ id: 'knowledgeCenter.ecosystem.once' });
  const showScheduleConfig = formValues.scheduleType === 'daily' || formValues.scheduleType === 'weekly';
  const selectedCatalogName =
    catalogList.find((item) => `${item.catalogId}` === `${formValues.catalogId}`)?.catalogName ||
    intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetDefault' });
  const selectedKnowledgeBaseName =
    knowledgeBaseOptions.find((item) => item.value === formValues.knowledgeBaseId)?.label ||
    intl.formatMessage({ id: 'knowledgeCenter.ecosystem.defaultPersonalKnowledge' });
  const importDestinationName = `${selectedCatalogName} / ${selectedKnowledgeBaseName}`;

  const toText = intl.formatMessage({ id: 'common.to' });
  const dateRangeStart = formValues.dateRange?.[0]?.format?.('YYYY-MM-DD') || '';
  const dateRangeEnd = formValues.dateRange?.[1]?.format?.('YYYY-MM-DD') || '';

  const dateRangeText = formValues.dateRange?.length
    ? `${dateRangeStart} ${toText} ${dateRangeEnd}`
    : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.rangeRecent' });

  const sourceUrlRules = useMemo(() => {
    if (activeSource !== 'zhihu' && activeSource !== 'web') {
      return [];
    }
    return [
      {
        required: true,
        message: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.sourceUrlRequired' }),
      },
    ];
  }, [activeSource, intl]);

  const signalSummary = signalFields
    .map((field) => formValues[field])
    .filter(Boolean)
    .join(' / ');

  const formatRunLocations = (locations?: string[]) =>
    locations?.map((item) => formatByIdMap(runLocationNameIdMap, item)).join(' / ') ||
    (requiresLocalAgent
      ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.runLocation.local' })
      : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.runLocation.server' }));

  const formatAuthTypes = (authTypes?: string[]) =>
    authTypes?.map((item) => formatByIdMap(authTypeNameIdMap, item)).join(' / ') ||
    (requiresLocalAgent
      ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.auth.browser' })
      : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.auth.publicUrl' }));

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
      runLocation: requiresLocalAgent ? 'LOCAL' : 'SERVER',
      scheduleType: values.scheduleType || 'once',
      scheduleConfig,
      importTarget: 'knowledgeBase',
      catalogId: values.catalogId,
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
      chromeProfile: connection?.runtimeConfig?.chromeProfile || agentStatus?.chromeProfile || 'bykc-local',
      connectionToken: '',
    });
  };

  const handleSaveConnection = async () => {
    const values = form.getFieldsValue();
    if (needsCredentialInput && !values.connectionToken && !selectedConnection?.credentialConfig?.hasToken) {
      message.warning(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.credentialRequired' }));
      return;
    }
    try {
      setConnectionSaving(true);
      const connection = await saveEcosystemConnection({
        connectionId: values.connectionId,
        connectorCode: activeSource,
        authType: primaryAuthType,
        runLocation: primaryRunLocation,
        connectionName:
          values.connectionName ||
          intl.formatMessage({ id: 'knowledgeCenter.ecosystem.connectionName' }, { source: activeSourceName }),
        token: values.connectionToken,
        chromeProfile: values.chromeProfile || agentStatus?.chromeProfile || 'bykc-local',
      });
      const connections = await reloadConnectionList();
      const nextConnection = connections.find((item) => item.connectionId === connection.connectionId) || connection;
      setConnectionList((prev) =>
        prev.some((item) => item.connectionId === nextConnection.connectionId) ? prev : [nextConnection, ...prev]
      );
      form.setFieldsValue({
        connectionId: nextConnection.connectionId,
        connectionName: nextConnection.connectionName,
        chromeProfile: nextConnection.runtimeConfig?.chromeProfile || values.chromeProfile || 'bykc-local',
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
      setTaskStatus(run.status === 'SUCCESS' ? 'completed' : 'failed');
      await reloadTaskList();
      message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskCompleted' }));
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
      setTaskStatus(run.status === 'SUCCESS' ? 'completed' : 'failed');
      await reloadTaskList();
      message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.taskRerun' }));
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
    setTaskStatus(run.status === 'SUCCESS' ? 'completed' : 'failed');
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
      setTaskStatus(run.status === 'SUCCESS' ? 'completed' : run.status === 'SKIPPED' ? 'ready' : 'failed');
      await reloadTaskList();
      message.success(
        intl.formatMessage({
          id: action === 'SKIP' ? 'knowledgeCenter.ecosystem.runActionSkipped' : 'knowledgeCenter.ecosystem.runUpdated',
        })
      );
    } finally {
      setRunActionLoading(null);
    }
  };

  const handleDetectLocalAgent = async () => {
    try {
      setInitializing(true);
      const status = await detectEcosystemLocalAgent();
      setAgentStatus(status || null);
      message.success(intl.formatMessage({ id: 'knowledgeCenter.ecosystem.localAgentDetected' }));
    } finally {
      setInitializing(false);
    }
  };

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
            <Button type="primary" icon={<PlayCircleOutlined />} loading={submitting} onClick={handleCreateTrialTask}>
              {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.createAndStart' })}
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
            {sourceOptions.map((source) => {
              const selected = source.key === activeSource;
              const connector = connectorList.find((item) => item.connectorCode === source.key);
              const sourceRequiresLocalAgent = connector?.requiresLocalAgent ?? source.requiresBridge;
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
                      chromeProfile: agentStatus?.chromeProfile || 'bykc-local',
                    });
                  }}
                >
                  <span className={styles.sourceIcon}>{source.icon}</span>
                  <span className={styles.sourceInfo}>
                    <span className={styles.sourceName}>
                      {intl.formatMessage({ id: `knowledgeCenter.ecosystem.source.${source.key}` })}
                    </span>
                    <span className={styles.sourceMeta}>
                      {sourceRequiresLocalAgent
                        ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.needBridge' })
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
            type={!runtimeSupported ? 'warning' : requiresLocalAgent ? 'warning' : 'info'}
            showIcon
            message={
              !runtimeSupported
                ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.unsupportedRuntimeTitle' })
                : requiresLocalAgent
                  ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.bridgeRequired' })
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
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.localCollector' })}</span>
              <Space size={8}>
                <Tag color={agentStatus?.connected ? 'success' : 'default'}>
                  {initializing
                    ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.detecting' })
                    : agentStatus?.connected
                      ? intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.online' })
                      : intl.formatMessage({ id: 'knowledgeCenter.ecosystem.agent.offline' })}
                </Tag>
                <Button size="small" onClick={handleDetectLocalAgent} loading={initializing}>
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
                {agentStatus?.runtimeName || 'OpenCLI'}
                {agentStatus?.runtimeVersion ? ` ${agentStatus.runtimeVersion}` : ''}
              </div>
              <div>
                Browser Bridge：
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

              <div className={styles.collectorStatusGrid}>
                <div
                  className={classNames(styles.collectorStatusItem, {
                    [styles.activeCollectorStatus]: requiresLocalAgent,
                  })}
                >
                  <div className={styles.collectorStatusTop}>
                    <span className={styles.collectorStatusIcon}>
                      <ChromeOutlined />
                    </span>
                    <span className={styles.collectorStatusName}>
                      {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.localCollector' })}
                    </span>
                    <Tag color={requiresLocalAgent ? 'warning' : 'default'}>
                      {intl.formatMessage({
                        id: requiresLocalAgent
                          ? 'knowledgeCenter.ecosystem.localRequired'
                          : 'knowledgeCenter.ecosystem.localOptional',
                      })}
                    </Tag>
                  </div>
                  <div className={styles.collectorStatusDesc}>
                    {intl.formatMessage({
                      id: requiresLocalAgent
                        ? 'knowledgeCenter.ecosystem.localRequiredDesc'
                        : 'knowledgeCenter.ecosystem.localOptionalDesc',
                    })}
                  </div>
                </div>

                <div
                  className={classNames(styles.collectorStatusItem, {
                    [styles.activeCollectorStatus]: !requiresLocalAgent,
                    [styles.disabledCollectorStatus]: requiresLocalAgent,
                  })}
                >
                  <div className={styles.collectorStatusTop}>
                    <span className={styles.collectorStatusIcon}>
                      <CloudSyncOutlined />
                    </span>
                    <span className={styles.collectorStatusName}>
                      {intl.formatMessage({ id: 'knowledgeCenter.ecosystem.serverCollector' })}
                    </span>
                    <Tag color={requiresLocalAgent ? 'default' : 'success'}>
                      {intl.formatMessage({
                        id: requiresLocalAgent
                          ? 'knowledgeCenter.ecosystem.serverUnavailable'
                          : 'knowledgeCenter.ecosystem.serverAvailable',
                      })}
                    </Tag>
                  </div>
                  <div className={styles.collectorStatusDesc}>
                    {intl.formatMessage({
                      id: requiresLocalAgent
                        ? 'knowledgeCenter.ecosystem.serverUnavailableDesc'
                        : 'knowledgeCenter.ecosystem.serverAvailableDesc',
                    })}
                  </div>
                </div>
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
                      ) : (
                        <Form.Item label="Chrome Profile" name="chromeProfile">
                          <Input placeholder={agentStatus?.chromeProfile || 'bykc-local'} />
                        </Form.Item>
                      )}
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
                  placeholder={intl.formatMessage({ id: `knowledgeCenter.ecosystem.placeholder.${activeSource}` })}
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
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetCatalogRequired' }),
                    },
                  ]}
                >
                  <TreeSelect
                    allowClear
                    treeData={catalogList}
                    placeholder={intl.formatMessage({ id: 'knowledgeCenter.ecosystem.targetCatalogRequired' })}
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
                    disabled={!formValues.catalogId}
                    loading={knowledgeBaseLoading}
                    options={knowledgeBaseOptions}
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
              <strong>{runResult?.markdownCount ?? currentSource.outputCount}</strong>
            </div>
            <div className={styles.metricItem}>
              <span>{intl.formatMessage({ id: 'knowledgeCenter.ecosystem.metricAssets' })}</span>
              <strong>{runResult?.assetCount ?? Math.max(2, Math.floor(currentSource.outputCount / 3))}</strong>
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
                        {formatTaskStatusName(task)}
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
              type={runResult.status === 'SUCCESS' ? 'info' : 'error'}
              showIcon
              message={runResult.needActionType || intl.formatMessage({ id: 'knowledgeCenter.ecosystem.runNotice' })}
              description={runResult.needActionMessage}
              action={
                <Space direction="vertical" size={6}>
                  <Button
                    size="small"
                    loading={runActionLoading === 'RECHECK_LOCAL_AGENT'}
                    onClick={() => handleRunAction('RECHECK_LOCAL_AGENT')}
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
