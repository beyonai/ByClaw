import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiOutlined,
  CheckCircleFilled,
  DatabaseOutlined,
  DisconnectOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  GlobalOutlined,
  GithubOutlined,
  LinkOutlined,
  LoadingOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Drawer, Dropdown, Empty, Form, Input, Modal, Spin, Switch, Tooltip, message } from 'antd';
import classNames from 'classnames';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { useSelector } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import {
  getConnectorAuthorization,
  cancelConnectorAuthorization,
  queryAllConnectors,
  revokeConnectorAuthorization,
  startConnectorAuthorization,
  startConnectorCredentialAuthorization,
  updateConnectorEnable,
  type ConnectorAuthorization,
  type ConnectorCredentialState,
  type ConnectorCredentialForm,
  type ConnectorEnableFlag,
  type ConnectorId,
  type ConnectorListItem,
  type ConnectorRenewalMode,
} from '@/service/connector';

import styles from './index.module.less';
import CredentialHelpCard from './CredentialHelpCard';
import GlobalAccountSection from './GlobalAccountSection';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const CREDENTIAL_TIMEZONE = 'Asia/Shanghai';
const CREDENTIAL_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const LEGACY_CREDENTIAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const OFFSET_CREDENTIAL_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:?\d{2})$/;

const hasValidOffset = (offset: string) => {
  if (offset === 'Z') return true;

  const compactOffset = offset.replace(':', '');
  const hours = Number(compactOffset.slice(1, 3));
  const minutes = Number(compactOffset.slice(3, 5));
  return hours < 14 ? minutes < 60 : hours === 14 && minutes === 0;
};

export const normalizeCredentialExpirationOffset = (value: string) => value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

export const getCredentialExpirationDisplay = (
  value: string,
  now: string | number | Date = Date.now()
): { formattedTime: string; expired: boolean } | undefined => {
  const trimmedValue = value.trim();
  let credentialExpiration;

  if (LEGACY_CREDENTIAL_TIME_PATTERN.test(trimmedValue)) {
    const normalizedValue = trimmedValue.replace('T', ' ');
    credentialExpiration = dayjs.tz(normalizedValue, CREDENTIAL_TIME_FORMAT, CREDENTIAL_TIMEZONE);
    if (!credentialExpiration.isValid() || credentialExpiration.format(CREDENTIAL_TIME_FORMAT) !== normalizedValue) {
      return undefined;
    }
  } else {
    const offsetMatch = OFFSET_CREDENTIAL_TIME_PATTERN.exec(trimmedValue);
    if (!offsetMatch) return undefined;

    const normalizedWallClock = `${offsetMatch[1]} ${offsetMatch[2]}`;
    const wallClock = dayjs(normalizedWallClock, CREDENTIAL_TIME_FORMAT, true);
    if (
      !wallClock.isValid() ||
      wallClock.format(CREDENTIAL_TIME_FORMAT) !== normalizedWallClock ||
      !hasValidOffset(offsetMatch[3])
    ) {
      return undefined;
    }
    credentialExpiration = dayjs(normalizeCredentialExpirationOffset(trimmedValue));
  }

  const comparisonTime = dayjs(now);
  if (!credentialExpiration.isValid() || !comparisonTime.isValid()) return undefined;

  return {
    formattedTime: credentialExpiration.tz(CREDENTIAL_TIMEZONE).format(CREDENTIAL_TIME_FORMAT),
    expired: credentialExpiration.isBefore(comparisonTime),
  };
};

// 用于分批放开聊天框入口；接口不可用时不会模拟授权成功。
export const CONNECTOR_ENTRY_VISIBLE = true;

export type Connector = {
  id: ConnectorId;
  code: string;
  name: string;
  description: string;
  authType: 'qrcode' | 'oauth';
  icon: React.ReactNode;
  enableFlag: ConnectorEnableFlag;
  credentialState?: ConnectorCredentialState | null;
  renewalMode?: ConnectorRenewalMode | null;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  lastVerifiedAt?: string | null;
  credentialExpiresAt?: string | null;
  authMode?: string | null;
  credentialForm?: ConnectorCredentialForm | null;
};

type CredentialValues = Record<string, string>;
const CREDENTIAL_FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

type ConnectorControlProps = {
  canAuthorize: boolean;
  // 兼容尚未同步升级的调用方；连接器状态只以后端全局开关为准。
  value?: Connector[];
  onChange?: (connectors: Connector[]) => void;
};

// 已有官方图标的连接器按接口编码匹配，其余平台使用统一图标，列表内容完全以后端返回为准。
const connectorIconMap: Record<string, React.ReactNode> = {
  dingtalk: <AntdIcon type="icon-dingding1" />,
  wecom: <AntdIcon type="icon-qiyeweixin" />,
  lark: <AntdIcon type="icon-feishu" />,
  github: <GithubOutlined />,
};

const getConnectorIcon = (connectorCode: string) => connectorIconMap[connectorCode] || <ApiOutlined />;

