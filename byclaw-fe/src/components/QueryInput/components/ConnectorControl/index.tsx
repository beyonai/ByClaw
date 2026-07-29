import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircleFilled,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  QrcodeOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Modal, Switch, Tooltip, message } from 'antd';
import classNames from 'classnames';

import AntdIcon from '@/components/AntdIcon';

import styles from './index.module.less';

// 后端连接器授权接口接入完成后，将此开关设为 true；当前阶段保留完整 UI 但隐藏入口。
export const CONNECTOR_ENTRY_VISIBLE = false;

export type Connector = {
  id: string;
  name: string;
  description: string;
  authType: 'qrcode' | 'oauth';
  icon: React.ReactNode;
};

type ConnectorControlProps = {
  canAuthorize: boolean;
  value: Connector[];
  onChange: (connectors: Connector[]) => void;
};

// 产品当前只开放这三个企业协作平台，后续扩展时在此补充目录及官方 iconfont 图标。
const connectorCatalog: Connector[] = [
  {
    id: 'dingtalk',
    name: '钉钉',
    description: '获取会议纪要、日志、聊天记录等信息',
    authType: 'oauth',
    icon: <AntdIcon type="icon-dingding1" />,
  },
  {
    id: 'wecom',
    name: '企业微信',
    description: '获取消息、文档、日程和会议等内容',
    authType: 'oauth',
    icon: <AntdIcon type="icon-qiyeweixin" />,
  },
  {
    id: 'feishu',
    name: '飞书',
    description: '获取飞书消息、日历、云文档等信息',
    authType: 'oauth',
    icon: <AntdIcon type="icon-feishu" />,
  },
];

const connectorApi = {
  // 临时适配层：后端接口确认后只替换这里，设置面板和授权流程无需调整。
  list: async () => connectorCatalog,
  authorize: async (connectorId: string) => connectorCatalog.find((item) => item.id === connectorId),
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
  // 分别控制设置列表、完整配置、授权说明和二维码授权步骤的显示状态。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [authorizingConnector, setAuthorizingConnector] = useState<Connector>();
  const [showQrCode, setShowQrCode] = useState(false);
  const [connectors, setConnectors] = useState<Connector[]>([]);

  useEffect(() => {
    // 目录从适配层读取，后续接入后端时保持组件生命周期和交互不变。
    connectorApi.list().then(setConnectors);
  }, []);

  const selectedIds = useMemo(() => new Set(value.map((item) => item.id)), [value]);

  // 未登录或功能开关关闭时，不在聊天框显示连接器入口。
  if (!CONNECTOR_ENTRY_VISIBLE || !canAuthorize) return null;

  const setSelected = (connector: Connector, selected: boolean) => {
    // 通过受控回调把授权或停用结果交回聊天输入，保证发送 payload 使用最新选择。
    if (selected) {
      onChange([...value, connector]);
      return;
    }
    onChange(value.filter((item) => item.id !== connector.id));
  };

  const beginAuthorization = (connector: Connector) => {
    // 先展示权限说明，再进入对应平台的授权步骤。
    setAuthorizingConnector(connector);
    setShowQrCode(false);
  };

  const finishAuthorization = async () => {
    if (!authorizingConnector) return;

    // 当前用 mock 结果模拟授权成功，真实授权完成后由后端返回连接器信息。
    const authorizedConnector = await connectorApi.authorize(authorizingConnector.id);
    if (!authorizedConnector) return;

    setSelected(authorizedConnector, true);
    setShowQrCode(false);
    setAuthorizingConnector(undefined);
    message.success(`${authorizedConnector.name} 已连接`);
  };

  const renderConnectorItem = (connector: Connector, compact = false) => {
    const selected = selectedIds.has(connector.id);
    return (
      <div className={classNames(styles.connectorItem, { [styles.compactItem]: compact })} key={connector.id}>
        <ConnectorIcon connector={connector} />
        <div className={styles.connectorContent}>
          <strong>{connector.name}</strong>
          <span>{connector.description}</span>
        </div>
        {selected ? (
          <Switch
            checked
            aria-label={`停用${connector.name}`}
            onChange={(checked) => setSelected(connector, checked)}
            size="small"
          />
        ) : canAuthorize ? (
          <Button type="link" onClick={() => beginAuthorization(connector)}>
            连接
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {/* 未连接时显示入口；已有连接时直接回显图标并打开同一设置面板。 */}
      {value.length ? (
        <ConnectorSelection value={value} onOpen={() => setSettingsOpen(true)} />
      ) : (
        <Tooltip title="连接器">
          <button
            className={styles.trigger}
            type="button"
            aria-label="连接器设置"
            onClick={() => setSettingsOpen(true)}
          >
            <LinkOutlined />
          </button>
        </Tooltip>
      )}

      {/* 连接器设置：授权、停用连接器，并进入完整配置面板。 */}
      <Modal
        centered
        className={styles.settingsModal}
        footer={null}
        open={settingsOpen}
        title={
          <span className={styles.modalTitle}>
            <DatabaseOutlined />
            连接器设置
          </span>
        }
        onCancel={() => setSettingsOpen(false)}
      >
        <div className={styles.connectorList}>{connectors.map((connector) => renderConnectorItem(connector))}</div>
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

      {/* 授权说明页与二维码页分开，便于后端接入真实授权地址或二维码。 */}
      <Modal
        centered
        className={styles.authorizationModal}
        footer={null}
        open={!!authorizingConnector && !showQrCode}
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
            <Button type="primary" block size="large" onClick={() => setShowQrCode(true)}>
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
        className={styles.qrModal}
        footer={null}
        open={!!authorizingConnector && showQrCode}
        width={470}
        onCancel={() => {
          setShowQrCode(false);
          setAuthorizingConnector(undefined);
        }}
      >
        {authorizingConnector && (
          <div className={styles.qrContent}>
            <ConnectorIcon connector={authorizingConnector} />
            <h2>使用 {authorizingConnector.name} 扫码授权</h2>
            <p>请使用手机客户端扫描下方二维码完成绑定</p>
            <button aria-label="模拟扫码授权成功" className={styles.qrCode} type="button" onClick={finishAuthorization}>
              <QrcodeOutlined />
              <span>点击此处模拟扫码成功</span>
            </button>
            <Button type="link" onClick={() => setAuthorizingConnector(undefined)}>
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
        <div className={styles.configurationGrid}>
          {connectors.map((connector) => renderConnectorItem(connector, true))}
        </div>
      </Drawer>
    </>
  );
};

export default ConnectorControl;
