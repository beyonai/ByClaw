import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  CheckCircleFilled,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  LoadingOutlined,
  QrcodeOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Empty, Modal, Spin, Switch, Tooltip, message } from 'antd';
import classNames from 'classnames';

import AntdIcon from '@/components/AntdIcon';
import {
  getConnectorAuthorization,
  cancelConnectorAuthorization,
  queryConnectorList,
  startConnectorAuthorization,
  updateConnectorEnable,
  type ConnectorAuthorization,
  type ConnectorEnableFlag,
  type ConnectorId,
  type ConnectorListItem,
} from '@/service/connector';

import styles from './index.module.less';

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
};

type ConnectorControlProps = {
  canAuthorize: boolean;
  value: Connector[];
  onChange: (connectors: Connector[]) => void;
};

// 已有官方图标的连接器按接口编码匹配，其余平台使用统一图标，列表内容完全以后端返回为准。
const connectorIconMap: Record<string, React.ReactNode> = {
  dingtalk: <AntdIcon type="icon-dingding1" />,
  wecom: <AntdIcon type="icon-qiyeweixin" />,
  lark: <AntdIcon type="icon-feishu" />,
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
});

const ConnectorIcon = ({ connector }: { connector: Connector }) => (
  <span className={styles.connectorIcon}>{connector.icon}</span>
);

const ConnectorSelection = ({ value, onOpen }: { value: Connector[]; onOpen: () => void }) => {
  if (!value.length) return null;

  // 工具栏空间有限，最多回显三个官方图标，其余连接器用数量汇总。
  const displayedConnectors = value.slice(0, 3);
  const remainingCount = value.length - displayedConnectors.length;

  return (
    <span className={styles.selection} aria-label="已连接连接器">
      {displayedConnectors.map((connector) => (
        <Tooltip key={connector.id} title={connector.name}>
          <button
            aria-label={`查看${connector.name}连接器`}
            className={styles.selectionItem}
            type="button"
            onClick={onOpen}
          >
            <ConnectorIcon connector={connector} />
          </button>
        </Tooltip>
      ))}
      {remainingCount > 0 && (
        <button aria-label="查看全部已连接连接器" className={styles.moreSelection} type="button" onClick={onOpen}>
          +{remainingCount}
        </button>
      )}
    </span>
  );
};