// 不再过滤接口数据，所有连接器都保留后端的 ID、编码、名称和描述。
const mapConnectorListItem = (item: ConnectorListItem): Connector => ({
  id: item.connectorId,
  code: item.connectorCode,
  name: item.connectorName,
  description: item.description,
  authType: 'oauth',
  icon: getConnectorIcon(item.connectorCode),
  enableFlag: item.enableFlag,
  credentialState: item.credentialState,
  renewalMode: item.renewalMode,
  accessExpiresAt: item.accessExpiresAt,
  refreshExpiresAt: item.refreshExpiresAt,
  lastVerifiedAt: item.lastVerifiedAt,
  credentialExpiresAt: item.credentialExpiresAt,
  authMode: item.authMode,
  credentialForm: item.credentialForm,
});

// 快捷列表优先展示当前已授权且启用的连接器，同组内保留后端原始顺序。
export const prioritizeEnabledConnectors = (items: Connector[]) => [
  ...items.filter((item) => item.enableFlag === 'Y'),
  ...items.filter((item) => item.enableFlag !== 'Y'),
];

const authorizationTerminalMessages: Partial<Record<ConnectorAuthorization['status'], string>> = {
  failed: '授权未完成，请重新发起连接',
  expired: '授权任务已失效，请重新发起连接',
  cancelled: '授权已取消，请重新发起连接',
};

export const getConnectorAuthorizationTerminalError = (
  authorization: Pick<ConnectorAuthorization, 'status' | 'errorMessage'>
) => {
  const fallbackMessage = authorizationTerminalMessages[authorization.status];
  if (!fallbackMessage) return undefined;
  return authorization.errorMessage || fallbackMessage;
};

