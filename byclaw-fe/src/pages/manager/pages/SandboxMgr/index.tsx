import React, { useState, useEffect, useCallback, useRef } from 'react';
import classNames from 'classnames';
import {
  DashboardOutlined,
  DatabaseOutlined,
  EyeOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  PlusOutlined,
  EditOutlined,
  RocketOutlined,
  ClearOutlined,
  ThunderboltOutlined,
  FormatPainterOutlined,
  CopyOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons';
import { trim } from 'lodash';
import {
  message,
  Table,
  Button,
  Input,
  Space,
  Popconfirm,
  Select,
  Typography,
  Tooltip,
  Row,
  Col,
  Switch,
  Tag,
  Drawer,
  Form,
  InputNumber,
  Modal,
  Tabs,
} from 'antd';
import { useIntl, useDispatch, useSelector } from '@umijs/max';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';
import JsonCodeEditor from '@/pages/manager/components/JsonCodeEditor';
import { getPreferredServiceKey, removePreferredServiceKey } from '@/pages/manager/service/SandboxMgr';
import { isAdminVip } from '@/pages/manager/utils/auth';
import { buildServiceSpecPayload, isServiceSpecAutoStartEnabled, type ServiceSpecConfig } from './serviceSpecUtils';
import { formatWorkerLeaseTtl, getWorkerLivenessStatus } from './sandboxLivenessUtils';

import styles from './index.module.less';

const { Option } = Select;
const RELEASABLE_STATUSES = ['STARTING', 'RUNNING'];
const DEFAULT_SERVICE_TYPE = 'openclaw';
const PROFILE_ORDER: Record<string, number> = { xs: 1, s: 2, m: 3, l: 4 };
const RESIZE_STRATEGIES = ['IN_PLACE', 'PREFERRED_ONLY', 'HOT_SWITCH'];

const formatTimestamp = (value?: string | number | null) => {
  if (!value) return '-';
  const d =
    typeof value === 'number' || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
};

const renderEllipsisText = (value?: string | number | null) => {
  if (value === undefined || value === null || value === '') return '-';
  return (
    <Tooltip title={String(value)}>
      <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
        {String(value)}
      </Typography.Text>
    </Tooltip>
  );
};

const compactJson = (value?: string | null) => {
  if (!value) return '-';
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
};

const parseJsonObject = (value?: string | null): Record<string, string> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const formatCpu = (value?: string | number | null) => {
  if (value === undefined || value === null || value === '') return '-';
  const raw = String(value).trim();
  if (!raw) return '-';
  if (raw.endsWith('m')) {
    const milli = Number(raw.slice(0, -1));
    if (!Number.isNaN(milli)) {
      return `${Number((milli / 1000).toFixed(2))}C`;
    }
  }
  return `${raw}C`;
};

const formatMemory = (value?: string | number | null) => {
  if (value === undefined || value === null || value === '') return '-';
  const raw = String(value).trim();
  if (!raw) return '-';
  return raw.replace(/Mi$/i, ' MiB').replace(/Gi$/i, ' GiB');
};

const resizeStatusColorMap: Record<string, string> = {
  REQUESTED: 'processing',
  RUNNING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  DEFERRED: 'warning',
  SKIPPED: 'default',
};

interface SsSandboxRecord {
  id: number;
  resourceId: number;
  userCode: string;
  sandboxType: string;
  endpoint: string;
  sandboxId?: string;
  chatId: string;
  status: string;
  autoRelease: number;
  leasePolicy?: string;
  timeoutSeconds?: number;
  remoteExpiresAt?: string | number;
  lastRenewAt?: string | number;
  nextRenewAt?: string | number;
  lastAccessTime?: string | number;
  releaseTime?: string | number;
  releaseReason?: string;
  version?: number;
  createTime?: string | number;
  updateTime?: string | number;
  workerId?: string;
  workerOnline?: boolean;
  workerLastSeen?: number;
  workerLeaseTtlSeconds?: number;
  workerAgentTypes?: string[];
  serviceType?: string;
  profileKey?: string;
  resourceRequests?: string;
  resourceLimits?: string;
  resizeStatus?: string;
  lastResizeAt?: string | number;
  lastResizeReason?: string;
  lastResizeDurationMs?: number;
  lastResizeSuccess?: number;
  lastResizeFromProfile?: string;
  lastResizeToProfile?: string;
  lastResizeError?: string;
}

type ServiceSpecItem = ServiceSpecConfig;

interface ServiceProfileItem {
  id?: number;
  serviceType: string;
  profileKey: string;
  resourceRequests?: string;
  resourceLimits?: string;
  resizeEnabled?: number;
  resizeStrategy?: string;
  enabled?: number;
  sortOrder?: number;
}

interface SandboxResizeRecord {
  id: number;
  sandboxRecordId: number;
  sandboxId?: string;
  userCode?: string;
  serviceType?: string;
  fromProfileKey?: string;
  toProfileKey?: string;
  fromResourceRequests?: string;
  fromResourceLimits?: string;
  toResourceRequests?: string;
  toResourceLimits?: string;
  triggerSource?: string;
  reasonCode?: string;
  reasonDetail?: string;
  resizeType?: string;
  status?: string;
  success?: number;
  startedAt?: string | number;
  finishedAt?: string | number;
  durationMs?: number;
  opensandboxRequestId?: string;
  errorMessage?: string;
}

interface SandboxHealthWatermarkModel {
  id?: number;
  modelName?: string;
  serviceType?: string;
  profileKey?: string;
  enabled?: number;
  priority?: number;
  idleMemoryLimitRatio?: number;
  busyMemoryLimitRatio?: number;
  criticalMemoryLimitRatio?: number;
  busyCpuRequestRatio?: number;
  criticalCpuRequestRatio?: number;
  consecutiveBusySamples?: number;
  recoverSamples?: number;
  sampleIntervalSeconds?: number;
  snapshotTtlSeconds?: number;
  watchTtlSeconds?: number;
  remark?: string;
}

const SandboxMgr = () => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const showLaunchButton = isAdminVip(userInfo);
  const [pageInfo, setPageInfo] = useState({ pageIndex: 1, pageSize: 20, total: 0, totalPage: 0 });
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('RUNNING');
  const [list, setList] = useState<SsSandboxRecord[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  // 沙箱配置抽屉相关状态
  const [specDrawerOpen, setSpecDrawerOpen] = useState(false);
  const [specList, setSpecList] = useState<ServiceSpecItem[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [specFormVisible, setSpecFormVisible] = useState(false);
  const [maximizedField, setMaximizedField] = useState<'specJson' | 'templateJson' | null>(null);
  const [editingSpec, setEditingSpec] = useState<ServiceSpecItem | null>(null);
  const [specForm] = Form.useForm();
  const [savingSpec, setSavingSpec] = useState(false);
  const [updatingSpecKey, setUpdatingSpecKey] = useState<string | null>(null);

  // 沙箱弹性计算配置相关状态
  const [specDrawerTab, setSpecDrawerTab] = useState('spec');
  const [profileList, setProfileList] = useState<ServiceProfileItem[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [resizeForm] = Form.useForm();
  const [resizeSandboxList, setResizeSandboxList] = useState<SsSandboxRecord[]>([]);
  const [resizeSandboxLoading, setResizeSandboxLoading] = useState(false);
  const [selectedResizeRecord, setSelectedResizeRecord] = useState<SsSandboxRecord | null>(null);
  const [resizeRecords, setResizeRecords] = useState<SandboxResizeRecord[]>([]);
  const [resizeRecordsLoading, setResizeRecordsLoading] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [profileFormVisible, setProfileFormVisible] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServiceProfileItem | null>(null);
  const [profileForm] = Form.useForm();
  const [savingProfile, setSavingProfile] = useState(false);

  // 沙箱健康检测/水位模型相关状态
  const [healthSwitch, setHealthSwitch] = useState<any>({});
  const [healthSwitchLoading, setHealthSwitchLoading] = useState(false);
  const [watermarkList, setWatermarkList] = useState<SandboxHealthWatermarkModel[]>([]);
  const [watermarkLoading, setWatermarkLoading] = useState(false);
  const [watermarkFormVisible, setWatermarkFormVisible] = useState(false);
  const [editingWatermark, setEditingWatermark] = useState<SandboxHealthWatermarkModel | null>(null);
  const [watermarkForm] = Form.useForm();
  const [savingWatermark, setSavingWatermark] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<any>(null);

  // 指定用户沙箱相关状态
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [launchForm] = Form.useForm();
  const [launching, setLaunching] = useState(false);
  const [launchSpecList, setLaunchSpecList] = useState<ServiceSpecItem[]>([]);
  const [preferredMap, setPreferredMap] = useState<Record<string, string>>({});

  const refreshTimer = useRef<NodeJS.Timeout | null>(null);
  const curParam = useRef<{ pageIndex?: number; pageSize?: number; keyword?: string; status?: string }>({});
  const watchedProfileKey = Form.useWatch('profileKey', resizeForm);
  const watchedResizeType = Form.useWatch('resizeType', resizeForm) || 'IN_PLACE';
  const targetProfile = profileList.find((item) => item.profileKey === watchedProfileKey);

  const getResourceInfo = (requests?: string | null, limits?: string | null) => {
    const requestObj = parseJsonObject(requests);
    const limitObj = parseJsonObject(limits);
    return {
      requestCpu: formatCpu(requestObj.cpu),
      requestMemory: formatMemory(requestObj.memory),
      limitCpu: formatCpu(limitObj.cpu),
      limitMemory: formatMemory(limitObj.memory),
      rawRequests: compactJson(requests),
      rawLimits: compactJson(limits),
    };
  };

  const getProfileLabel = (profileKey?: string, serviceType?: string) => {
    if (!profileKey) return serviceType || '-';
    const key = profileKey.toLowerCase();
    return intl.formatMessage(
      {
        id: `sandboxMgr.elastic.profile.${key}`,
        defaultMessage: `${serviceType || DEFAULT_SERVICE_TYPE}-${profileKey}`,
      },
      { serviceType: serviceType || DEFAULT_SERVICE_TYPE, profileKey }
    );
  };

  const getProfileColor = (profileKey?: string) => {
    const key = profileKey?.toLowerCase();
    if (key === 'xs') return 'default';
    if (key === 's') return 'blue';
    if (key === 'm') return 'purple';
    if (key === 'l') return 'volcano';
    return 'default';
  };

  const getResizeStrategyLabel = (value?: string) =>
    value ? intl.formatMessage({ id: `sandboxMgr.elastic.strategy.${value}`, defaultMessage: value }) : '-';

  const getResizeStrategyDesc = (value?: string) =>
    value ? intl.formatMessage({ id: `sandboxMgr.elastic.strategy.${value}.desc`, defaultMessage: value }) : '-';

  const getResizeStatusLabel = (value?: string) =>
    value ? intl.formatMessage({ id: `sandboxMgr.elastic.status.${value}`, defaultMessage: value }) : '-';

  const getTriggerSourceLabel = (value?: string) =>
    value ? intl.formatMessage({ id: `sandboxMgr.elastic.trigger.${value}`, defaultMessage: value }) : '-';

  const getProfileCompareLabel = (fromProfile?: string, toProfile?: string) => {
    const fromOrder = PROFILE_ORDER[(fromProfile || '').toLowerCase()] || 0;
    const toOrder = PROFILE_ORDER[(toProfile || '').toLowerCase()] || 0;
    if (!fromOrder || !toOrder || fromOrder === toOrder) {
      return intl.formatMessage({ id: 'sandboxMgr.elastic.preview.same' });
    }
    return intl.formatMessage({
      id: toOrder > fromOrder ? 'sandboxMgr.elastic.preview.upgrade' : 'sandboxMgr.elastic.preview.downgrade',
    });
  };

  const formatDuration = (value?: number | null) => {
    if (value === undefined || value === null) return '-';
    if (value < 1000) return intl.formatMessage({ id: 'sandboxMgr.elastic.duration.lessThanOneSecond' });
    return intl.formatMessage(
      { id: 'sandboxMgr.elastic.duration.seconds' },
      { seconds: Number((value / 1000).toFixed(1)) }
    );
  };

  const renderProfileTag = (
    profileKey?: string,
    serviceType?: string,
    requests?: string | null,
    limits?: string | null
  ) => {
    const resource = getResourceInfo(requests, limits);
    return (
      <Tooltip
        title={
          <div>
            <div>
              {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceGuaranteed' })}: {resource.requestCpu} CPU /{' '}
              {resource.requestMemory}
            </div>
            <div>
              {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceLimit' })}: {resource.limitCpu} CPU /{' '}
              {resource.limitMemory}
            </div>
          </div>
        }
      >
        <Tag color={getProfileColor(profileKey)} className={styles.profileTag}>
          {getProfileLabel(profileKey, serviceType)}
        </Tag>
      </Tooltip>
    );
  };

  const renderResourceCompact = (value?: string | null) => {
    const resource = parseJsonObject(value);
    return (
      <Tooltip title={compactJson(value)}>
        <Space size={8} wrap>
          <span className={styles.resourcePill}>
            <DashboardOutlined />
            {formatCpu(resource.cpu)}
          </span>
          <span className={styles.resourcePill}>
            <DatabaseOutlined />
            {formatMemory(resource.memory)}
          </span>
        </Space>
      </Tooltip>
    );
  };

  const renderStrategy = (value?: string) => {
    if (!value) return '-';
    return (
      <Tooltip title={getResizeStrategyDesc(value)}>
        <Space size={4}>
          <ThunderboltOutlined className={styles.strategyIcon} />
          <span>{getResizeStrategyLabel(value)}</span>
          <InfoCircleOutlined className={styles.infoIcon} />
        </Space>
      </Tooltip>
    );
  };

  const renderProfileOption = (item: ServiceProfileItem) => {
    const resource = getResourceInfo(item.resourceRequests, item.resourceLimits);
    return (
      <div className={styles.optionContent}>
        <div className={styles.optionTitle}>{getProfileLabel(item.profileKey, item.serviceType)}</div>
        <div className={styles.optionMeta}>
          {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceGuaranteed' })} {resource.requestCpu} CPU /{' '}
          {resource.requestMemory} · {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceLimit' })}{' '}
          {resource.limitCpu} CPU / {resource.limitMemory}
        </div>
      </div>
    );
  };

  const renderSandboxOption = (item: SsSandboxRecord) => {
    const resource = getResourceInfo(item.resourceRequests, item.resourceLimits);
    return (
      <div className={styles.optionContent}>
        <div className={styles.optionTitle}>
          #{item.id} / {item.userCode} / {getProfileLabel(item.profileKey, item.serviceType || item.sandboxType)}
        </div>
        <div className={styles.optionMeta}>
          {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceGuaranteed' })} {resource.requestCpu} CPU /{' '}
          {resource.requestMemory}
        </div>
      </div>
    );
  };

  const loadData = useCallback(
    (myPageInfo: { pageIndex: number; pageSize: number }, kw?: string, st?: string, silent?: boolean) => {
      const p = {
        pageIndex: myPageInfo.pageIndex,
        pageSize: myPageInfo.pageSize,
        keyword: kw,
        status: st,
      };

      curParam.current = p;
      if (!silent) setManualLoading(true);

      dispatch({
        type: 'sandboxMgr/listSandboxRecords',
        payload: p,
        success: (data: any) => {
          setList(data?.list || []);
          setPageInfo((prev) => ({
            ...prev,
            pageIndex: data?.pageIndex || myPageInfo.pageIndex,
            pageSize: data?.pageSize || myPageInfo.pageSize,
            total: data?.total || 0,
            totalPage: data?.totalPage || 0,
          }));
          if (!silent) setManualLoading(false);
        },
        fail: () => {
          if (!silent) setManualLoading(false);
        },
      });
    },
    [dispatch]
  );

  // Auto refresh (silent)
  useEffect(() => {
    if (autoRefresh) {
      refreshTimer.current = setInterval(() => {
        loadData(
          {
            pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
            pageSize: curParam.current?.pageSize || pageInfo.pageSize,
          },
          curParam.current?.keyword || keyword,
          curParam.current?.status || status,
          true
        );
      }, 10000);
    } else if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }

    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
      }
    };
  }, [autoRefresh, loadData, pageInfo, keyword, status]);

  // Initial load
  useEffect(() => {
    loadData(pageInfo, keyword, status);
  }, []);

  // Load preferred serviceKey for each unique userCode in the list
  useEffect(() => {
    const userCodes = [...new Set(list.map((r) => r.userCode).filter(Boolean))];
    if (!userCodes.length) return;
    userCodes.forEach(async (code) => {
      try {
        const res: any = await getPreferredServiceKey(code);
        const key = res?.code === 0 && typeof res.data === 'string' ? res.data : null;
        if (key) {
          setPreferredMap((prev) => ({ ...prev, [code]: key }));
        } else {
          setPreferredMap((prev) => {
            if (prev[code]) {
              const next = { ...prev };
              delete next[code];
              return next;
            }
            return prev;
          });
        }
      } catch {
        // ignore
      }
    });
  }, [list]);

  const handleSearch = useCallback(() => {
    loadData({ ...pageInfo, pageIndex: 1 }, keyword, status);
  }, [loadData, pageInfo, keyword, status]);

  const handleStatusChange = useCallback(
    (value: string) => {
      setStatus(value);
      loadData({ ...pageInfo, pageIndex: 1 }, keyword, value);
    },
    [loadData, pageInfo, keyword]
  );

  const handlePaginationChange = useCallback(
    (pageIndex: number, pageSize: number) => {
      setPageInfo((prev) => ({ ...prev, pageIndex, pageSize }));
      loadData({ ...pageInfo, pageIndex, pageSize }, keyword, status);
    },
    [loadData, pageInfo, keyword, status]
  );

  const handleDelete = useCallback(
    (record: SsSandboxRecord) => {
      setRemovingId(record.id);
      dispatch({
        type: 'sandboxMgr/removeSandboxById',
        payload: { id: record.id },
        success: () => {
          message.success(intl.formatMessage({ id: 'sandboxMgr.delete.success' }));
          setRemovingId(null);
          loadData(
            {
              pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
              pageSize: curParam.current?.pageSize || pageInfo.pageSize,
            },
            curParam.current?.keyword || keyword,
            curParam.current?.status || status
          );
        },
        fail: () => {
          setRemovingId(null);
        },
      });
    },
    [dispatch, intl, loadData, pageInfo, keyword, status]
  );

  const handleView = useCallback((endpoint: string) => {
    // openclaw 控制台把 gatewayUrl/token 持久化在同源共享的 localStorage(openclaw.control.settings.v1)。
    // 整页代理下所有 sandbox 同源，仅靠 URL 的 token 不够：若不显式覆盖 gatewayUrl，
    // 第二次打开会复用上一次残留的 gatewayUrl，连到上一个 sandbox（端口串台）。
    // 这里在打开 URL 上补上本 endpoint 对应的 gatewayUrl（ws(s)://当前host/代理前缀），强制覆盖残留。
    try {
      const url = new URL(endpoint, window.location.origin);
      // 代理前缀：endpoint 路径去掉末尾的 /chat，即 /byaiService/openclaw-ui/{ip}/{port}
      const proxyPrefix = url.pathname.replace(/\/chat$/, '');
      // gatewayUrl 与 endpoint 同 host/同源，仅协议换成 ws(s)，避免与 endpoint 的 host 不一致。
      const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const gatewayUrl = `${wsProto}//${url.host}${proxyPrefix}`;
      url.searchParams.set('gatewayUrl', gatewayUrl);
      window.open(url.toString(), '_blank');
    } catch {
      window.open(endpoint, '_blank');
    }
  }, []);

  const canReleaseSandbox = useCallback((record: SsSandboxRecord) => RELEASABLE_STATUSES.includes(record.status), []);

  const handleAutoReleaseChange = useCallback(
    (record: SsSandboxRecord, checked: boolean) => {
      setUpdatingId(record.id);
      dispatch({
        type: 'sandboxMgr/updateSandbox',
        payload: { id: record.id, autoRelease: checked ? 1 : 0 },
        success: () => {
          message.success(intl.formatMessage({ id: 'sandboxMgr.update.success' }));
          setUpdatingId(null);
          setList((prev) =>
            prev.map((item) => (item.id === record.id ? { ...item, autoRelease: checked ? 1 : 0 } : item))
          );
        },
        fail: () => {
          setUpdatingId(null);
        },
      });
    },
    [dispatch, intl]
  );

  // ==================== 沙箱配置管理相关方法 ====================

  const loadSpecList = useCallback(() => {
    setSpecLoading(true);
    dispatch({
      type: 'sandboxMgr/listServiceSpec',
      payload: {},
      success: (data: ServiceSpecItem[]) => {
        setSpecList(data || []);
        setSpecLoading(false);
      },
      fail: () => {
        setSpecLoading(false);
      },
    });
  }, [dispatch]);

  const loadProfileList = useCallback(
    (serviceType = DEFAULT_SERVICE_TYPE, enabledOnly = false) => {
      setProfileLoading(true);
      dispatch({
        type: 'sandboxMgr/listServiceProfiles',
        payload: { serviceType, enabledOnly },
        success: (data: ServiceProfileItem[]) => {
          setProfileList(data || []);
          setProfileLoading(false);
        },
        fail: () => {
          setProfileLoading(false);
        },
      });
    },
    [dispatch]
  );

  const loadResizeRecords = useCallback(
    (params: { sandboxRecordId?: number; userCode?: string; sandboxId?: string }) => {
      if (!params.sandboxRecordId && !params.userCode && !params.sandboxId) {
        setResizeRecords([]);
        return;
      }
      setResizeRecordsLoading(true);
      dispatch({
        type: 'sandboxMgr/listResizeRecords',
        payload: { ...params, limit: 50 },
        success: (data: SandboxResizeRecord[]) => {
          setResizeRecords(data || []);
          setResizeRecordsLoading(false);
        },
        fail: () => {
          setResizeRecordsLoading(false);
        },
      });
    },
    [dispatch]
  );

  const loadHealthSwitch = useCallback(() => {
    setHealthSwitchLoading(true);
    dispatch({
      type: 'sandboxMgr/getSandboxHealthGlobalSwitch',
      success: (data: any) => {
        setHealthSwitch(data || {});
        setHealthSwitchLoading(false);
      },
      fail: () => setHealthSwitchLoading(false),
    });
  }, [dispatch]);

  const loadWatermarkList = useCallback(
    (params: any = {}) => {
      setWatermarkLoading(true);
      dispatch({
        type: 'sandboxMgr/listSandboxHealthWatermarkModels',
        payload: params,
        success: (data: SandboxHealthWatermarkModel[]) => {
          setWatermarkList(data || []);
          setWatermarkLoading(false);
        },
        fail: () => setWatermarkLoading(false),
      });
    },
    [dispatch]
  );

  const handleOpenSpecDrawer = () => {
    setSpecDrawerOpen(true);
    loadSpecList();
    loadProfileList();
    loadHealthSwitch();
    loadWatermarkList();
  };

  const handleCloseSpecDrawer = useCallback(() => {
    setSpecDrawerOpen(false);
    setSpecFormVisible(false);
    setEditingSpec(null);
    setProfileFormVisible(false);
    setEditingProfile(null);
    setWatermarkFormVisible(false);
    setEditingWatermark(null);
    setPreviewResult(null);
    specForm.resetFields();
    profileForm.resetFields();
    watermarkForm.resetFields();
    setSpecDrawerTab('spec');
    resizeForm.resetFields();
    setResizeSandboxList([]);
    setSelectedResizeRecord(null);
    setResizeRecords([]);
  }, [profileForm, resizeForm, specForm, watermarkForm]);

  const handleAddSpec = useCallback(() => {
    setEditingSpec(null);
    specForm.setFieldsValue({
      serviceKey: '',
      specJson: '',
      templateJson: '',
      enabled: true,
    });
    setSpecFormVisible(true);
  }, [specForm]);

  const handleEditSpec = useCallback(
    (record: ServiceSpecItem) => {
      setEditingSpec(record);
      specForm.setFieldsValue({
        serviceKey: record.serviceKey,
        specJson: record.specJson,
        templateJson: record.templateJson || '',
        enabled: isServiceSpecAutoStartEnabled(record.enabled),
      });
      setSpecFormVisible(true);
    },
    [specForm]
  );

  const handleDeleteSpec = useCallback(
    (record: ServiceSpecItem) => {
      dispatch({
        type: 'sandboxMgr/deleteServiceSpec',
        payload: { serviceKey: record.serviceKey },
        success: () => {
          loadSpecList();
        },
      });
    },
    [dispatch, loadSpecList]
  );

  const handleSaveSpec = useCallback(() => {
    specForm.validateFields().then((values) => {
      setSavingSpec(true);
      dispatch({
        type: 'sandboxMgr/saveServiceSpec',
        payload: {
          serviceKey: values.serviceKey,
          specJson: values.specJson,
          templateJson: values.templateJson,
          enabled: values.enabled === false ? 0 : 1,
        },
        success: () => {
          setSavingSpec(false);
          setSpecFormVisible(false);
          specForm.resetFields();
          loadSpecList();
        },
        fail: () => {
          setSavingSpec(false);
        },
      });
    });
  }, [dispatch, specForm, loadSpecList]);

  const handleSpecAutoStartChange = useCallback(
    (record: ServiceSpecItem, checked: boolean) => {
      const previousEnabled = record.enabled;
      setUpdatingSpecKey(record.serviceKey);
      setSpecList((current) =>
        current.map((item) => (item.serviceKey === record.serviceKey ? { ...item, enabled: checked ? 1 : 0 } : item))
      );
      dispatch({
        type: 'sandboxMgr/saveServiceSpec',
        payload: buildServiceSpecPayload(record, checked),
        success: () => {
          setUpdatingSpecKey(null);
          message.success(intl.formatMessage({ id: 'sandboxMgr.config.autoStartSaveSuccess' }));
        },
        fail: () => {
          setUpdatingSpecKey(null);
          setSpecList((current) =>
            current.map((item) =>
              item.serviceKey === record.serviceKey ? { ...item, enabled: previousEnabled } : item
            )
          );
          message.error(intl.formatMessage({ id: 'sandboxMgr.config.autoStartSaveFailed' }));
        },
      });
    },
    [dispatch, intl]
  );

  const handleCancelSpecForm = useCallback(() => {
    setSpecFormVisible(false);
    setEditingSpec(null);
    specForm.resetFields();
  }, [specForm]);

  // ==================== 沙箱服务规格档位相关方法 ====================

  const handleAddProfile = useCallback(() => {
    setEditingProfile(null);
    profileForm.setFieldsValue({
      serviceType: DEFAULT_SERVICE_TYPE,
      resizeStrategy: 'IN_PLACE',
      resizeEnabled: true,
      enabled: true,
      sortOrder: 0,
      resourceRequests: '{"cpu":"500m","memory":"1Gi"}',
      resourceLimits: '{"cpu":"2","memory":"4Gi"}',
    });
    setProfileFormVisible(true);
  }, [profileForm]);

  const handleEditProfile = useCallback(
    (record: ServiceProfileItem) => {
      setEditingProfile(record);
      profileForm.setFieldsValue({
        ...record,
        resizeEnabled: record.resizeEnabled !== 0,
        enabled: record.enabled !== 0,
      });
      setProfileFormVisible(true);
    },
    [profileForm]
  );

  const handleDeleteProfile = useCallback(
    (record: ServiceProfileItem) => {
      dispatch({
        type: 'sandboxMgr/deleteServiceProfile',
        payload: { id: record.id, serviceType: record.serviceType, profileKey: record.profileKey },
        success: () => {
          loadProfileList();
        },
      });
    },
    [dispatch, loadProfileList]
  );

  const handleSaveProfile = useCallback(() => {
    profileForm.validateFields().then((values) => {
      setSavingProfile(true);
      dispatch({
        type: 'sandboxMgr/saveServiceProfile',
        payload: {
          id: editingProfile?.id,
          serviceType: trim(values.serviceType || DEFAULT_SERVICE_TYPE),
          profileKey: trim(values.profileKey || ''),
          resourceRequests: trim(values.resourceRequests || ''),
          resourceLimits: trim(values.resourceLimits || ''),
          templatePatchJson: trim(values.templatePatchJson || ''),
          resizeEnabled: values.resizeEnabled ? 1 : 0,
          resizeStrategy: values.resizeStrategy || 'IN_PLACE',
          enabled: values.enabled ? 1 : 0,
          sortOrder: values.sortOrder || 0,
        },
        success: () => {
          setSavingProfile(false);
          setProfileFormVisible(false);
          setEditingProfile(null);
          profileForm.resetFields();
          loadProfileList();
        },
        fail: () => {
          setSavingProfile(false);
        },
      });
    });
  }, [dispatch, editingProfile, loadProfileList, profileForm]);

  const handleCancelProfileForm = useCallback(() => {
    setProfileFormVisible(false);
    setEditingProfile(null);
    profileForm.resetFields();
  }, [profileForm]);

  // ==================== 沙箱健康检测/水位模型相关方法 ====================

  const handleHealthSwitchChange = useCallback(
    (checked: boolean) => {
      setHealthSwitchLoading(true);
      dispatch({
        type: 'sandboxMgr/saveSandboxHealthGlobalSwitch',
        payload: { enabled: checked },
        success: (data: any) => {
          setHealthSwitch(data || {});
          setHealthSwitchLoading(false);
        },
        fail: () => setHealthSwitchLoading(false),
      });
    },
    [dispatch]
  );

  const handleAddWatermark = useCallback(() => {
    setEditingWatermark(null);
    setPreviewResult(null);
    watermarkForm.setFieldsValue({
      modelName: 'OpenClaw XS health model',
      serviceType: DEFAULT_SERVICE_TYPE,
      profileKey: 'xs',
      enabled: true,
      priority: 0,
      idleMemoryLimitRatio: 0.55,
      busyMemoryLimitRatio: 0.75,
      criticalMemoryLimitRatio: 0.88,
      busyCpuRequestRatio: 1,
      criticalCpuRequestRatio: 1.8,
      consecutiveBusySamples: 2,
      recoverSamples: 2,
      sampleIntervalSeconds: 30,
      snapshotTtlSeconds: 120,
      watchTtlSeconds: 90,
      previewCpuRequestRatio: 1,
      previewMemoryLimitRatio: 0.8,
    });
    setWatermarkFormVisible(true);
  }, [watermarkForm]);

  const handleEditWatermark = useCallback(
    (record: SandboxHealthWatermarkModel) => {
      setEditingWatermark(record);
      setPreviewResult(null);
      watermarkForm.setFieldsValue({
        ...record,
        enabled: record.enabled !== 0,
        previewCpuRequestRatio: 1,
        previewMemoryLimitRatio: record.busyMemoryLimitRatio || 0.75,
      });
      setWatermarkFormVisible(true);
    },
    [watermarkForm]
  );

  const buildWatermarkPayload = (values: any) => ({
    id: editingWatermark?.id,
    modelName: trim(values.modelName || ''),
    serviceType: trim(values.serviceType || DEFAULT_SERVICE_TYPE),
    profileKey: trim(values.profileKey || ''),
    enabled: values.enabled ? 1 : 0,
    priority: values.priority || 0,
    idleMemoryLimitRatio: values.idleMemoryLimitRatio,
    busyMemoryLimitRatio: values.busyMemoryLimitRatio,
    criticalMemoryLimitRatio: values.criticalMemoryLimitRatio,
    busyCpuRequestRatio: values.busyCpuRequestRatio,
    criticalCpuRequestRatio: values.criticalCpuRequestRatio,
    consecutiveBusySamples: values.consecutiveBusySamples,
    recoverSamples: values.recoverSamples,
    sampleIntervalSeconds: values.sampleIntervalSeconds,
    snapshotTtlSeconds: values.snapshotTtlSeconds,
    watchTtlSeconds: values.watchTtlSeconds,
    remark: trim(values.remark || ''),
  });

  const handleSaveWatermark = useCallback(() => {
    watermarkForm.validateFields().then((values) => {
      Modal.confirm({
        title: intl.formatMessage({ id: 'sandboxMgr.health.saveConfirmTitle' }),
        content: intl.formatMessage({ id: 'sandboxMgr.health.saveConfirmContent' }),
        onOk: () => {
          setSavingWatermark(true);
          dispatch({
            type: 'sandboxMgr/saveSandboxHealthWatermarkModel',
            payload: buildWatermarkPayload(values),
            success: () => {
              setSavingWatermark(false);
              setWatermarkFormVisible(false);
              setEditingWatermark(null);
              setPreviewResult(null);
              watermarkForm.resetFields();
              loadWatermarkList();
            },
            fail: () => setSavingWatermark(false),
          });
        },
      });
    });
  }, [dispatch, intl, loadWatermarkList, watermarkForm, editingWatermark]);

  const handleDeleteWatermark = useCallback(
    (record: SandboxHealthWatermarkModel) => {
      if (!record.id) return;
      dispatch({
        type: 'sandboxMgr/deleteSandboxHealthWatermarkModel',
        payload: { id: record.id },
        success: () => loadWatermarkList(),
      });
    },
    [dispatch, loadWatermarkList]
  );

  const handleToggleWatermark = useCallback(
    (record: SandboxHealthWatermarkModel, checked: boolean) => {
      if (!record.id) return;
      dispatch({
        type: 'sandboxMgr/enableSandboxHealthWatermarkModel',
        payload: { id: record.id, enabled: checked },
        success: () => loadWatermarkList(),
      });
    },
    [dispatch, loadWatermarkList]
  );

  const handlePreviewWatermark = useCallback(() => {
    watermarkForm.validateFields().then((values) => {
      setPreviewLoading(true);
      dispatch({
        type: 'sandboxMgr/previewSandboxHealthWatermark',
        payload: {
          serviceType: trim(values.serviceType || DEFAULT_SERVICE_TYPE),
          profileKey: trim(values.profileKey || ''),
          cpuRequestRatio: values.previewCpuRequestRatio,
          memoryLimitRatio: values.previewMemoryLimitRatio,
        },
        success: (data: any) => {
          setPreviewResult(data || null);
          setPreviewLoading(false);
        },
        fail: () => setPreviewLoading(false),
      });
    });
  }, [dispatch, watermarkForm]);

  const handleCancelWatermarkForm = useCallback(() => {
    setWatermarkFormVisible(false);
    setEditingWatermark(null);
    setPreviewResult(null);
    watermarkForm.resetFields();
  }, [watermarkForm]);

  // ==================== 沙箱弹性计算配置相关方法 ====================

  const handleSelectResizeSandbox = useCallback(
    (recordId?: number) => {
      const record = resizeSandboxList.find((item) => item.id === recordId) || null;
      setSelectedResizeRecord(record);
      if (!record) {
        setResizeRecords([]);
        return;
      }
      resizeForm.setFieldsValue({
        sandboxRecordId: record.id,
        userCode: record.userCode,
        serviceType: record.serviceType || record.sandboxType || DEFAULT_SERVICE_TYPE,
      });
      loadResizeRecords({ sandboxRecordId: record.id });
    },
    [loadResizeRecords, resizeForm, resizeSandboxList]
  );

  const handleQueryResizeSandboxes = useCallback(() => {
    const values = resizeForm.getFieldsValue();
    setResizeSandboxLoading(true);
    dispatch({
      type: 'sandboxMgr/listSandboxRecords',
      payload: {
        pageIndex: 1,
        pageSize: 50,
        keyword: trim(values.userCode || ''),
        status: 'RUNNING',
      },
      success: (data: any) => {
        const records = data?.list || [];
        setResizeSandboxList(records);
        setResizeSandboxLoading(false);
        if (!records.length) {
          setSelectedResizeRecord(null);
          setResizeRecords([]);
          message.warning(intl.formatMessage({ id: 'sandboxMgr.elastic.noRunningSandbox' }));
          return;
        }
        const firstRecord = records[0];
        setSelectedResizeRecord(firstRecord);
        resizeForm.setFieldsValue({
          sandboxRecordId: firstRecord.id,
          userCode: firstRecord.userCode,
          serviceType: firstRecord.serviceType || firstRecord.sandboxType || DEFAULT_SERVICE_TYPE,
        });
        loadResizeRecords({ sandboxRecordId: firstRecord.id });
      },
      fail: () => {
        setResizeSandboxLoading(false);
      },
    });
  }, [dispatch, intl, loadResizeRecords, resizeForm]);

  const handleSubmitResize = useCallback(() => {
    resizeForm.validateFields().then((values) => {
      const record =
        selectedResizeRecord || resizeSandboxList.find((item) => item.id === Number(values.sandboxRecordId));
      if (!record) {
        message.warning(intl.formatMessage({ id: 'sandboxMgr.elastic.selectSandboxRequired' }));
        return;
      }
      setResizing(true);
      dispatch({
        type: 'sandboxMgr/resizeSandbox',
        payload: {
          sandboxRecordId: record.id,
          toProfileKey: values.profileKey,
          resizeType: values.resizeType || 'IN_PLACE',
          triggerSource: 'MANUAL',
          reasonCode: 'manual.frontend',
          reasonDetail: values.reasonDetail || `frontend resize to ${values.profileKey}`,
        },
        success: () => {
          setResizing(false);
          message.success(intl.formatMessage({ id: 'sandboxMgr.elastic.resizeSuccess' }));
          loadResizeRecords({ sandboxRecordId: record.id });
          handleQueryResizeSandboxes();
          loadData(
            {
              pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
              pageSize: curParam.current?.pageSize || pageInfo.pageSize,
            },
            curParam.current?.keyword || keyword,
            curParam.current?.status || status,
            true
          );
        },
        fail: () => {
          setResizing(false);
          loadResizeRecords({ sandboxRecordId: record.id });
        },
      });
    });
  }, [
    dispatch,
    handleQueryResizeSandboxes,
    intl,
    keyword,
    loadData,
    loadResizeRecords,
    pageInfo,
    resizeForm,
    resizeSandboxList,
    selectedResizeRecord,
    status,
  ]);

  // ==================== 指定用户沙箱相关方法 ====================

  const handleOpenLaunchModal = useCallback(() => {
    setLaunchModalOpen(true);
    launchForm.resetFields();
    dispatch({
      type: 'sandboxMgr/listServiceSpec',
      payload: {},
      success: (data: ServiceSpecItem[]) => {
        setLaunchSpecList(data || []);
      },
    });
  }, [dispatch, launchForm]);

  const handleLaunchSandbox = useCallback(() => {
    launchForm.validateFields().then((values) => {
      setLaunching(true);
      const payload: { userCode: string; serviceKey?: string } = {
        userCode: values.userCode,
      };
      if (values.serviceKey) {
        payload.serviceKey = values.serviceKey;
      }
      dispatch({
        type: 'sandboxMgr/launchByUserCode',
        payload,
        success: (data: any) => {
          setLaunching(false);
          setLaunchModalOpen(false);
          message.success(
            intl.formatMessage({ id: 'sandboxMgr.launch.success' }, { sandboxId: data?.sandboxId || '-' })
          );
          loadData(
            {
              pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
              pageSize: curParam.current?.pageSize || pageInfo.pageSize,
            },
            curParam.current?.keyword || keyword,
            curParam.current?.status || status
          );
        },
        fail: () => {
          setLaunching(false);
        },
      });
    });
  }, [dispatch, launchForm, loadData, pageInfo, keyword, status]);

  const handleClearPreferred = useCallback(
    async (userCode: string) => {
      if (!trim(userCode)) return;
      try {
        await removePreferredServiceKey({ userCode: trim(userCode) });
        setPreferredMap((prev) => {
          const next = { ...prev };
          delete next[userCode];
          return next;
        });
        message.success(intl.formatMessage({ id: 'sandboxMgr.launch.preferredCleared' }));
      } catch {
        message.error(intl.formatMessage({ id: 'sandboxMgr.launch.preferredClearFailed' }));
      }
    },
    [intl]
  );

  const columns = [
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.id' }),
      dataIndex: 'id',
      align: 'center' as const,
      fixed: 'left' as const,
      width: 90,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.userCode' }),
      dataIndex: 'userCode',
      align: 'center' as const,
      fixed: 'left' as const,
      width: 150,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.sandboxType' }),
      dataIndex: 'sandboxType',
      align: 'center' as const,
      width: 200,
      render: (value: string, record: SsSandboxRecord) => {
        const preferred = preferredMap[record.userCode];
        return (
          <Space size={4}>
            <span>{value || '-'}</span>
            {preferred && (
              <Popconfirm
                title={`${intl.formatMessage({ id: 'sandboxMgr.launch.preferredServiceKey' })}: ${preferred}`}
                onConfirm={() => handleClearPreferred(record.userCode)}
              >
                <Tag color="blue" style={{ cursor: 'pointer', marginLeft: 4 }}>
                  <ClearOutlined />
                </Tag>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.resourceId' }),
      dataIndex: 'resourceId',
      align: 'center' as const,
      width: 110,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.sandboxId' }),
      dataIndex: 'sandboxId',
      align: 'center' as const,
      width: 220,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.endpoint' }),
      dataIndex: 'endpoint',
      align: 'center' as const,
      width: 260,
      ellipsis: true,
      render: (value: string, record: SsSandboxRecord) => {
        if (record.status === 'RUNNING' && value) {
          return <Typography.Link onClick={() => handleView(value)}>{value}</Typography.Link>;
        }
        return <Typography.Text disabled>{value || '-'}</Typography.Text>;
      },
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.status' }),
      dataIndex: 'status',
      align: 'center' as const,
      width: 110,
      render: (value: string) => {
        if (value === 'RUNNING') {
          return <Tag color="green">{intl.formatMessage({ id: 'sandboxMgr.status.running' })}</Tag>;
        }
        if (value === 'STARTING') {
          return <Tag color="blue">{intl.formatMessage({ id: 'sandboxMgr.status.starting' })}</Tag>;
        }
        if (value === 'RELEASING') {
          return <Tag color="orange">{intl.formatMessage({ id: 'sandboxMgr.status.releasing' })}</Tag>;
        }
        if (value === 'RELEASED') {
          return <Tag color="default">{intl.formatMessage({ id: 'sandboxMgr.status.released' })}</Tag>;
        }
        if (value === 'FAILED') {
          return <Tag color="red">{intl.formatMessage({ id: 'sandboxMgr.status.failed' })}</Tag>;
        }
        return <Tag>{value}</Tag>;
      },
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.workerStatus' }),
      dataIndex: 'workerOnline',
      align: 'center' as const,
      width: 130,
      render: (_value: boolean | undefined, record: SsSandboxRecord) => {
        const workerStatus = getWorkerLivenessStatus(record);
        const colors = { online: 'green', offline: 'red', unknown: 'default' } as const;
        return (
          <Tag color={colors[workerStatus]}>{intl.formatMessage({ id: `sandboxMgr.worker.${workerStatus}` })}</Tag>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.workerLastSeen' }),
      dataIndex: 'workerLastSeen',
      align: 'center' as const,
      width: 170,
      render: (value: number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.workerLeaseTtl' }),
      dataIndex: 'workerLeaseTtlSeconds',
      align: 'center' as const,
      width: 140,
      render: (value: number) => formatWorkerLeaseTtl(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.autoRelease' }),
      dataIndex: 'autoRelease',
      align: 'center' as const,
      width: 100,
      render: (value: number, record: SsSandboxRecord) => (
        <Switch
          checked={value === 1}
          disabled={record.status !== 'RUNNING' || updatingId === record.id}
          loading={updatingId === record.id}
          size="small"
          onChange={(checked) => handleAutoReleaseChange(record, checked)}
        />
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.createTime' }),
      dataIndex: 'createTime',
      align: 'center' as const,
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.lastAccessTime' }),
      dataIndex: 'lastAccessTime',
      align: 'center' as const,
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.lastRenewAt' }),
      dataIndex: 'lastRenewAt',
      align: 'center' as const,
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.nextRenewAt' }),
      dataIndex: 'nextRenewAt',
      align: 'center' as const,
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.remoteExpiresAt' }),
      dataIndex: 'remoteExpiresAt',
      align: 'center' as const,
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.timeoutSeconds' }),
      dataIndex: 'timeoutSeconds',
      align: 'center' as const,
      width: 110,
      render: (value: number) => value ?? '-',
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.releaseTime' }),
      dataIndex: 'releaseTime',
      align: 'center' as const,
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.releaseReason' }),
      dataIndex: 'releaseReason',
      align: 'center' as const,
      width: 180,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.version' }),
      dataIndex: 'version',
      align: 'center' as const,
      width: 90,
      render: (value: number) => value ?? '-',
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
      dataIndex: 'action',
      align: 'center' as const,
      fixed: 'right' as const,
      width: 160,
      render: (_: any, record: SsSandboxRecord) => {
        if (!canReleaseSandbox(record)) return null;

        return (
          <Space size="small">
            {record.status === 'RUNNING' && (
              <Button
                size="small"
                type="link"
                icon={<EyeOutlined />}
                onClick={() => handleView(record.endpoint)}
                disabled={!record.endpoint}
              >
                {intl.formatMessage({ id: 'sandboxMgr.action.view' })}
              </Button>
            )}
            <Popconfirm
              title={intl.formatMessage({ id: 'sandboxMgr.delete.confirm' })}
              onConfirm={() => handleDelete(record)}
              disabled={removingId === record.id}
            >
              <Button
                size="small"
                type="link"
                danger
                icon={<DeleteOutlined />}
                loading={removingId === record.id}
                disabled={removingId !== null}
              >
                {intl.formatMessage({ id: 'sandboxMgr.action.delete' })}
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const renderResizeStatus = (value?: string) => {
    if (!value) return '-';
    return <Tag color={resizeStatusColorMap[value] || 'default'}>{getResizeStatusLabel(value)}</Tag>;
  };

  const resizeSandboxColumns = [
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.id' }),
      dataIndex: 'id',
      width: 80,
      align: 'center' as const,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.userCode' }),
      dataIndex: 'userCode',
      width: 130,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.sandboxId' }),
      dataIndex: 'sandboxId',
      width: 220,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.currentProfile' }),
      dataIndex: 'profileKey',
      width: 150,
      render: (value: string, record: SsSandboxRecord) =>
        renderProfileTag(
          value,
          record.serviceType || record.sandboxType,
          record.resourceRequests,
          record.resourceLimits
        ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.resourceGuaranteed' }),
      dataIndex: 'resourceRequests',
      width: 180,
      render: (value: string) => renderResourceCompact(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.resourceLimit' }),
      dataIndex: 'resourceLimits',
      width: 180,
      render: (value: string) => renderResourceCompact(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.status' }),
      dataIndex: 'status',
      width: 110,
      render: (value: string) => <Tag color={value === 'RUNNING' ? 'green' : 'default'}>{value || '-'}</Tag>,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
      width: 100,
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_: any, record: SsSandboxRecord) => (
        <Button size="small" type="link" onClick={() => handleSelectResizeSandbox(record.id)}>
          {intl.formatMessage({ id: 'sandboxMgr.elastic.chooseSandbox' })}
        </Button>
      ),
    },
  ];

  const resizeRecordColumns = [
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.id' }),
      dataIndex: 'id',
      width: 80,
      align: 'center' as const,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.fromProfile' }),
      dataIndex: 'fromProfileKey',
      width: 150,
      render: (value: string, record: SandboxResizeRecord) =>
        renderProfileTag(value, record.serviceType, record.fromResourceRequests, record.fromResourceLimits),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.toProfile' }),
      dataIndex: 'toProfileKey',
      width: 150,
      render: (value: string, record: SandboxResizeRecord) =>
        renderProfileTag(value, record.serviceType, record.toResourceRequests, record.toResourceLimits),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.triggerSource' }),
      dataIndex: 'triggerSource',
      width: 140,
      ellipsis: true,
      render: (value: string) => getTriggerSourceLabel(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.resizeType' }),
      dataIndex: 'resizeType',
      width: 150,
      render: renderStrategy,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.status' }),
      dataIndex: 'status',
      width: 120,
      render: renderResizeStatus,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.durationMs' }),
      dataIndex: 'durationMs',
      width: 120,
      render: (value: number) => formatDuration(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.startedAt' }),
      dataIndex: 'startedAt',
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.finishedAt' }),
      dataIndex: 'finishedAt',
      width: 170,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.reasonDetail' }),
      dataIndex: 'reasonDetail',
      width: 220,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.errorMessage' }),
      dataIndex: 'errorMessage',
      width: 260,
      ellipsis: true,
      render: renderEllipsisText,
    },
  ];

  const profileColumns = [
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.serviceType' }),
      dataIndex: 'serviceType',
      width: 140,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.profileKey' }),
      dataIndex: 'profileKey',
      width: 140,
      render: (value: string, record: ServiceProfileItem) => renderProfileTag(value, record.serviceType),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.resourceGuaranteed' }),
      dataIndex: 'resourceRequests',
      width: 190,
      render: (value: string) => renderResourceCompact(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.resourceLimit' }),
      dataIndex: 'resourceLimits',
      width: 190,
      render: (value: string) => renderResourceCompact(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.elastic.resizeType' }),
      dataIndex: 'resizeStrategy',
      width: 150,
      render: renderStrategy,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.resizeEnabled' }),
      dataIndex: 'resizeEnabled',
      width: 110,
      align: 'center' as const,
      render: (value: number) => (
        <Tag color={value === 0 ? 'default' : 'green'}>
          {intl.formatMessage({ id: value === 0 ? 'sandboxMgr.profile.disabled' : 'sandboxMgr.profile.enabled' })}
        </Tag>
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.enabled' }),
      dataIndex: 'enabled',
      width: 110,
      align: 'center' as const,
      render: (value: number) => (
        <Tag color={value === 0 ? 'default' : 'green'}>
          {intl.formatMessage({ id: value === 0 ? 'sandboxMgr.profile.disabled' : 'sandboxMgr.profile.enabled' })}
        </Tag>
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.sortOrder' }),
      dataIndex: 'sortOrder',
      width: 100,
      align: 'center' as const,
      render: (value: number) => value ?? 0,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
      width: 150,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: any, record: ServiceProfileItem) => (
        <Space size="small">
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEditProfile(record)}>
            {intl.formatMessage({ id: 'SystemParams.params.edit' })}
          </Button>
          <Popconfirm
            title={intl.formatMessage({ id: 'sandboxMgr.profile.deleteConfirm' })}
            onConfirm={() => handleDeleteProfile(record)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              {intl.formatMessage({ id: 'SystemParams.params.delete' })}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const healthLevelColorMap: Record<string, string> = {
    IDLE: 'green',
    NORMAL: 'blue',
    BUSY: 'orange',
    CRITICAL: 'red',
    UNKNOWN: 'default',
  };

  const watermarkColumns = [
    {
      title: intl.formatMessage({ id: 'sandboxMgr.health.modelName' }),
      dataIndex: 'modelName',
      width: 180,
      ellipsis: true,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.serviceType' }),
      dataIndex: 'serviceType',
      width: 130,
      render: renderEllipsisText,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.profileKey' }),
      dataIndex: 'profileKey',
      width: 120,
      render: (value: string, record: SandboxHealthWatermarkModel) =>
        value ? renderProfileTag(value, record.serviceType) : <Tag>default</Tag>,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.health.memoryWatermark' }),
      width: 220,
      render: (_: any, record: SandboxHealthWatermarkModel) => (
        <Space size={4} wrap>
          <Tag color="green">I {record.idleMemoryLimitRatio}</Tag>
          <Tag color="orange">B {record.busyMemoryLimitRatio}</Tag>
          <Tag color="red">C {record.criticalMemoryLimitRatio}</Tag>
        </Space>
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.health.cpuWatermark' }),
      width: 170,
      render: (_: any, record: SandboxHealthWatermarkModel) => (
        <Space size={4} wrap>
          <Tag color="orange">B {record.busyCpuRequestRatio}</Tag>
          <Tag color="red">C {record.criticalCpuRequestRatio}</Tag>
        </Space>
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.health.samples' }),
      width: 150,
      render: (_: any, record: SandboxHealthWatermarkModel) =>
        `${record.consecutiveBusySamples || 1}/${record.recoverSamples || 1}`,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.health.ttl' }),
      width: 170,
      render: (_: any, record: SandboxHealthWatermarkModel) =>
        `${record.sampleIntervalSeconds || '-'}s / ${record.snapshotTtlSeconds || '-'}s / ${
          record.watchTtlSeconds || '-'
        }s`,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.profile.enabled' }),
      dataIndex: 'enabled',
      width: 110,
      align: 'center' as const,
      render: (value: number, record: SandboxHealthWatermarkModel) => (
        <Switch checked={value !== 0} size="small" onChange={(checked) => handleToggleWatermark(record, checked)} />
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
      width: 150,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: any, record: SandboxHealthWatermarkModel) => (
        <Space size="small">
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEditWatermark(record)}>
            {intl.formatMessage({ id: 'SystemParams.params.edit' })}
          </Button>
          <Popconfirm
            title={intl.formatMessage({ id: 'sandboxMgr.health.deleteConfirm' })}
            onConfirm={() => handleDeleteWatermark(record)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              {intl.formatMessage({ id: 'SystemParams.params.delete' })}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const selectedResource = selectedResizeRecord
    ? getResourceInfo(selectedResizeRecord.resourceRequests, selectedResizeRecord.resourceLimits)
    : null;
  const targetResource = targetProfile
    ? getResourceInfo(targetProfile.resourceRequests, targetProfile.resourceLimits)
    : null;
  const sortedProfileList = profileList
    .slice()
    .sort(
      (a, b) =>
        (PROFILE_ORDER[(a.profileKey || '').toLowerCase()] || a.sortOrder || 999) -
        (PROFILE_ORDER[(b.profileKey || '').toLowerCase()] || b.sortOrder || 999)
    );
  const enabledProfileList = sortedProfileList.filter((item) => item.enabled !== 0 && item.resizeEnabled !== 0);

  return (
    <div className={classNames('full-height ub ub-ver gap8', styles.container)}>
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <Space size="middle">
            <Input.Search
              placeholder={intl.formatMessage({ id: 'sandboxMgr.search.placeholder' })}
              value={keyword}
              onChange={(e) => setKeyword(trim(e.target.value))}
              onSearch={handleSearch}
              onPressEnter={handleSearch}
              style={{ width: 300 }}
              allowClear
            />
            <Select value={status} onChange={handleStatusChange} style={{ width: 150 }}>
              <Option value="">{intl.formatMessage({ id: 'sandboxMgr.status.all' })}</Option>
              <Option value="STARTING">{intl.formatMessage({ id: 'sandboxMgr.status.starting' })}</Option>
              <Option value="RUNNING">{intl.formatMessage({ id: 'sandboxMgr.status.running' })}</Option>
              <Option value="RELEASING">{intl.formatMessage({ id: 'sandboxMgr.status.releasing' })}</Option>
              <Option value="RELEASED">{intl.formatMessage({ id: 'sandboxMgr.status.released' })}</Option>
              <Option value="FAILED">{intl.formatMessage({ id: 'sandboxMgr.status.failed' })}</Option>
            </Select>
          </Space>
        </Col>
        <Col>
          <Space size="middle">
            {showLaunchButton && (
              <Button type="primary" icon={<RocketOutlined />} onClick={handleOpenLaunchModal}>
                {intl.formatMessage({ id: 'sandboxMgr.launch.button' })}
              </Button>
            )}
            <Button icon={<SettingOutlined />} onClick={handleOpenSpecDrawer}>
              {intl.formatMessage({ id: 'sandboxMgr.config.button' })}
            </Button>
            <span>{intl.formatMessage({ id: 'sandboxMgr.autoRefresh' })}:</span>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => {
                loadData(
                  {
                    pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
                    pageSize: curParam.current?.pageSize || pageInfo.pageSize,
                  },
                  curParam.current?.keyword || keyword,
                  curParam.current?.status || status
                );
              }}
            >
              {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
            </Button>
          </Space>
        </Col>
      </Row>
      <div className={classNames('ub-f1', styles.tableScroll)}>
        <Table<SsSandboxRecord>
          rowKey="id"
          columns={columns}
          dataSource={list}
          pagination={{
            ...pageInfo,
            current: pageInfo.pageIndex,
            showTotal: (total: number) => intl.formatMessage({ id: 'sandboxMgr.pagination.total' }, { total }),
            onChange: handlePaginationChange,
          }}
          scroll={{ x: 2400, y: 'calc(100vh - 230px)' }}
          loading={manualLoading}
          className={styles.table}
        />
      </div>

      {/* 沙箱配置抽屉 */}
      <Drawer
        title={intl.formatMessage({ id: 'sandboxMgr.config.title' })}
        open={specDrawerOpen}
        onClose={handleCloseSpecDrawer}
        width={960}
        destroyOnClose
      >
        <Tabs
          activeKey={specDrawerTab}
          onChange={setSpecDrawerTab}
          items={[
            {
              key: 'spec',
              label: intl.formatMessage({ id: 'sandboxMgr.config.tab.spec' }),
              children: (
                <div className={styles.specDrawerContent}>
                  <Row justify="end" style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleAddSpec}>
                      {intl.formatMessage({ id: 'sandboxMgr.config.add' })}
                    </Button>
                  </Row>
                  <Table<ServiceSpecItem>
                    rowKey="serviceKey"
                    dataSource={specList}
                    loading={specLoading}
                    pagination={false}
                    columns={[
                      {
                        title: intl.formatMessage({ id: 'sandboxMgr.config.serviceKey' }),
                        dataIndex: 'serviceKey',
                        width: 200,
                        ellipsis: true,
                      },
                      {
                        title: intl.formatMessage({ id: 'sandboxMgr.config.specJson' }),
                        dataIndex: 'specJson',
                        ellipsis: true,
                        render: (value: string) => (
                          <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                            {value}
                          </Typography.Paragraph>
                        ),
                      },
                      {
                        title: intl.formatMessage({ id: 'sandboxMgr.config.autoStart' }),
                        dataIndex: 'enabled',
                        width: 100,
                        align: 'center',
                        render: (value: ServiceSpecItem['enabled'], record: ServiceSpecItem) => (
                          <Tooltip title={intl.formatMessage({ id: 'sandboxMgr.config.autoStartTip' })}>
                            <Switch
                              size="small"
                              checked={isServiceSpecAutoStartEnabled(value)}
                              loading={updatingSpecKey === record.serviceKey}
                              disabled={updatingSpecKey !== null}
                              onChange={(checked) => handleSpecAutoStartChange(record, checked)}
                            />
                          </Tooltip>
                        ),
                      },
                      {
                        title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
                        width: 150,
                        align: 'center',
                        render: (_: any, record: ServiceSpecItem) => (
                          <Space size="small">
                            <Button
                              size="small"
                              type="link"
                              icon={<EditOutlined />}
                              onClick={() => handleEditSpec(record)}
                            >
                              {intl.formatMessage({ id: 'SystemParams.params.edit' })}
                            </Button>
                            <Popconfirm
                              title={intl.formatMessage({ id: 'sandboxMgr.config.deleteConfirm' })}
                              onConfirm={() => handleDeleteSpec(record)}
                            >
                              <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                                {intl.formatMessage({ id: 'SystemParams.params.delete' })}
                              </Button>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'profile',
              label: intl.formatMessage({ id: 'sandboxMgr.config.tab.profile' }),
              children: (
                <div className={styles.specDrawerContent}>
                  <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                    <Col>
                      <Typography.Text type="secondary">
                        {intl.formatMessage({ id: 'sandboxMgr.profile.tip' })}
                      </Typography.Text>
                    </Col>
                    <Col>
                      <Space>
                        <Button icon={<ReloadOutlined />} onClick={() => loadProfileList()} loading={profileLoading}>
                          {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
                        </Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddProfile}>
                          {intl.formatMessage({ id: 'sandboxMgr.profile.add' })}
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                  <Table<ServiceProfileItem>
                    rowKey={(record) => String(record.id || `${record.serviceType}-${record.profileKey}`)}
                    dataSource={sortedProfileList}
                    loading={profileLoading}
                    pagination={false}
                    columns={profileColumns}
                    scroll={{ x: 1340 }}
                  />
                </div>
              ),
            },
            {
              key: 'health',
              label: intl.formatMessage({ id: 'sandboxMgr.config.tab.health' }),
              children: (
                <div className={styles.specDrawerContent}>
                  <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                    <Col>
                      <Space direction="vertical" size={2}>
                        <Typography.Text strong>
                          {intl.formatMessage({ id: 'sandboxMgr.health.switchTitle' })}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {intl.formatMessage({ id: 'sandboxMgr.health.switchTip' })}
                        </Typography.Text>
                      </Space>
                    </Col>
                    <Col>
                      <Space>
                        <Tag color={healthSwitch.hardEnabled ? 'green' : 'red'}>
                          {intl.formatMessage({
                            id: healthSwitch.hardEnabled
                              ? 'sandboxMgr.health.hardEnabled'
                              : 'sandboxMgr.health.hardDisabled',
                          })}
                        </Tag>
                        <Typography.Text type="secondary">
                          {intl.formatMessage({ id: 'sandboxMgr.health.runtimeSwitch' })}
                        </Typography.Text>
                        <Switch
                          checked={!!healthSwitch.runtimeEnabled}
                          disabled={!healthSwitch.hardEnabled}
                          loading={healthSwitchLoading}
                          onChange={handleHealthSwitchChange}
                        />
                      </Space>
                    </Col>
                  </Row>
                  <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                    <Col>
                      <Space>
                        <Input.Search
                          allowClear
                          placeholder={intl.formatMessage({ id: 'sandboxMgr.health.serviceTypePlaceholder' })}
                          onSearch={(value) => loadWatermarkList({ serviceType: trim(value || '') })}
                          style={{ width: 240 }}
                        />
                      </Space>
                    </Col>
                    <Col>
                      <Space>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => {
                            loadHealthSwitch();
                            loadWatermarkList();
                          }}
                          loading={watermarkLoading}
                        >
                          {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
                        </Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddWatermark}>
                          {intl.formatMessage({ id: 'sandboxMgr.health.add' })}
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                  <Table<SandboxHealthWatermarkModel>
                    rowKey={(record) => String(record.id || `${record.serviceType}-${record.profileKey || 'default'}`)}
                    dataSource={watermarkList}
                    loading={watermarkLoading}
                    pagination={false}
                    columns={watermarkColumns}
                    scroll={{ x: 1400 }}
                  />
                </div>
              ),
            },
            {
              key: 'elastic',
              label: (
                <Space size={4}>
                  <ThunderboltOutlined />
                  {intl.formatMessage({ id: 'sandboxMgr.config.tab.elastic' })}
                </Space>
              ),
              children: (
                <div className={styles.elasticContent}>
                  <Form
                    form={resizeForm}
                    layout="vertical"
                    preserve={false}
                    initialValues={{ serviceType: DEFAULT_SERVICE_TYPE, resizeType: 'IN_PLACE' }}
                  >
                    <Row gutter={12}>
                      <Col span={6}>
                        <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.elastic.userCode' })} name="userCode">
                          <Input
                            allowClear
                            placeholder={intl.formatMessage({ id: 'sandboxMgr.elastic.userCodePlaceholder' })}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={7}>
                        <Form.Item
                          label={intl.formatMessage({ id: 'sandboxMgr.elastic.runningSandbox' })}
                          name="sandboxRecordId"
                          rules={[
                            {
                              required: true,
                              message: intl.formatMessage({ id: 'sandboxMgr.elastic.selectSandboxRequired' }),
                            },
                          ]}
                        >
                          <Select
                            allowClear
                            loading={resizeSandboxLoading}
                            placeholder={intl.formatMessage({ id: 'sandboxMgr.elastic.runningSandboxPlaceholder' })}
                            onChange={handleSelectResizeSandbox}
                            optionLabelProp="label"
                          >
                            {resizeSandboxList.map((item) => (
                              <Option
                                key={item.id}
                                value={item.id}
                                label={`#${item.id} / ${item.userCode} / ${getProfileLabel(
                                  item.profileKey,
                                  item.serviceType || item.sandboxType
                                )}`}
                              >
                                {renderSandboxOption(item)}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item
                          label={intl.formatMessage({ id: 'sandboxMgr.elastic.targetProfile' })}
                          name="profileKey"
                          rules={[
                            {
                              required: true,
                              message: intl.formatMessage({ id: 'sandboxMgr.elastic.profileRequired' }),
                            },
                          ]}
                        >
                          <Select
                            loading={profileLoading}
                            placeholder={intl.formatMessage({ id: 'sandboxMgr.elastic.targetProfilePlaceholder' })}
                            optionLabelProp="label"
                          >
                            {enabledProfileList.map((item) => (
                              <Option
                                key={`${item.serviceType}-${item.profileKey}`}
                                value={item.profileKey}
                                label={getProfileLabel(item.profileKey, item.serviceType)}
                              >
                                {renderProfileOption(item)}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          label={intl.formatMessage({ id: 'sandboxMgr.elastic.resizeType' })}
                          name="resizeType"
                        >
                          <Select optionLabelProp="label">
                            {RESIZE_STRATEGIES.map((item) => (
                              <Option key={item} value={item} label={getResizeStrategyLabel(item)}>
                                <div className={styles.optionContent}>
                                  <Space size={6}>
                                    <ThunderboltOutlined className={styles.strategyIcon} />
                                    <span className={styles.optionTitle}>{getResizeStrategyLabel(item)}</span>
                                    <Tooltip title={getResizeStrategyDesc(item)}>
                                      <InfoCircleOutlined className={styles.infoIcon} />
                                    </Tooltip>
                                  </Space>
                                  <div className={styles.optionMeta}>{getResizeStrategyDesc(item)}</div>
                                </div>
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item
                      label={intl.formatMessage({ id: 'sandboxMgr.elastic.reasonDetail' })}
                      name="reasonDetail"
                    >
                      <Input.TextArea
                        rows={2}
                        placeholder={intl.formatMessage({ id: 'sandboxMgr.elastic.reasonDetailPlaceholder' })}
                      />
                    </Form.Item>
                    <Space wrap>
                      <Button onClick={handleQueryResizeSandboxes} loading={resizeSandboxLoading}>
                        {intl.formatMessage({ id: 'sandboxMgr.elastic.queryRunning' })}
                      </Button>
                      <Button type="primary" onClick={handleSubmitResize} loading={resizing}>
                        {intl.formatMessage({ id: 'sandboxMgr.elastic.execute' })}
                      </Button>
                      <Button
                        onClick={() =>
                          selectedResizeRecord && loadResizeRecords({ sandboxRecordId: selectedResizeRecord.id })
                        }
                        disabled={!selectedResizeRecord}
                      >
                        {intl.formatMessage({ id: 'sandboxMgr.elastic.refreshRecords' })}
                      </Button>
                    </Space>
                  </Form>

                  {selectedResizeRecord && (
                    <div className={styles.elasticOverview}>
                      <div className={styles.elasticCard}>
                        <div className={styles.elasticCardHeader}>
                          <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.selectedSandbox' })}</span>
                          {renderProfileTag(
                            selectedResizeRecord.profileKey,
                            selectedResizeRecord.serviceType || selectedResizeRecord.sandboxType,
                            selectedResizeRecord.resourceRequests,
                            selectedResizeRecord.resourceLimits
                          )}
                        </div>
                        <div className={styles.sandboxIdentity}>
                          <span>#{selectedResizeRecord.id}</span>
                          <span>{selectedResizeRecord.userCode}</span>
                          <Tooltip title={selectedResizeRecord.sandboxId || '-'}>
                            <Typography.Text ellipsis className={styles.sandboxIdText}>
                              {selectedResizeRecord.sandboxId || '-'}
                            </Typography.Text>
                          </Tooltip>
                        </div>
                      </div>

                      <div className={styles.elasticCard}>
                        <div className={styles.elasticCardHeader}>
                          <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.currentResource' })}</span>
                          <Tooltip
                            title={
                              <div>
                                <div>
                                  {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceRequests' })}:{' '}
                                  {selectedResource?.rawRequests}
                                </div>
                                <div>
                                  {intl.formatMessage({ id: 'sandboxMgr.elastic.resourceLimits' })}:{' '}
                                  {selectedResource?.rawLimits}
                                </div>
                              </div>
                            }
                          >
                            <InfoCircleOutlined className={styles.infoIcon} />
                          </Tooltip>
                        </div>
                        <div className={styles.resourceGrid}>
                          <div className={styles.resourceMetric}>
                            <DashboardOutlined />
                            <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.cpuGuaranteed' })}</span>
                            <strong>{selectedResource?.requestCpu}</strong>
                          </div>
                          <div className={styles.resourceMetric}>
                            <DatabaseOutlined />
                            <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.memoryGuaranteed' })}</span>
                            <strong>{selectedResource?.requestMemory}</strong>
                          </div>
                          <div className={styles.resourceMetric}>
                            <DashboardOutlined />
                            <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.cpuLimit' })}</span>
                            <strong>{selectedResource?.limitCpu}</strong>
                          </div>
                          <div className={styles.resourceMetric}>
                            <DatabaseOutlined />
                            <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.memoryLimit' })}</span>
                            <strong>{selectedResource?.limitMemory}</strong>
                          </div>
                        </div>
                      </div>

                      <div className={classNames(styles.elasticCard, styles.previewCard)}>
                        <div className={styles.elasticCardHeader}>
                          <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.preview.title' })}</span>
                          {targetProfile && (
                            <Tag color={getProfileColor(targetProfile.profileKey)}>
                              {getProfileCompareLabel(selectedResizeRecord.profileKey, targetProfile.profileKey)}
                            </Tag>
                          )}
                        </div>
                        {targetProfile && targetResource ? (
                          <>
                            <div className={styles.previewLine}>
                              <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.preview.current' })}</span>
                              <strong>
                                {getProfileLabel(
                                  selectedResizeRecord.profileKey,
                                  selectedResizeRecord.serviceType || selectedResizeRecord.sandboxType
                                )}
                              </strong>
                            </div>
                            <div className={styles.previewLine}>
                              <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.preview.target' })}</span>
                              <strong>{getProfileLabel(targetProfile.profileKey, targetProfile.serviceType)}</strong>
                            </div>
                            <div className={styles.previewLine}>
                              <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.preview.targetResource' })}</span>
                              <strong>
                                {targetResource.requestCpu} CPU / {targetResource.requestMemory} →{' '}
                                {targetResource.limitCpu} CPU / {targetResource.limitMemory}
                              </strong>
                            </div>
                            <div className={styles.previewLine}>
                              <span>{intl.formatMessage({ id: 'sandboxMgr.elastic.preview.strategy' })}</span>
                              <strong>{renderStrategy(watchedResizeType)}</strong>
                            </div>
                          </>
                        ) : (
                          <div className={styles.previewEmpty}>
                            <InfoCircleOutlined />
                            {intl.formatMessage({ id: 'sandboxMgr.elastic.preview.noTarget' })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <Typography.Title level={5}>
                    {intl.formatMessage({ id: 'sandboxMgr.elastic.runningList' })}
                  </Typography.Title>
                  <Table<SsSandboxRecord>
                    rowKey="id"
                    size="small"
                    dataSource={resizeSandboxList}
                    loading={resizeSandboxLoading}
                    pagination={false}
                    columns={resizeSandboxColumns}
                    scroll={{ x: 1200 }}
                  />

                  <Typography.Title level={5} className={styles.resizeRecordTitle}>
                    {intl.formatMessage({ id: 'sandboxMgr.elastic.records' })}
                  </Typography.Title>
                  <Table<SandboxResizeRecord>
                    rowKey="id"
                    size="small"
                    dataSource={resizeRecords}
                    loading={resizeRecordsLoading}
                    pagination={false}
                    columns={resizeRecordColumns}
                    scroll={{ x: 1780 }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Drawer>

      {/* 沙箱配置表单弹窗 */}
      <ModalDrawer
        title={intl.formatMessage({
          id: editingSpec ? 'sandboxMgr.config.edit' : 'sandboxMgr.config.addTitle',
        })}
        open={specFormVisible}
        onCancel={handleCancelSpecForm}
        onOk={handleSaveSpec}
        confirmLoading={savingSpec}
        width={720}
      >
        <Form form={specForm} layout="vertical" preserve={false}>
          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.config.serviceKey' })}
            name="serviceKey"
            rules={[{ required: true, message: intl.formatMessage({ id: 'sandboxMgr.config.serviceKeyRequired' }) }]}
          >
            <Input
              disabled={!!editingSpec}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.config.serviceKeyPlaceholder' })}
            />
          </Form.Item>

          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.config.autoStart' })}
            name="enabled"
            valuePropName="checked"
            tooltip={intl.formatMessage({ id: 'sandboxMgr.config.autoStartTip' })}
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {intl.formatMessage({ id: 'sandboxMgr.config.specJson' })}
                <Tooltip title={intl.formatMessage({ id: 'sandboxMgr.config.format' })}>
                  <FormatPainterOutlined
                    style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                    onClick={() => {
                      const val = specForm.getFieldValue('specJson');
                      if (!val) return;
                      try {
                        specForm.setFieldsValue({ specJson: JSON.stringify(JSON.parse(val), null, 2) });
                      } catch {
                        return;
                      }
                    }}
                  />
                </Tooltip>
                <Tooltip title={intl.formatMessage({ id: 'sandboxMgr.config.copy' })}>
                  <CopyOutlined
                    style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                    onClick={() => {
                      const val = specForm.getFieldValue('specJson');
                      if (val) {
                        navigator.clipboard.writeText(val).then(() => {
                          message.success(intl.formatMessage({ id: 'sandboxMgr.config.copySuccess' }));
                        });
                      }
                    }}
                  />
                </Tooltip>
                <Tooltip
                  title={intl.formatMessage({
                    id:
                      maximizedField === 'specJson'
                        ? 'sandboxMgr.config.exitFullscreen'
                        : 'sandboxMgr.config.maximized',
                  })}
                >
                  {maximizedField === 'specJson' ? (
                    <FullscreenExitOutlined
                      style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                      onClick={() => setMaximizedField(null)}
                    />
                  ) : (
                    <FullscreenOutlined
                      style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                      onClick={() => setMaximizedField('specJson')}
                    />
                  )}
                </Tooltip>
              </span>
            }
            name="specJson"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'sandboxMgr.config.specJsonRequired' }) },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch (e) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                  }
                },
              },
            ]}
          >
            <JsonCodeEditor
              rows={12}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.config.specJsonPlaceholder' })}
              maximized={maximizedField === 'specJson'}
              onExitMaximize={() => setMaximizedField(null)}
            />
          </Form.Item>

          <Form.Item
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {intl.formatMessage({ id: 'sandboxMgr.config.templateJson' })}
                <Tooltip title={intl.formatMessage({ id: 'sandboxMgr.config.format' })}>
                  <FormatPainterOutlined
                    style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                    onClick={() => {
                      const val = specForm.getFieldValue('templateJson');
                      if (!val) return;
                      try {
                        specForm.setFieldsValue({ templateJson: JSON.stringify(JSON.parse(val), null, 2) });
                      } catch {
                        return;
                      }
                    }}
                  />
                </Tooltip>
                <Tooltip title={intl.formatMessage({ id: 'sandboxMgr.config.copy' })}>
                  <CopyOutlined
                    style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                    onClick={() => {
                      const val = specForm.getFieldValue('templateJson');
                      if (val) {
                        navigator.clipboard.writeText(val).then(() => {
                          message.success(intl.formatMessage({ id: 'sandboxMgr.config.copySuccess' }));
                        });
                      }
                    }}
                  />
                </Tooltip>
                <Tooltip
                  title={intl.formatMessage({
                    id:
                      maximizedField === 'templateJson'
                        ? 'sandboxMgr.config.exitFullscreen'
                        : 'sandboxMgr.config.maximized',
                  })}
                >
                  {maximizedField === 'templateJson' ? (
                    <FullscreenExitOutlined
                      style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                      onClick={() => setMaximizedField(null)}
                    />
                  ) : (
                    <FullscreenOutlined
                      style={{ cursor: 'pointer', color: 'var(--beyond-color-primary, #1677ff)' }}
                      onClick={() => setMaximizedField('templateJson')}
                    />
                  )}
                </Tooltip>
              </span>
            }
            name="templateJson"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch (e) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                  }
                },
              },
            ]}
          >
            <JsonCodeEditor
              rows={8}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.config.templateJsonPlaceholder' })}
              maximized={maximizedField === 'templateJson'}
              onExitMaximize={() => setMaximizedField(null)}
            />
          </Form.Item>
        </Form>
      </ModalDrawer>

      {/* 沙箱服务规格档位表单 */}
      <ModalDrawer
        title={intl.formatMessage({
          id: editingProfile ? 'sandboxMgr.profile.editTitle' : 'sandboxMgr.profile.addTitle',
        })}
        open={profileFormVisible}
        onCancel={handleCancelProfileForm}
        onOk={handleSaveProfile}
        confirmLoading={savingProfile}
        width={720}
      >
        <Form form={profileForm} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.profile.serviceType' })}
                name="serviceType"
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'sandboxMgr.profile.serviceTypeRequired' }) },
                ]}
              >
                <Input
                  disabled={!!editingProfile}
                  placeholder={intl.formatMessage({ id: 'sandboxMgr.profile.serviceTypePlaceholder' })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.profile.profileKey' })}
                name="profileKey"
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'sandboxMgr.profile.profileKeyRequired' }) },
                ]}
              >
                <Input
                  disabled={!!editingProfile}
                  placeholder={intl.formatMessage({ id: 'sandboxMgr.profile.profileKeyPlaceholder' })}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.elastic.resizeType' })} name="resizeStrategy">
                <Select>
                  {RESIZE_STRATEGIES.map((item) => (
                    <Option key={item} value={item}>
                      {getResizeStrategyLabel(item)}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.profile.sortOrder' })} name="sortOrder">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.profile.resizeEnabled' })}
                name="resizeEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.profile.enabled' })}
                name="enabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.profile.resourceRequests' })}
            name="resourceRequests"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'sandboxMgr.profile.resourceRequestsRequired' }) },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Promise.resolve();
                  } catch (e) {
                    // handled below
                  }
                  return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                },
              },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.profile.resourceRequestsPlaceholder' })}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.profile.resourceLimits' })}
            name="resourceLimits"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'sandboxMgr.profile.resourceLimitsRequired' }) },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Promise.resolve();
                  } catch (e) {
                    // handled below
                  }
                  return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                },
              },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.profile.resourceLimitsPlaceholder' })}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.profile.templatePatchJson' })}
            name="templatePatchJson"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Promise.resolve();
                  } catch (e) {
                    // handled below
                  }
                  return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                },
              },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.profile.templatePatchJsonPlaceholder' })}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
        </Form>
      </ModalDrawer>

      {/* 沙箱健康水位模型表单 */}
      <ModalDrawer
        title={intl.formatMessage({
          id: editingWatermark ? 'sandboxMgr.health.editTitle' : 'sandboxMgr.health.addTitle',
        })}
        open={watermarkFormVisible}
        onCancel={handleCancelWatermarkForm}
        onOk={handleSaveWatermark}
        confirmLoading={savingWatermark}
        width={760}
      >
        <Form form={watermarkForm} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.modelName' })}
                name="modelName"
                rules={[{ required: true, message: intl.formatMessage({ id: 'sandboxMgr.health.modelNameRequired' }) }]}
              >
                <Input placeholder={intl.formatMessage({ id: 'sandboxMgr.health.modelNamePlaceholder' })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.profile.serviceType' })}
                name="serviceType"
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'sandboxMgr.profile.serviceTypeRequired' }) },
                ]}
              >
                <Input placeholder={intl.formatMessage({ id: 'sandboxMgr.profile.serviceTypePlaceholder' })} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.profile.enabled' })}
                name="enabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.profile.profileKey' })} name="profileKey">
                <Select
                  allowClear
                  showSearch
                  placeholder={intl.formatMessage({ id: 'sandboxMgr.health.profileKeyPlaceholder' })}
                  optionLabelProp="label"
                >
                  {sortedProfileList.map((item) => (
                    <Option
                      key={`${item.serviceType}-${item.profileKey}`}
                      value={item.profileKey}
                      label={getProfileLabel(item.profileKey, item.serviceType)}
                    >
                      {renderProfileOption(item)}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={7}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.health.priority' })} name="priority">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={7}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.sampleIntervalSeconds' })}
                name="sampleIntervalSeconds"
              >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="s" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.idleMemoryLimitRatio' })}
                name="idleMemoryLimitRatio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 3 }]}
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.busyMemoryLimitRatio' })}
                name="busyMemoryLimitRatio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 3 }]}
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.criticalMemoryLimitRatio' })}
                name="criticalMemoryLimitRatio"
                dependencies={['idleMemoryLimitRatio', 'busyMemoryLimitRatio']}
                rules={[
                  { required: true },
                  { type: 'number', min: 0, max: 3 },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const idle = getFieldValue('idleMemoryLimitRatio');
                      const busy = getFieldValue('busyMemoryLimitRatio');
                      if (idle < busy && busy < value) return Promise.resolve();
                      return Promise.reject(
                        new Error(intl.formatMessage({ id: 'sandboxMgr.health.memoryOrderError' }))
                      );
                    },
                  }),
                ]}
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.busyCpuRequestRatio' })}
                name="busyCpuRequestRatio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 3 }]}
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.criticalCpuRequestRatio' })}
                name="criticalCpuRequestRatio"
                dependencies={['busyCpuRequestRatio']}
                rules={[
                  { required: true },
                  { type: 'number', min: 0, max: 3 },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const busy = getFieldValue('busyCpuRequestRatio');
                      if (busy < value) return Promise.resolve();
                      return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.health.cpuOrderError' })));
                    },
                  }),
                ]}
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.consecutiveBusySamples' })}
                name="consecutiveBusySamples"
              >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.health.recoverSamples' })} name="recoverSamples">
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.snapshotTtlSeconds' })}
                name="snapshotTtlSeconds"
              >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="s" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.health.watchTtlSeconds' })} name="watchTtlSeconds">
                <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="s" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.health.remark' })} name="remark">
                <Input placeholder={intl.formatMessage({ id: 'sandboxMgr.health.remarkPlaceholder' })} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Title level={5}>{intl.formatMessage({ id: 'sandboxMgr.health.preview' })}</Typography.Title>
          <Row gutter={12} align="middle">
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.previewCpu' })}
                name="previewCpuRequestRatio"
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={intl.formatMessage({ id: 'sandboxMgr.health.previewMemory' })}
                name="previewMemoryLimitRatio"
              >
                <InputNumber min={0} max={3} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Button onClick={handlePreviewWatermark} loading={previewLoading}>
                {intl.formatMessage({ id: 'sandboxMgr.health.previewAction' })}
              </Button>
              {previewResult?.healthLevel && (
                <Tag color={healthLevelColorMap[previewResult.healthLevel] || 'default'} style={{ marginLeft: 12 }}>
                  {previewResult.healthLevel}
                </Tag>
              )}
            </Col>
          </Row>
        </Form>
      </ModalDrawer>

      {/* 指定用户沙箱弹窗 */}
      <Modal
        title={intl.formatMessage({ id: 'sandboxMgr.launch.title' })}
        open={launchModalOpen}
        onCancel={() => setLaunchModalOpen(false)}
        onOk={handleLaunchSandbox}
        confirmLoading={launching}
        destroyOnClose
      >
        <Form form={launchForm} layout="vertical" preserve={false}>
          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.launch.userCode' })}
            name="userCode"
            rules={[{ required: true, message: intl.formatMessage({ id: 'sandboxMgr.launch.userCodeRequired' }) }]}
          >
            <Input placeholder={intl.formatMessage({ id: 'sandboxMgr.launch.userCodePlaceholder' })} />
          </Form.Item>
          <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.launch.serviceKey' })} name="serviceKey">
            <Select placeholder={intl.formatMessage({ id: 'sandboxMgr.launch.serviceKeyPlaceholder' })} allowClear>
              {launchSpecList.map((item) => (
                <Option key={item.serviceKey} value={item.serviceKey}>
                  {item.serviceKey}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SandboxMgr;