const ConnectorControl = ({ canAuthorize, value, onChange }: ConnectorControlProps) => {
  // 分别控制设置列表、完整配置、授权说明和真实授权进度的显示状态。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [authorizingConnector, setAuthorizingConnector] = useState<Connector>();
  // 一次性授权任务由后端创建，包含真实二维码或第三方授权链接。
  const [authorizationSession, setAuthorizationSession] = useState<ConnectorAuthorization>();
  // 历史已授权与本轮消息选择分离，避免用户每次发消息都被强制附带所有连接器。
  const [authorizedIds, setAuthorizedIds] = useState<Set<ConnectorId>>(new Set());
  // 列表完全由后端返回，避免请求完成前短暂展示静态假数据。
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loadingConnectors, setLoadingConnectors] = useState(false);
  const [updatingConnectorIds, setUpdatingConnectorIds] = useState<Set<ConnectorId>>(new Set());
  const [startingAuthorization, setStartingAuthorization] = useState(false);
  const [checkingAuthorization, setCheckingAuthorization] = useState(false);

  // value 仅表示本轮聊天实际携带到 payload 的连接器，不等同于账号已完成授权。
  const selectedIds = useMemo(() => new Set(value.map((item) => item.id)), [value]);
  const previewConnectors = useMemo(() => connectors.slice(0, 3), [connectors]);

  const setSelected = useCallback(
    (connector: Connector, selected: boolean) => {
      // 通过受控回调把授权或停用结果交回聊天输入，保证发送 payload 使用最新选择。
      if (selected) {
        if (!selectedIds.has(connector.id)) onChange([...value, connector]);
        return;
      }
      onChange(value.filter((item) => item.id !== connector.id));
    },
    [onChange, selectedIds, value]
  );

  const completeAuthorization = useCallback(
    (authorization: ConnectorAuthorization) => {
      const connector = connectors.find((item) => item.id === authorization.connectorId);
      if (!connector) return;

      // 仅在后端确认 connected 后回显连接器并允许消息携带该连接器 ID。
      setAuthorizedIds((ids) => new Set([...ids, connector.id]));
      setSelected(connector, true);
      setAuthorizationSession(undefined);
      setAuthorizingConnector(undefined);
      message.success(`${connector.name} 已连接`);
    },
    [connectors, setSelected]
  );

  const checkAuthorizationStatus = useCallback(
    async (silently = false) => {
      if (!authorizationSession) return;

      setCheckingAuthorization(true);
      try {
        const authorization = await getConnectorAuthorization(authorizationSession.authorizationId);
        if (authorization.status === 'connected') {
          // 只有查询到最终成功状态，才允许把连接器加入本轮聊天选择。
          completeAuthorization(authorization);
          return;
        }
        if (authorization.status === 'failed' || authorization.status === 'expired') {
          setAuthorizationSession(undefined);
          setAuthorizingConnector(undefined);
          message.error(authorization.errorMessage || '授权未完成，请重新发起连接');
          return;
        }
        if (!silently) message.info('尚未检测到授权完成，请完成授权后重试');
      } catch {
        if (!silently) message.error('授权状态查询失败，请稍后重试');
      } finally {
        setCheckingAuthorization(false);
      }
    },
    [authorizationSession, completeAuthorization]
  );

  useEffect(() => {
    if (!authorizationSession || authorizationSession.status !== 'pending') return undefined;

    // 后端负责处理三方回调，前端只轮询本次授权任务的状态。
    const timer = window.setInterval(() => void checkAuthorizationStatus(true), 3000);
    return () => window.clearInterval(timer);
  }, [authorizationSession, checkAuthorizationStatus]);

  const loadAuthorizedConnectors = useCallback(async () => {
    const hasCachedConnectors = connectors.length > 0;
    if (hasCachedConnectors) {
      setCatalogRefreshing(true);
    } else {
      setLoadingConnectors(true);
    }
    try {
      // 文档要求分页请求，这里一次取足当前全部连接器，并原样转换为页面数据。
      const response = await queryConnectorList({ pageNum: 1, pageSize: 100, keyword: '' });
      const list = response.list || [];
      const connectorList = list.map(mapConnectorListItem);
      setConnectors(connectorList);

      // enableFlag 非空表示已经绑定，Y 表示默认启用；N 仍可通过“使用”加入本轮消息。
      const connectedIds = list
        .filter((item) => item.enableFlag === 'Y' || item.enableFlag === 'N')
        .map((item) => item.connectorId);
      setAuthorizedIds(new Set(connectedIds));

      // 将后端标记为 Y 的连接器同步到聊天输入，保证设置面板与聊天框回显一致。
      onChange(
        connectorList.filter((connector) =>
          list.some((item) => item.enableFlag === 'Y' && item.connectorId === connector.id)
        )
      );
    } catch {
      if (!hasCachedConnectors) {
        message.error('连接器列表加载失败，请稍后重试');
      }
    } finally {
      if (hasCachedConnectors) {
        setCatalogRefreshing(false);
      } else {
        setLoadingConnectors(false);
      }
    }
  }, [connectors.length, onChange]);

  const openSettings = () => {
    setSettingsOpen(true);
    void loadAuthorizedConnectors();
  };

  const beginAuthorization = (connector: Connector) => {
    // 先展示权限说明，再进入对应平台的授权步骤。
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
      if (enabled) {
        if (!selectedIds.has(connector.id)) onChange([...value, connector]);
      } else {
        onChange(value.filter((item) => item.id !== connector.id));
      }
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

    setStartingAuthorization(true);
    try {
      // 三方密钥、回调 code 换 token 均由后端处理，前端只使用一次性授权任务信息。
      const authorization = await startConnectorAuthorization({
        connectorId: authorizingConnector.id,
        redirectUrl: `${window.location.origin}${window.location.pathname}`,
      });
      if (authorization.status === 'connected') {
        completeAuthorization(authorization);
        return;
      }
      if (authorization.status === 'failed' || authorization.status === 'expired') {
        throw new Error(authorization.errorMessage || '授权任务已失效，请重新发起连接');
      }
      if (!authorization.authorizationUrl && !authorization.qrCodeUrl) {
        throw new Error('授权服务未返回授权链接或二维码');
      }
      setAuthorizationSession(authorization);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发起授权失败，请稍后重试');
    } finally {
      setStartingAuthorization(false);
    }
  };

  const cancelAuthorization = async () => {
    if (authorizationSession) {
      try {
        await cancelConnectorAuthorization(authorizationSession.authorizationId);
      } catch {
        message.error('后台授权取消失败，请稍后重试');
      }
    }
    setAuthorizationSession(undefined);
    setAuthorizingConnector(undefined);
  };

  // 未登录或功能开关关闭时，不在聊天框显示连接器入口。
  if (!CONNECTOR_ENTRY_VISIBLE || !canAuthorize) return null;

  const renderConnectorAction = (connector: Connector) => {
    if (catalogRefreshing) {
      return (
        <span aria-label={`${connector.name}状态刷新中`} className={styles.refreshingIcon} role="status">
          <LoadingOutlined />
        </span>
      );
    }
    if (connector.enableFlag === 'Y' || authorizedIds.has(connector.id)) {
      let switchLabel = `使用${connector.name}`;
      if (connector.enableFlag === 'Y') {
        switchLabel = `停用${connector.name}`;
      }
      return (
        <Switch
          checked={connector.enableFlag === 'Y'}
          aria-label={switchLabel}
          loading={updatingConnectorIds.has(connector.id)}
          onChange={(checked) => void updateConnectorEnableFlag(connector, checked)}
          // size="small"
        />
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
    return (
      <div className={classNames(styles.connectorItem, { [styles.compactItem]: compact })} key={connector.id}>
        <ConnectorIcon connector={connector} />
        <div className={styles.connectorContent}>
          <strong>{connector.name}</strong>
          <span>{connector.description}</span>
        </div>
        <div className={styles.connectorAction}>{renderConnectorAction(connector)}</div>
      </div>
    );
  };

  return (
    <>
      {/* 未连接时显示入口；已有连接时直接回显图标并打开同一设置面板。 */}
      {value.length ? (
        <ConnectorSelection value={value} onOpen={openSettings} />
      ) : (
        <Tooltip title="连接器">
          <button className={styles.trigger} type="button" aria-label="连接器设置" onClick={openSettings}>
            <LinkOutlined />
          </button>
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
      </Modal>

      {/* 授权说明页与真实授权任务页分开，避免在前端伪造平台授权结果。 */}
      {/* 配置抽屉保持打开时，授权弹窗必须提升层级，否则会被 Drawer 遮盖。 */}
      <Modal
        centered
        className={styles.authorizationModal}
        footer={null}
        open={!!authorizingConnector && !authorizationSession}
        zIndex={1200}
        width={570}
        onCancel={() => setAuthorizingConnector(undefined)}
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
            <p>完成平台授权后，本窗口会自动同步授权结果。</p>
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
                打开 {authorizingConnector.name} 授权页
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

      {/* 完整配置面板预留给后续连接器管理能力。 */}
      <Drawer
        className={styles.configurationDrawer}
        open={configurationOpen}
        title="连接器配置"
        width={Math.min(980, window.innerWidth - 24)}
        onClose={() => setConfigurationOpen(false)}
      >
        <Spin spinning={loadingConnectors}>
          <div className={styles.configurationGrid}>
            {connectors.length
              ? connectors.map((connector) => renderConnectorItem(connector, true))
              : !loadingConnectors && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无连接器" />}
          </div>
        </Spin>
      </Drawer>
    </>
  );
};

export default ConnectorControl;