const isSafeAuthorizationUrl = (authorizationUrl: string) => {
  try {
    const url = new URL(authorizationUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const isSafeCredentialHelpUrl = (helpUrl: string) => {
  try {
    const url = new URL(helpUrl);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const hasValidCredentialForm = (
  connector: Connector | undefined
): connector is Connector & {
  authMode: 'AK_SK';
  credentialForm: ConnectorCredentialForm;
} => {
  if (connector?.authMode !== 'AK_SK') return false;

  const credentialForm = connector.credentialForm;
  if (
    !credentialForm ||
    typeof credentialForm.helpUrl !== 'string' ||
    !isSafeCredentialHelpUrl(credentialForm.helpUrl) ||
    !Array.isArray(credentialForm.fields)
  ) {
    return false;
  }
  if (credentialForm.fields.length < 1 || credentialForm.fields.length > 8) return false;
  if (
    credentialForm.helpText !== undefined &&
    (typeof credentialForm.helpText !== 'string' ||
      credentialForm.helpText.trim().length === 0 ||
      credentialForm.helpText.trim().length > 500)
  ) {
    return false;
  }
  if (
    credentialForm.helpLinkText !== undefined &&
    (typeof credentialForm.helpLinkText !== 'string' ||
      credentialForm.helpLinkText.trim().length === 0 ||
      credentialForm.helpLinkText.trim().length > 100)
  ) {
    return false;
  }

  const keys = new Set<string>();
  return credentialForm.fields.every((field) => {
    const valid =
      field &&
      typeof field.key === 'string' &&
      CREDENTIAL_FIELD_KEY_PATTERN.test(field.key) &&
      !keys.has(field.key) &&
      typeof field.label === 'string' &&
      field.label.trim().length > 0 &&
      field.label.trim().length <= 100 &&
      Number.isInteger(field.maxLength) &&
      field.maxLength > 0 &&
      field.maxLength <= 2048 &&
      (field.inputType === 'text' || field.inputType === 'password');
    if (valid) keys.add(field.key);
    return valid;
  });
};

const getCredentialAuthorizationError = (connector: Connector, errorCode?: string) => {
  if (connector.code === 'weixin-official-api') {
    if (errorCode === 'CONNECTOR_CREDENTIAL_INVALID') {
      return 'AppID 或 AppSecret 无效，请检查后重试';
    }
    if (errorCode === 'WEIXIN_IP_NOT_ALLOWLISTED') {
      return '请将 ByClaw 后端出口 IP 加入公众号 IP 白名单后重试';
    }
    if (errorCode === 'CONNECTOR_VERIFICATION_TIMEOUT' || errorCode === 'CONNECTOR_VERIFICATION_FAILED') {
      return '微信接口暂时不可用，凭据未保存，请稍后重试';
    }
    return '微信公众号 API 凭据验证失败，请检查后重试';
  }
  return `${connector.name} 凭据验证失败，请检查后重试`;
};

const ConnectorIcon = ({ connector }: { connector: Connector }) => (
  <span className={styles.connectorIcon}>{connector.icon}</span>
);

const ConnectorSelection = ({ value, onOpen }: { value: Connector[]; onOpen: () => void }) => {
  if (!value.length) return null;

  // 工具栏空间有限，最多回显三个官方图标，其余连接器用数量汇总。
  const displayedConnectors = value.slice(0, 3);
  const remainingCount = value.length - displayedConnectors.length;

  return (
    <Tooltip title="查看已连接连接器">
      <button className={styles.selection} type="button" aria-label="查看已连接连接器" onClick={onOpen}>
        <Avatar.Group className={styles.selectionGroup} size={28}>
          {displayedConnectors.map((connector) => (
            <Avatar key={connector.id} className={styles.selectionAvatar} aria-label={connector.name}>
              <ConnectorIcon connector={connector} />
            </Avatar>
          ))}
          {remainingCount > 0 && <Avatar className={styles.selectionMoreAvatar}>+{remainingCount}</Avatar>}
        </Avatar.Group>
      </button>
    </Tooltip>
  );
};

const ConnectorControl = ({ canAuthorize }: ConnectorControlProps) => {
  const { userInfo } = useSelector((state: any) => state.user);

  // 分别控制设置列表、完整配置、授权说明和真实授权进度的显示状态。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [accountToolbar, setAccountToolbar] = useState<React.ReactNode>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [authorizingConnector, setAuthorizingConnector] = useState<Connector | undefined>(undefined);
  // 一次性授权任务由后端创建，包含真实二维码或第三方授权链接。
  const [authorizationSession, setAuthorizationSession] = useState<ConnectorAuthorization | undefined>(undefined);
  // 列表完全由后端返回，避免请求完成前短暂展示静态假数据。
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loadingConnectors, setLoadingConnectors] = useState(false);
  const [updatingConnectorIds, setUpdatingConnectorIds] = useState<Set<ConnectorId>>(new Set());
  const [revokingConnectorIds, setRevokingConnectorIds] = useState<Set<ConnectorId>>(new Set());
  const [startingAuthorization, setStartingAuthorization] = useState(false);
  const [checkingAuthorization, setCheckingAuthorization] = useState(false);
  const [credentialFormVersion, setCredentialFormVersion] = useState(0);
  const activeAuthorizationIdRef = useRef<string | undefined>(undefined);
  const checkingAuthorizationIdRef = useRef<string | undefined>(undefined);
  const startAuthorizationGenerationRef = useRef(0);
  const authorizationTimerRef = useRef<number | undefined>(undefined);
  const attemptedAuthorizationOpenKeysRef = useRef<Set<string>>(new Set());
  const cancelledAuthorizationIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedInitialConnectorsRef = useRef(false);
  const connectorLoadGenerationRef = useRef(0);
  const credentialVerificationInFlightRef = useRef(false);
  const credentialAbortControllerRef = useRef<AbortController | undefined>(undefined);

  const clearCredentialValues = useCallback(() => {
    setCredentialFormVersion((version) => version + 1);
  }, []);

  const clearAuthorizationTimer = useCallback(() => {
    if (authorizationTimerRef.current === undefined) return;
    window.clearInterval(authorizationTimerRef.current);
    authorizationTimerRef.current = undefined;
  }, []);

  const abortCredentialVerification = useCallback(() => {
    const controller = credentialAbortControllerRef.current;
    if (controller) {
      controller.abort();
      credentialAbortControllerRef.current = undefined;
    }
    credentialVerificationInFlightRef.current = false;
  }, []);

  const invalidateAuthorizationRequests = useCallback(() => {
    startAuthorizationGenerationRef.current += 1;
    activeAuthorizationIdRef.current = undefined;
    checkingAuthorizationIdRef.current = undefined;
    clearAuthorizationTimer();
  }, [clearAuthorizationTimer]);

  const closeLocalAuthorization = useCallback(() => {
    abortCredentialVerification();
    invalidateAuthorizationRequests();
    if (hasValidCredentialForm(authorizingConnector)) {
      clearCredentialValues();
    }
    setStartingAuthorization(false);
    setCheckingAuthorization(false);
    setAuthorizationSession(undefined);
    setAuthorizingConnector(undefined);
  }, [abortCredentialVerification, authorizingConnector, clearCredentialValues, invalidateAuthorizationRequests]);

  const cancelAuthorizationInBackground = useCallback((authorizationId: string, reportFailure = true) => {
    if (cancelledAuthorizationIdsRef.current.has(authorizationId)) return;

    cancelledAuthorizationIdsRef.current.add(authorizationId);
    const cancellationGeneration = startAuthorizationGenerationRef.current;
    void cancelConnectorAuthorization(authorizationId).catch(() => {
      if (reportFailure && startAuthorizationGenerationRef.current === cancellationGeneration) {
        message.error('后台授权取消失败，请稍后重试');
      }
    });
  }, []);

  useEffect(
    () => () => {
      abortCredentialVerification();
      invalidateAuthorizationRequests();
    },
    [abortCredentialVerification, invalidateAuthorizationRequests]
  );

  useEffect(() => {
    if (!canAuthorize) closeLocalAuthorization();
  }, [canAuthorize, closeLocalAuthorization]);

  useEffect(() => {
    if (authorizingConnector?.authMode === 'AK_SK' && !hasValidCredentialForm(authorizingConnector)) {
      closeLocalAuthorization();
    }
  }, [authorizingConnector, closeLocalAuthorization]);

  useEffect(() => {
    if (!authorizingConnector) return;
    const latestConnector = connectors.find((connector) => connector.id === authorizingConnector.id);
    if (
      latestConnector &&
      (latestConnector.code !== authorizingConnector.code ||
        (authorizingConnector.authMode === 'AK_SK' && !hasValidCredentialForm(latestConnector)))
    ) {
      closeLocalAuthorization();
    }
  }, [authorizingConnector, closeLocalAuthorization, connectors]);

  const enabledConnectors = useMemo(() => connectors.filter((connector) => connector.enableFlag === 'Y'), [connectors]);
  const previewConnectors = useMemo(() => prioritizeEnabledConnectors(connectors).slice(0, 3), [connectors]);

  const loadAuthorizedConnectors = useCallback(
    async (reportAuthorizationRefreshFailure = false) => {
      const requestGeneration = connectorLoadGenerationRef.current + 1;
      connectorLoadGenerationRef.current = requestGeneration;
      const hasCachedConnectors = connectors.length > 0;
      if (hasCachedConnectors) {
        setCatalogRefreshing(true);
      } else {
        setLoadingConnectors(true);
      }
      try {
        const list = await queryAllConnectors();
        if (connectorLoadGenerationRef.current !== requestGeneration) return;
        const connectorList = list.map(mapConnectorListItem);
        setConnectors(connectorList);
      } catch {
        if (connectorLoadGenerationRef.current !== requestGeneration) return;
        if (reportAuthorizationRefreshFailure) {
          message.warning('连接器已授权，但有效期刷新失败，请稍后重试');
        } else if (!hasCachedConnectors) {
          message.error('连接器列表加载失败，请稍后重试');
        }
      } finally {
        if (connectorLoadGenerationRef.current === requestGeneration) {
          setCatalogRefreshing(false);
          setLoadingConnectors(false);
        }
      }
    },
    [connectors.length]
  );

  const completeAuthorization = useCallback(
    (authorization: ConnectorAuthorization) => {
      const connector = connectors.find((item) => item.id === authorization.connectorId);
      if (!connector) return;

      // 后端确认 connected 后，本地立即回显为全局开启状态。
      clearAuthorizationTimer();
      activeAuthorizationIdRef.current = undefined;
      setConnectors((items) =>
        items.map((item) =>
          item.id === authorization.connectorId
            ? { ...item, enableFlag: 'Y' as const, credentialExpiresAt: undefined }
            : item
        )
      );
      setAuthorizationSession(undefined);
      setAuthorizingConnector(undefined);
      credentialVerificationInFlightRef.current = false;
      clearCredentialValues();
      message.success(`${connector.name} 已连接`);
      void loadAuthorizedConnectors(true);
    },
    [clearAuthorizationTimer, clearCredentialValues, connectors, loadAuthorizedConnectors]
  );

  const tryOpenAuthorizationUrl = useCallback((authorization: ConnectorAuthorization, blockedMessage: string) => {
    if (!authorization.authorizationUrl) return;
    const openKey = authorization.phase
      ? `${authorization.authorizationId}|${authorization.phase}`
      : `${authorization.authorizationId}||${authorization.authorizationUrl}`;
    if (attemptedAuthorizationOpenKeysRef.current.has(openKey)) return;
    attemptedAuthorizationOpenKeysRef.current.add(openKey);
    const authorizationWindow = window.open(authorization.authorizationUrl, '_blank');
    if (authorizationWindow) {
      authorizationWindow.opener = null;
    } else {
      message.warning(blockedMessage);
    }
  }, []);

  const checkAuthorizationStatus = useCallback(
    async (silently = false) => {
      if (!authorizationSession) return;

      const authorizationId = authorizationSession.authorizationId;
      if (
        activeAuthorizationIdRef.current !== authorizationId ||
        checkingAuthorizationIdRef.current === authorizationId
      ) {
        return;
      }

      checkingAuthorizationIdRef.current = authorizationId;
      setCheckingAuthorization(true);
      try {
        const authorization = await getConnectorAuthorization(authorizationId);
        if (activeAuthorizationIdRef.current !== authorizationId) return;

        if (authorization.status === 'connected') {
          // 只有查询到最终成功状态，才回显为全局开启。
          completeAuthorization(authorization);
          return;
        }
        const terminalError = getConnectorAuthorizationTerminalError(authorization);
        if (terminalError) {
          clearAuthorizationTimer();
          activeAuthorizationIdRef.current = undefined;
          setAuthorizationSession(undefined);
          setAuthorizingConnector(undefined);
          message.error(terminalError);
          return;
        }
        if (authorization.authorizationUrl && !isSafeAuthorizationUrl(authorization.authorizationUrl)) {
          clearAuthorizationTimer();
          message.error('授权服务返回了无效的授权链接');
          return;
        }
        setAuthorizationSession(authorization);
        tryOpenAuthorizationUrl(authorization, '浏览器已阻止自动打开，请点击“继续授权”');
        if (!silently) message.info('尚未检测到授权完成，请完成授权后重试');
      } catch {
        if (activeAuthorizationIdRef.current === authorizationId && !silently) {
          message.error('授权状态查询失败，请稍后重试');
        }
      } finally {
        if (checkingAuthorizationIdRef.current === authorizationId) {
          checkingAuthorizationIdRef.current = undefined;
          setCheckingAuthorization(false);
        }
      }
    },
    [authorizationSession, clearAuthorizationTimer, completeAuthorization, tryOpenAuthorizationUrl]
  );

  useEffect(() => {
    clearAuthorizationTimer();
    if (!authorizationSession || authorizationSession.status !== 'pending') return undefined;

    // 后端负责处理三方回调，前端只轮询本次授权任务的状态。
    const timer = window.setInterval(() => void checkAuthorizationStatus(true), 3000);
    authorizationTimerRef.current = timer;
    return () => {
      window.clearInterval(timer);
      if (authorizationTimerRef.current === timer) {
        authorizationTimerRef.current = undefined;
      }
    };
  }, [authorizationSession, checkAuthorizationStatus, clearAuthorizationTimer]);

  useEffect(() => {
    if (hasLoadedInitialConnectorsRef.current || !userInfo?.userId) return;

    hasLoadedInitialConnectorsRef.current = true;
    void loadAuthorizedConnectors();
  }, [loadAuthorizedConnectors, userInfo?.userId]);

  const openSettings = () => {
    setSettingsOpen(true);
    void loadAuthorizedConnectors();
  };

  const confirmRevokeAuthorization = (connector: Connector) => {
    Modal.confirm({
      title: `取消${connector.name}授权？`,
      content:
        connector.code === 'weixin-official-api' && connector.authMode === 'AK_SK'
          ? '仅移除 ByClaw 保存的凭据，微信公众平台上的 AppSecret 仍保持有效'
          : connector.code === 'ima-openapi' && connector.authMode === 'AK_SK'
            ? '仅移除 ByClaw 保存的凭据，IMA 网站上的 API Key 仍保持有效。'
            : connector.authMode === 'AK_SK'
              ? '仅移除 ByClaw 保存的凭据，第三方平台上的凭据仍保持有效。'
              : '当前 CLI 登录凭证将被清除，再次使用时需要重新授权。',
      okText: '确认取消授权',
      okButtonProps: { danger: true },
      cancelText: '暂不取消',
      centered: true,
      onOk: async () => {
        setRevokingConnectorIds((ids) => new Set([...ids, connector.id]));
        try {
          await revokeConnectorAuthorization(connector.id);
          setConnectors((items) =>
            items.map((item) =>
              item.id === connector.id ? { ...item, enableFlag: null, credentialExpiresAt: undefined } : item
            )
          );
          message.success(`${connector.name}授权已取消`);
          await loadAuthorizedConnectors();
        } catch {
          message.error('取消授权失败，请稍后重试');
          throw new Error('取消授权失败');
        } finally {
          setRevokingConnectorIds((ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(connector.id);
            return nextIds;
          });
        }
      },
    });
  };

  const beginAuthorization = (connector: Connector) => {
    // 先展示权限说明，再进入对应平台的授权步骤。
    abortCredentialVerification();
    invalidateAuthorizationRequests();
    setStartingAuthorization(false);
    setAuthorizingConnector(connector);
    setAuthorizationSession(undefined);
  };

  const updateConnectorEnableFlag = async (connector: Connector, enabled: boolean) => {
    setUpdatingConnectorIds((ids) => new Set([...ids, connector.id]));
    try {
      await updateConnectorEnable(connector.id, enabled);
      setConnectors((items) =>
        items.map((item) => (item.id === connector.id ? { ...item, enableFlag: enabled ? 'Y' : 'N' } : item))
      );
    } catch {
      message.error('连接器启用状态更新失败，请稍后重试');
    } finally {
      setUpdatingConnectorIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(connector.id);
        return nextIds;
      });
    }
  };

  const startAuthorization = async () => {
    if (!authorizingConnector) return;

    const requestGeneration = startAuthorizationGenerationRef.current + 1;
    startAuthorizationGenerationRef.current = requestGeneration;
    setStartingAuthorization(true);
    try {
      // 三方密钥、回调 code 换 token 均由后端处理，前端只使用一次性授权任务信息。
      const authorization = await startConnectorAuthorization({
        connectorId: authorizingConnector.id,
        redirectUrl: `${window.location.origin}${window.location.pathname}`,
      });
      if (startAuthorizationGenerationRef.current !== requestGeneration) {
        if (authorization.status === 'pending' && authorization.authorizationId) {
          cancelAuthorizationInBackground(authorization.authorizationId, false);
        }
        return;
      }

      if (authorization.status === 'connected') {
        completeAuthorization(authorization);
        return;
      }
      const terminalError = getConnectorAuthorizationTerminalError(authorization);
      if (terminalError) {
        activeAuthorizationIdRef.current = undefined;
        setAuthorizationSession(undefined);
        message.error(terminalError);
        return;
      }
      if (!authorization.authorizationUrl && !authorization.qrCodeUrl) {
        throw new Error('授权服务未返回授权链接或二维码');
      }
      if (authorization.authorizationUrl && !isSafeAuthorizationUrl(authorization.authorizationUrl)) {
        throw new Error('授权服务返回了无效的授权链接');
      }
      activeAuthorizationIdRef.current = authorization.authorizationId;
      setAuthorizationSession(authorization);
      tryOpenAuthorizationUrl(
        authorization,
        `浏览器已阻止自动打开，请点击“打开${authorizingConnector.name}授权页”继续`
      );
    } catch (error) {
      if (startAuthorizationGenerationRef.current !== requestGeneration) return;
      message.error(error instanceof Error ? error.message : '发起授权失败，请稍后重试');
    } finally {
      if (startAuthorizationGenerationRef.current === requestGeneration) {
        setStartingAuthorization(false);
      }
    }
  };

  const startCredentialAuthorization = async (values: CredentialValues) => {
    if (
      !hasValidCredentialForm(authorizingConnector) ||
      startingAuthorization ||
      credentialVerificationInFlightRef.current
    ) {
      return;
    }

    const requestGeneration = startAuthorizationGenerationRef.current + 1;
    startAuthorizationGenerationRef.current = requestGeneration;
    const cancelToken = new AbortController();
    credentialAbortControllerRef.current = cancelToken;
    credentialVerificationInFlightRef.current = true;
    setStartingAuthorization(true);
    // 仅让凭据停留在当前请求闭包中；提交后立即清空受控表单。
    const credentials = Object.fromEntries(
      authorizingConnector.credentialForm.fields.map(({ key }) => [key, values[key]])
    );
    clearCredentialValues();
    try {
      const authorizationRequest = startConnectorCredentialAuthorization({
        connectorId: authorizingConnector.id,
        redirectUrl: window.location.origin,
        credentials,
        cancelToken,
      });
      Object.keys(values).forEach((key) => {
        values[key] = '';
      });
      const authorization = await authorizationRequest;
      if (cancelToken.signal.aborted || startAuthorizationGenerationRef.current !== requestGeneration) return;

      if (authorization.status === 'connected') {
        completeAuthorization(authorization);
        return;
      }
      // 凭据验证是同步流程，异常的 pending/failed 响应不得进入 OAuth 轮询路径。
      message.error(getCredentialAuthorizationError(authorizingConnector, authorization.errorCode));
    } catch {
      if (!cancelToken.signal.aborted && startAuthorizationGenerationRef.current === requestGeneration) {
        // 不展示后端原始错误，避免错误内容意外回显用户提交的凭据。
        message.error(getCredentialAuthorizationError(authorizingConnector));
      }
    } finally {
      if (credentialAbortControllerRef.current === cancelToken) {
        credentialAbortControllerRef.current = undefined;
        credentialVerificationInFlightRef.current = false;
      }
      if (startAuthorizationGenerationRef.current === requestGeneration) {
        setStartingAuthorization(false);
      }
    }
  };

  const cancelAuthorization = () => {
    const authorizationId = authorizationSession?.authorizationId;
    if (authorizationId && cancelledAuthorizationIdsRef.current.has(authorizationId)) return;

    closeLocalAuthorization();
    if (!authorizationId) return;
    cancelAuthorizationInBackground(authorizationId);
  };

  // 未登录或功能开关关闭时，不在聊天框显示连接器入口。
  if (!CONNECTOR_ENTRY_VISIBLE || !canAuthorize) return null;

  const credentialSchema = hasValidCredentialForm(authorizingConnector)
    ? authorizingConnector.credentialForm
    : undefined;

  const renderConnectorAction = (connector: Connector) => {
    if (catalogRefreshing) {
      return (
        <span aria-label={`${connector.name}状态刷新中`} className={styles.refreshingIcon} role="status">
          <LoadingOutlined />
        </span>
      );
    }
    if (connector.enableFlag === 'Y' || connector.enableFlag === 'N') {
      const switchLabel = connector.enableFlag === 'Y' ? `停用${connector.name}` : `启用${connector.name}`;
      return (
        <>
          <Dropdown
            menu={{
              items: [
                { key: 'reauthorize', icon: <ReloadOutlined />, label: '重新授权' },
                { key: 'revoke', danger: true, icon: <DisconnectOutlined />, label: '取消授权' },
              ],
              onClick: ({ key }) => {
                if (key === 'reauthorize') beginAuthorization(connector);
                if (key === 'revoke') confirmRevokeAuthorization(connector);
              },
            }}
            placement="bottomRight"
            trigger={['hover', 'click']}
          >
            <Button
              aria-label={`更多${connector.name}操作`}
              className={styles.moreActionButton}
              disabled={revokingConnectorIds.has(connector.id)}
              loading={revokingConnectorIds.has(connector.id)}
              icon={<EllipsisOutlined />}
              type="text"
            />
          </Dropdown>
          {(connector.enableFlag === 'Y' || connector.enableFlag === 'N') && (
            <Switch
              checked={connector.enableFlag === 'Y'}
              aria-label={switchLabel}
              disabled={revokingConnectorIds.has(connector.id)}
              loading={updatingConnectorIds.has(connector.id) || revokingConnectorIds.has(connector.id)}
              onChange={(checked) => void updateConnectorEnableFlag(connector, checked)}
              // size="small"
            />
          )}
        </>
      );
    }
    if (canAuthorize) {
      return (
        <Button
          type="text"
          onClick={() => beginAuthorization(connector)}
          style={{ color: 'var(--beyond-color-primary)' }}
        >
          连接
        </Button>
      );
    }
    return null;
  };

  const renderConnectorItem = (connector: Connector, compact = false) => {
    const usesLifecycleMetadata = Boolean(connector.credentialState);
    const displayExpiration = usesLifecycleMetadata ? connector.refreshExpiresAt : connector.credentialExpiresAt;
    const credentialExpiration = displayExpiration ? getCredentialExpirationDisplay(displayExpiration) : undefined;
    const lastVerifiedAt = connector.lastVerifiedAt
      ? getCredentialExpirationDisplay(connector.lastVerifiedAt)
      : undefined;
    let credentialLifecycleText: string | undefined;
    let credentialLifecycleExpired = false;

    if (connector.credentialState === 'REAUTH_REQUIRED') {
      credentialLifecycleText = '授权已失效，请重新连接';
      credentialLifecycleExpired = true;
    } else if (connector.credentialState === 'UNKNOWN') {
      credentialLifecycleText =
        connector.renewalMode === 'REFRESH_TOKEN' ? '自动续期，授权有效期同步中' : '授权状态待同步';
    } else if (connector.credentialState === 'REFRESH_NEEDED') {
      credentialLifecycleText = credentialExpiration
        ? `将在下次使用时自动续期，预计授权有效至 ${credentialExpiration.formattedTime}`
        : '将在下次使用时自动续期';
    } else if (usesLifecycleMetadata && credentialExpiration) {
      credentialLifecycleText =
        connector.credentialState === 'EXPIRING'
          ? `授权即将失效，预计有效至 ${credentialExpiration.formattedTime}`
          : `预计授权有效至 ${credentialExpiration.formattedTime}`;
    } else if (usesLifecycleMetadata && connector.renewalMode === 'REFRESH_TOKEN') {
      credentialLifecycleText = '自动续期';
    } else if (usesLifecycleMetadata && connector.renewalMode === 'PROBE_ONLY' && lastVerifiedAt) {
      credentialLifecycleText = `最近验证于 ${lastVerifiedAt.formattedTime}`;
    } else if (credentialExpiration) {
      credentialLifecycleText = credentialExpiration.expired
        ? `授权已于 ${credentialExpiration.formattedTime} 过期`
        : `授权有效期至 ${credentialExpiration.formattedTime}`;
      credentialLifecycleExpired = credentialExpiration.expired;
    }

    return (
      <div className={classNames(styles.connectorItem, { [styles.compactItem]: compact })} key={connector.id}>
        <ConnectorIcon connector={connector} />
        <div className={styles.connectorContent}>
          <strong>{connector.name}</strong>
          <span>{connector.description}</span>
          {credentialLifecycleText && (
            <span
              className={classNames(styles.credentialExpiration, {
                [styles.expired]: credentialLifecycleExpired,
              })}
            >
              {credentialLifecycleText}
            </span>
          )}
        </div>
        <div className={styles.connectorAction}>{renderConnectorAction(connector)}</div>
      </div>
    );
  };

  return (
    <>
      {/* 未开启时显示入口；全局开启的连接器直接回显图标并打开同一设置面板。 */}
      {enabledConnectors.length ? (
        <ConnectorSelection value={enabledConnectors} onOpen={openSettings} />
      ) : (
        <Tooltip title="连接器">
          <span aria-label="连接器设置" className={styles.trigger} role="button" onClick={openSettings}>
            <LinkOutlined />
          </span>
        </Tooltip>
      )}

      {/* 连接器设置：授权、停用连接器，并进入完整配置面板。 */}
      {/* Antd 的 styles 会以内联样式覆盖默认 contentPadding，确保标题条贴近外框。 */}
      <Modal
        centered
        className={styles.settingsModal}
        footer={null}
        open={settingsOpen}
        styles={{
          content: { padding: 10 },
          header: { marginBottom: 8, padding: 0 },
          body: { padding: 0 },
        }}
        title={
          <span className={styles.modalTitle}>
            <span className={styles.modalTitleIcon} aria-hidden="true">
              <DatabaseOutlined />
            </span>
            <span>连接器设置</span>
          </span>
        }
        onCancel={() => setSettingsOpen(false)}
      >
        <Spin spinning={loadingConnectors}>
          <div className={styles.connectorList}>
            {previewConnectors.length
              ? previewConnectors.map((connector) => renderConnectorItem(connector))
              : !loadingConnectors && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无连接器" />}
          </div>
        </Spin>
        {connectors.length > 0 && (
          <button
            className={styles.viewAllButton}
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setConfigurationOpen(true);
            }}
          >
            <SettingOutlined />
            查看全部连接器
          </button>
        )}
      </Modal>

      {/* 授权说明页与真实授权任务页分开，避免在前端伪造平台授权结果。 */}
      {/* 配置抽屉保持打开时，授权弹窗必须提升层级，否则会被 Drawer 遮盖。 */}
      <Modal
        centered
        className={styles.authorizationModal}
        footer={null}
        open={!!authorizingConnector && !authorizationSession && !credentialSchema}
        zIndex={1200}
        width={570}
        onCancel={() => void cancelAuthorization()}
      >
        {authorizingConnector && (
          <div className={styles.authorizationContent}>
            <div className={styles.authorizationIcons}>
              <span className={styles.productIcon}>AI</span>
              <span>›</span>
              <ConnectorIcon connector={authorizingConnector} />
            </div>
            <h2>连接 {authorizingConnector.name} 作为 AI 知识库</h2>
            <p>授权后，助手将能读取你有权限访问的内容，为你提供总结、智能问答和检索服务。</p>
            <div className={styles.permissionBlock}>
              <strong>即将获取以下权限</strong>
              <div>
                <GlobalOutlined />
                <span>
                  <b>读取知识库与内容</b>
                  <small>读取你有权限访问的内容</small>
                </span>
              </div>
              <div>
                <FileTextOutlined />
                <span>
                  <b>编辑与管理内容</b>
                  <small>用于整理、创建和管理授权范围内的内容</small>
                </span>
              </div>
            </div>
            <Button type="primary" block loading={startingAuthorization} size="large" onClick={startAuthorization}>
              立即前往授权
            </Button>
            <small className={styles.privacyTip}>
              <CheckCircleFilled /> 仅在执行 AI 任务时调用数据，严格保护隐私
            </small>
          </div>
        )}
      </Modal>

      <Modal
        centered
        className={classNames(styles.credentialModal, credentialSchema?.helpText && styles.credentialModalWithHelp)}
        closable={!startingAuthorization}
        footer={null}
        keyboard={!startingAuthorization}
        maskClosable={!startingAuthorization}
        open={!!authorizingConnector && !!credentialSchema && !authorizationSession}
        zIndex={1200}
        width={credentialSchema?.helpText ? '80vw' : 480}
        onCancel={() => {
          if (!startingAuthorization) {
            void cancelAuthorization();
          }
        }}
      >
        {authorizingConnector && credentialSchema && (
          <div
            className={classNames(
              styles.credentialContent,
              credentialSchema.helpText && styles.credentialContentWithHelp
            )}
          >
            <ConnectorIcon connector={authorizingConnector} />
            <h2>连接 {authorizingConnector.name}</h2>
            <p>请输入所需凭据。验证通过后将加密保存，仅在连接器启用时使用。</p>
            <Form<CredentialValues>
              autoComplete="off"
              className={styles.credentialForm}
              key={credentialFormVersion}
              layout="vertical"
              preserve={false}
              onFinish={(values) => void startCredentialAuthorization(values)}
            >
              <div className={styles.credentialFormBody}>
                {credentialSchema.helpText && <CredentialHelpCard helpText={credentialSchema.helpText} />}
                {isSafeCredentialHelpUrl(credentialSchema.helpUrl) && (
                  <a
                    className={styles.credentialHelpLink}
                    href={credentialSchema.helpUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {credentialSchema.helpLinkText?.trim() || `前往${authorizingConnector.name}获取凭据`}
                  </a>
                )}
                {credentialSchema.fields.map((field) => (
                  <Form.Item
                    key={field.key}
                    label={field.label}
                    name={field.key}
                    rules={[{ required: true, whitespace: true, message: `请输入${field.label}` }]}
                  >
                    {field.inputType === 'password' ? (
                      <Input.Password autoComplete="off" maxLength={field.maxLength} />
                    ) : (
                      <Input autoComplete="off" maxLength={field.maxLength} />
                    )}
                  </Form.Item>
                ))}
              </div>
              <div className={styles.credentialActions}>
                <Button block htmlType="submit" loading={startingAuthorization} size="large" type="primary">
                  保存并连接
                </Button>
              </div>
            </Form>
          </div>
        )}
      </Modal>

      {/* 仅展示后端返回的真实二维码或授权链接；不再提供前端模拟成功入口。 */}
      <Modal
        centered
        className={styles.qrModal}
        footer={null}
        open={!!authorizingConnector && !!authorizationSession}
        zIndex={1200}
        width={470}
        onCancel={() => void cancelAuthorization()}
      >
        {authorizingConnector && authorizationSession && (
          <div className={styles.qrContent}>
            <ConnectorIcon connector={authorizingConnector} />
            <h2>授权 {authorizingConnector.name}</h2>
            <p>
              {authorizationSession.phase === 'app_initialization'
                ? '请在飞书页面创建并初始化应用，完成后将继续账号授权。'
                : '完成平台授权后，本窗口会自动同步授权结果。'}
            </p>
            {authorizationSession.qrCodeUrl ? (
              <img
                alt={`${authorizingConnector.name}授权二维码`}
                className={styles.qrCodeImage}
                src={authorizationSession.qrCodeUrl}
              />
            ) : (
              <div className={styles.authorizationLinkTip}>
                <QrcodeOutlined />
                <span>请在新窗口完成授权</span>
              </div>
            )}
            {authorizationSession.authorizationUrl && (
              <Button
                href={authorizationSession.authorizationUrl}
                rel="noopener noreferrer"
                target="_blank"
                type="primary"
              >
                {authorizationSession.phase === 'user_authorization'
                  ? '继续授权'
                  : `打开 ${authorizingConnector.name} 授权页`}
              </Button>
            )}
            <Button block loading={checkingAuthorization} type="link" onClick={() => void checkAuthorizationStatus()}>
              我已完成授权，立即检查
            </Button>
            <Button type="link" onClick={() => void cancelAuthorization()}>
              取消连接
            </Button>
          </div>
        )}
      </Modal>

      {/* 完整配置面板统一管理系统连接器与当前用户自定义账号。 */}
      <Drawer
        className={styles.configurationDrawer}
        open={configurationOpen}
        title="连接器配置"
        extra={accountToolbar}
        width={Math.min(980, window.innerWidth - 24)}
        onClose={() => setConfigurationOpen(false)}
      >
        <Spin spinning={loadingConnectors}>
          <div className={styles.configurationGrid}>
            {connectors.length
              ? connectors.map((connector) => renderConnectorItem(connector, true))
              : !loadingConnectors && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无连接器" />}
            <GlobalAccountSection onToolbarChange={setAccountToolbar} />
          </div>
        </Spin>
      </Drawer>
    </>
  );
};

export default ConnectorControl;
