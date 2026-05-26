import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Empty, Input, Pagination, Spin, Table, Tag, Tooltip, message } from 'antd';
import dayjs from 'dayjs';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';

import fileBrowserIcon from '@/assets/filebrowser/file.png';
import SkillDetailDrawer from '@/pages/employees/components/SkillDetailDrawer/SkillDetailDrawer';
import {
  buildAutoDebugRequestText,
  buildDebugDefaults,
  normalizeModelType,
} from '@/pages/manager/pages/ModelMgr/components/modelFormUtils';
import { queryRelResourceInfo } from '@/pages/manager/service/DigitalEmployeeMgr';
import { debugModelStream, getModelDetail } from '@/pages/manager/service/ModelMgr';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { getMessages } from '@/service/message';
import { querySessionByAgent } from '@/service/session';
import useGlobal from '@/hooks/useGlobal';
import { getToken } from '@/utils/auth';
import { copyWithMessage } from '@/utils/copy';
import { fetchMessageHandler, getMessageText } from '@/utils/messgae';
import { sessionHandler } from '@/utils/session';

import styles from './index.module.less';

const FILE_BROWSER_PATH = '/filebrowser/files';
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_MODEL_DEBUG_INPUT = JSON.stringify(
  {
    url: 'https://api.example.com/v1/chat/completions',
    headers: {},
    model: '',
    messages: [
      {
        role: 'user',
        content: '今天天气如何',
      },
    ],
    temperature: 0.1,
    stream: true,
  },
  null,
  2
);

function unwrapData(res: any) {
  if (!res) return res;
  if (Object.prototype.hasOwnProperty.call(res, 'data')) return res.data;
  return res;
}

function safeJsonParse(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function formatDate(value: any) {
  if (!value) return '-';
  const date = dayjs(Number(value) ? Number(value) : value);
  return date.isValid() ? date.format('YYYY-MM-DD') : '-';
}

function buildModelDebugInput(modelDetail: any, modelInfo: any, debugDefaults: any) {
  const inparamTemplateStr =
    modelDetail?.inparamTemplate === null || modelDetail?.inparamTemplate === undefined
      ? ''
      : `${modelDetail.inparamTemplate}`;
  if (inparamTemplateStr.trim()) {
    return inparamTemplateStr;
  }

  const formValues = {
    modelCode: modelDetail?.modelCode || modelDetail?.modelNo || modelInfo?.modelCode || modelInfo?.model || '',
    model_no: modelDetail?.model_no || modelDetail?.modelNo,
    modelType: normalizeModelType(modelDetail?.modelType || modelDetail?.type || 'LLM'),
    apiEndpoint: modelDetail?.apiEndpoint || 'https://api.example.com/v1',
    apiToken: modelDetail?.apiToken || '',
    headers:
      Array.isArray(modelDetail?.headers) && modelDetail.headers.length
        ? modelDetail.headers
        : [{ key: '', value: '' }],
    temperature: modelDetail?.temperature ?? modelInfo?.temperature ?? 0.7,
    topP: modelDetail?.topP ?? 0.9,
    maxTokens: modelDetail?.maxTokens ?? 1024,
  };

  return buildAutoDebugRequestText({
    formValues,
    id: `${modelDetail?.id || modelInfo?.modelId || ''}`,
    prevText: '',
    ...debugDefaults,
  });
}

function buildFileBrowserUrl(resourceId: string, beyondToken: string, ownerType?: string, resourceCode?: string) {
  const encodedResourceId = encodeURIComponent(resourceId);
  const workspacePath = `${FILE_BROWSER_PATH}/.openclaw/workspace-baiying-agent-${encodedResourceId}/`;
  const url = new URL(workspacePath, window.location.origin);

  // The /filebrowser ingress reads either the Beyond-Token header or the beyondToken query.
  // iframe navigation cannot set custom headers, so the token must be passed by query.
  if (beyondToken) {
    url.searchParams.set('beyondToken', beyondToken);
  }
  if (resourceId) {
    url.searchParams.set('resourceId', resourceId);
  }
  if (ownerType) {
    url.searchParams.set('ownerType', ownerType);
  }
  if (resourceCode) {
    url.searchParams.set('resourceCode', resourceCode);
  }

  return url.toString();
}

export default function FileBrowserEntry() {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState('files');
  const [detailLoading, setDetailLoading] = useState(false);
  const [agentDetail, setAgentDetail] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionPagination, setSessionPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 });
  const [sessionLoading, setSessionLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [modelDetail, setModelDetail] = useState<any>(null);
  const [modelDetailLoading, setModelDetailLoading] = useState(false);
  const [modelTestInput, setModelTestInput] = useState(DEFAULT_MODEL_DEBUG_INPUT);
  const [modelTestOutput, setModelTestOutput] = useState('');
  const [modelTesting, setModelTesting] = useState(false);
  const [modelOutputLoading, setModelOutputLoading] = useState(false);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [relatedResources, setRelatedResources] = useState<any[]>([]);
  const [detailResourceId, setDetailResourceId] = useState<string>();
  const entryRef = useRef<HTMLSpanElement>(null);
  const modelDebugInputKeyRef = useRef('');
  const intl = useIntl();
  const { agentId } = useGlobal();
  const { defaultDigEmployeeId, userInfo, employeesList, agentList } = useSelector(({ employees, user }: any) => ({
    defaultDigEmployeeId: employees?.defaultDigEmployeeId,
    employeesList: employees?.employeesList || [],
    agentList: employees?.agentList || [],
    userInfo: user?.userInfo,
  }));

  const resourceId = useMemo(() => {
    return `${agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`;
  }, [agentId, defaultDigEmployeeId, userInfo?.defaultDigEmployeeId]);

  const cachedAgentInfo = useMemo(() => {
    const allAgents = [...(employeesList || []), ...(agentList || [])];
    return allAgents.find((item: any) => `${item?.agentId || item?.id || item?.resourceId || ''}` === resourceId);
  }, [agentList, employeesList, resourceId]);

  const ownerType = agentDetail?.ownerType || cachedAgentInfo?.ownerType || '';
  const resourceCode = agentDetail?.resourceCode || cachedAgentInfo?.resourceCode || '';
  const prologue = useMemo(() => safeJsonParse(agentDetail?.prologue), [agentDetail?.prologue]);
  const modelInfo = prologue?.modelInfo || {};
  const debugDefaults = useMemo(() => buildDebugDefaults(intl), [intl]);
  const relResourceList = agentDetail?.relResourceList || relatedResources || [];
  const assistantName = agentDetail?.resourceName || cachedAgentInfo?.name || cachedAgentInfo?.resourceName || 'AI';

  const iframeUrl = useMemo(() => {
    return buildFileBrowserUrl(resourceId, getToken(), ownerType, resourceCode);
  }, [ownerType, resourceCode, resourceId]);

  const loadAgentDetail = useCallback(async () => {
    if (!resourceId) return;
    setDetailLoading(true);
    try {
      const res = await getCompositeAppInfo({ resourceId });
      setAgentDetail(unwrapData(res));
    } catch (error: any) {
      message.error(error?.message || '加载资源信息失败');
    } finally {
      setDetailLoading(false);
    }
  }, [resourceId]);

  const loadMessages = useCallback(async (session: any) => {
    const sessionId = session?.sessionId;
    if (!sessionId) {
      setMessages([]);
      return;
    }
    setMessageLoading(true);
    try {
      const res = await getMessages({ sessionId: `${sessionId}`, pageNum: 1, pageSize: 50 });
      const list = (unwrapData(res)?.list || res?.list || []).map((item: any) => fetchMessageHandler(item));
      setMessages(list);
    } catch (error: any) {
      message.error(error?.message || '加载会话消息失败');
      setMessages([]);
    } finally {
      setMessageLoading(false);
    }
  }, []);

  const loadSessions = useCallback(
    async (pageNum = 1) => {
      if (!resourceId) return;
      setSessionLoading(true);
      try {
        const res = await querySessionByAgent({
          pageNum,
          pageSize: sessionPagination.pageSize,
          keyword: '',
          objectId: resourceId,
        });
        const data = unwrapData(res) || {};
        const list = (data.list || []).map((item: any) => sessionHandler(item));
        setSessions(list);
        setSessionPagination({
          current: Number(data.pageNum || pageNum),
          pageSize: Number(data.pageSize || sessionPagination.pageSize),
          total: Number(data.total || 0),
        });
        const nextSelected = list[0] || null;
        setSelectedSession(nextSelected);
        loadMessages(nextSelected);
      } catch (error: any) {
        message.error(error?.message || '加载会话列表失败');
      } finally {
        setSessionLoading(false);
      }
    },
    [loadMessages, resourceId, sessionPagination.pageSize]
  );

  const loadModelDetail = useCallback(async () => {
    const modelId = modelInfo?.modelId;
    if (!modelId || modelDetailLoading || modelDetail) return;
    setModelDetailLoading(true);
    try {
      const res = await getModelDetail({ id: `${modelId}` });
      setModelDetail(unwrapData(res));
    } catch (error) {
      setModelDetail(null);
    } finally {
      setModelDetailLoading(false);
    }
  }, [modelDetail, modelDetailLoading, modelInfo?.modelId]);

  const loadRelatedResources = useCallback(async () => {
    if (!resourceId || relResourceList?.length) return;
    setResourceLoading(true);
    try {
      const res = await queryRelResourceInfo({ resourceId });
      setRelatedResources(unwrapData(res) || []);
    } catch (error: any) {
      message.error(error?.message || '加载关联资源失败');
    } finally {
      setResourceLoading(false);
    }
  }, [relResourceList?.length, resourceId]);

  const resolvePortalContainer = useCallback(() => {
    if (typeof document === 'undefined') return null;
    return (
      (entryRef.current?.closest('#chat_wrapper, #employees_wrapper, #employees_wrapper2') as HTMLElement | null) ||
      document.getElementById('chat_wrapper') ||
      document.getElementById('employees_wrapper') ||
      document.getElementById('employees_wrapper2') ||
      document.body
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    loadAgentDetail();
  }, [loadAgentDetail, open]);

  useEffect(() => {
    setAgentDetail(null);
    setSessions([]);
    setSelectedSession(null);
    setMessages([]);
    setModelDetail(null);
    setModelTestInput(DEFAULT_MODEL_DEBUG_INPUT);
    setModelTestOutput('');
    setModelOutputLoading(false);
    setRelatedResources([]);
    setDetailResourceId(undefined);
    modelDebugInputKeyRef.current = '';
  }, [resourceId]);

  useEffect(() => {
    if (!open || activeTab !== 'logs' || sessions.length) return;
    loadSessions(1);
  }, [activeTab, loadSessions, open, sessions.length]);

  useEffect(() => {
    if (!open || activeTab !== 'model') return;
    loadModelDetail();
  }, [activeTab, loadModelDetail, open]);

  useEffect(() => {
    if (!open || activeTab !== 'model' || !modelInfo?.modelId) return;
    if (!modelDetail && modelDetailLoading) return;
    const nextKey = `${resourceId}-${modelInfo?.modelId || ''}-${modelDetail?.id || ''}-${
      modelDetail?.updateTime || ''
    }`;
    if (modelDebugInputKeyRef.current === nextKey) return;
    modelDebugInputKeyRef.current = nextKey;
    setModelTestInput(buildModelDebugInput(modelDetail, modelInfo, debugDefaults));
  }, [activeTab, debugDefaults, modelDetail, modelDetailLoading, modelInfo, open, resourceId]);

  useEffect(() => {
    if (!open || activeTab !== 'resources') return;
    loadRelatedResources();
  }, [activeTab, loadRelatedResources, open]);

  const openFileBrowser = () => {
    if (!resourceId) {
      message.warning('Missing resourceId');
      return;
    }
    setPortalContainer(resolvePortalContainer());
    setActiveTab('files');
    setOpen(true);
  };

  const runModelTest = async () => {
    const modelId = modelInfo?.modelId;
    if (!modelId) {
      message.warning('当前资源未配置大模型');
      return;
    }
    if (!modelTestInput.trim()) {
      message.warning('请输入测试内容');
      return;
    }
    setModelTesting(true);
    setModelOutputLoading(true);
    setModelTestOutput('');
    try {
      let streamedText = '';
      const res = await debugModelStream({
        id: `${modelId}`,
        input: modelTestInput,
        onDelta: (delta: string) => {
          streamedText += delta || '';
          setModelOutputLoading(false);
          setModelTestOutput(streamedText);
        },
      });
      const output = unwrapData(res)?.output || res?.output || streamedText || JSON.stringify(unwrapData(res) || res);
      setModelTestOutput(output);
    } catch (error: any) {
      setModelTestOutput(error?.message || '模型测试失败');
      message.error(error?.message || '模型测试失败');
    } finally {
      setModelTesting(false);
      setModelOutputLoading(false);
    }
  };

  const copyText = async (text: string) => {
    if (!text) {
      message.warning('暂无可复制内容');
      return;
    }
    await copyWithMessage(text);
  };

  const handleOpenKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFileBrowser();
  };

  const container = portalContainer || resolvePortalContainer();
  const fileManagementTip = intl.formatMessage({ id: 'queryInput.tooltip.fileManagement' });
  const resourceColumns = [
    {
      title: '资源名称',
      dataIndex: 'resourceName',
      key: 'resourceName',
      render: (text: string, record: any) => {
        const currentResourceId = record?.resourceId || record?.relResourceId;
        return (
          <Button
            type="link"
            className={styles.resourceNameBtn}
            disabled={!currentResourceId}
            onClick={() => setDetailResourceId(`${currentResourceId || ''}`)}
          >
            {text || '-'}
          </Button>
        );
      },
    },
    { title: '资源编码', dataIndex: 'resourceCode', key: 'resourceCode' },
    { title: '资源类型', dataIndex: 'resourceBizType', key: 'resourceBizType' },
    {
      title: '资源来源',
      dataIndex: 'systemCode',
      key: 'systemCode',
      render: (text: string, record: any) =>
        record?.resourceSource || record?.sourceSystemName || record?.sourceSystem || text || '-',
    },
    {
      title: '资源更新时间',
      dataIndex: 'updateTime',
      key: 'updateTime',
      render: (text: string, record: any) => formatDate(text || record?.modifyTime || record?.gmtModified),
    },
  ];

  const tabItems = [
    {
      key: 'files',
      label: '文件管理',
      children: (
        <div className={styles.filePane}>
          <iframe className={styles.fileBrowserFrame} title="filebrowser" src={iframeUrl} />
        </div>
      ),
    },
    {
      key: 'logs',
      label: '会话日志',
      children: (
        <div className={styles.logsPane}>
          <div className={styles.sessionPanel}>
            <Spin spinning={sessionLoading}>
              {sessions.length ? (
                sessions.map((item) => (
                  <button
                    className={`${styles.sessionCard} ${
                      `${selectedSession?.sessionId}` === `${item.sessionId}` ? styles.sessionCardActive : ''
                    }`}
                    key={item.sessionId}
                    onClick={() => {
                      setSelectedSession(item);
                      loadMessages(item);
                    }}
                    type="button"
                  >
                    <span className={styles.sessionName}>{item.sessionName || '未命名会话'}</span>
                    <span className={styles.sessionTime}>{item.updateTime || item.createTime || '-'}</span>
                  </button>
                ))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话记录" />
              )}
            </Spin>
            <Pagination
              simple
              current={sessionPagination.current}
              pageSize={sessionPagination.pageSize}
              total={sessionPagination.total}
              onChange={(page) => loadSessions(page)}
            />
          </div>
          <div className={styles.messagePanel}>
            <Spin spinning={messageLoading}>
              {messages.length ? (
                messages.map((item) => {
                  const text = getMessageText(item) || '[非文本消息]';
                  return (
                    <div
                      className={`${styles.messageBubbleRow} ${
                        item.fromBeyond ? styles.messageBubbleAssistant : styles.messageBubbleUser
                      }`}
                      key={item.msgId || item.messageId}
                    >
                      <div className={styles.messageBubble}>
                        <div className={styles.messageMeta}>
                          {item.fromBeyond ? assistantName : item.creatorName || '我'}
                        </div>
                        <div className={styles.messageText}>{text}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧会话" />
              )}
            </Spin>
          </div>
        </div>
      ),
    },
    {
      key: 'model',
      label: '当前模型',
      children: (
        <div className={styles.modelScrollPane}>
          <Spin spinning={modelDetailLoading || detailLoading}>
            <div className={styles.modelPane}>
              <Card className={styles.modelInfoCard}>
                <div className={styles.modelHeader}>
                  <div>
                    <div className={styles.modelName}>{modelInfo?.model || modelDetail?.modelName || '未配置模型'}</div>
                    <div className={styles.modelSubTitle}>Model ID: {modelInfo?.modelId || '-'}</div>
                  </div>
                  <Tag color={modelInfo?.modelId ? 'green' : 'default'}>{modelInfo?.modelId ? '已配置' : '未配置'}</Tag>
                </div>
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="模型编码">
                    {modelDetail?.modelCode || modelInfo?.model || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="模型类型">
                    {modelDetail?.modelType || modelDetail?.type || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="温度">{modelInfo?.temperature ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="上下文轮数">{modelInfo?.history ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="最大 Token">
                    {modelInfo?.maxToken ?? modelDetail?.maxContentToken ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="更新时间">{modelDetail?.updateTime || '-'}</Descriptions.Item>
                </Descriptions>
              </Card>
              <Card className={styles.modelChatCard}>
                <div className={styles.debugHero}>
                  <div className={styles.sectionTitle}>
                    <span className={styles.sectionBar} />
                    模型调试
                  </div>
                  <div className={styles.sectionDesc}>输入测试内容，直接调用当前资源配置的大模型并查看返回结果。</div>
                  <div className={styles.debugModeBadge}>当前模型</div>
                </div>
                <div className={styles.debugTips}>
                  <div className={styles.debugTip}>调试请求使用当前数字员工配置的模型 ID，不会修改模型配置。</div>
                  <div className={styles.debugTip}>输出支持流式展示；若请求失败，会在输出区展示失败原因。</div>
                </div>
                <div className={styles.debugPanelStack}>
                  <div className={styles.codePanel}>
                    <div className={styles.codePanelHeader}>
                      <span>输入</span>
                      <div className={styles.codePanelActions}>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(modelTestInput)}>
                          复制
                        </Button>
                        <Button
                          type="primary"
                          size="small"
                          loading={modelTesting}
                          disabled={modelTesting}
                          onClick={runModelTest}
                        >
                          运行
                        </Button>
                      </div>
                    </div>
                    <div className={styles.codeArea}>
                      <Input.TextArea
                        value={modelTestInput}
                        onChange={(event) => setModelTestInput(event.target.value)}
                        autoSize={{ minRows: 8, maxRows: 8 }}
                        placeholder="请输入发送给当前模型的测试消息"
                      />
                    </div>
                  </div>
                  <div className={styles.codePanel}>
                    <div className={styles.codePanelHeader}>
                      <span>输出</span>
                      <div className={styles.codePanelActions}>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(modelTestOutput)}>
                          复制
                        </Button>
                        <Button size="small" icon={<DeleteOutlined />} onClick={() => setModelTestOutput('')}>
                          清空
                        </Button>
                      </div>
                    </div>
                    <div className={styles.codeArea} style={{ position: 'relative' }}>
                      {modelOutputLoading ? (
                        <div className={styles.outputLoading}>
                          <Spin tip="请求中..." />
                        </div>
                      ) : null}
                      <Input.TextArea
                        value={modelTestOutput}
                        onChange={(event) => setModelTestOutput(event.target.value)}
                        autoSize={{ minRows: 8, maxRows: 8 }}
                        placeholder="运行后，当前模型的回复会显示在这里"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </Spin>
        </div>
      ),
    },
    {
      key: 'resources',
      label: '关联资源',
      children: (
        <div className={styles.resourcePane}>
          <Table
            className={styles.resourceTable}
            columns={resourceColumns}
            dataSource={relResourceList}
            loading={resourceLoading || detailLoading}
            pagination={{ pageSize: 10 }}
            rowKey={(record: any) => `${record?.resourceId || record?.relResourceId || record?.resourceCode}`}
          />
        </div>
      ),
    },
  ];
  const activeTabContent = tabItems.find((item) => item.key === activeTab)?.children;

  return (
    <>
      <Tooltip title={fileManagementTip}>
        <span
          aria-label={fileManagementTip}
          className={styles.fileBrowserEntry}
          onClick={openFileBrowser}
          onKeyDown={handleOpenKeyDown}
          ref={entryRef}
          role="button"
          tabIndex={0}
        >
          <img className={styles.fileBrowserIcon} src={fileBrowserIcon} alt="file browser" />
        </span>
      </Tooltip>
      {open &&
        container &&
        createPortal(
          <div className={styles.fileBrowserOverlay}>
            <button className={styles.closeBtn} type="button" aria-label="close" onClick={() => setOpen(false)}>
              x
            </button>
            <div className={styles.workspaceShell}>
              <div className={styles.workspaceTabBar}>
                {tabItems.map((item) => (
                  <button
                    className={`${styles.workspaceTab} ${activeTab === item.key ? styles.workspaceTabActive : ''}`}
                    key={item.key}
                    type="button"
                    onClick={() => setActiveTab(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className={styles.workspaceContent}>{activeTabContent}</div>
            </div>
            <SkillDetailDrawer
              open={!!detailResourceId}
              resourceId={detailResourceId}
              onClose={() => setDetailResourceId(undefined)}
            />
          </div>,
          container
        )}
    </>
  );
}
