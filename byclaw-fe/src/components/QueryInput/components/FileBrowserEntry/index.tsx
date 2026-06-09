import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Descriptions, Spin, Table, Tag, Tooltip, message } from 'antd';
import dayjs from 'dayjs';
// @ts-ignore
import { useIntl, useLocation, useSelector } from '@umijs/max';

import fileBrowserIcon from '@/assets/filebrowser/file.png';
import SkillDetailDrawer from '@/pages/employees/components/SkillDetailDrawer/SkillDetailDrawer';
import FileBrowserPanel from './components/FileBrowserPanel';
import { queryRelResourceInfo } from '@/pages/manager/service/DigitalEmployeeMgr';
import { getModelDetail } from '@/pages/manager/service/ModelMgr';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import useGlobal from '@/hooks/useGlobal';
import { getToken } from '@/utils/auth';

import styles from './index.module.less';

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

export default function FileBrowserEntry() {
  const intl = useIntl();
  const t = useCallback((id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values), [intl]);
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState('files');
  const [detailLoading, setDetailLoading] = useState(false);
  const [agentDetail, setAgentDetail] = useState<any>(null);
  const [modelDetail, setModelDetail] = useState<any>(null);
  const [modelDetailLoading, setModelDetailLoading] = useState(false);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [relatedResources, setRelatedResources] = useState<any[]>([]);
  const [detailResourceId, setDetailResourceId] = useState<string>();
  const entryRef = useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();
  const { agentId } = useGlobal();
  const { defaultDigEmployeeId, userInfo } = useSelector(({ employees, user }: any) => ({
    defaultDigEmployeeId: employees?.defaultDigEmployeeId,
    userInfo: user?.userInfo,
  }));

  const resourceId = useMemo(() => {
    return `${agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`;
  }, [agentId, defaultDigEmployeeId, userInfo?.defaultDigEmployeeId]);

  const prologue = useMemo(() => safeJsonParse(agentDetail?.prologue), [agentDetail?.prologue]);
  const modelInfo = prologue?.modelInfo || {};
  const relResourceList = agentDetail?.relResourceList || relatedResources || [];
  const beyondToken = getToken();

  const loadAgentDetail = useCallback(async () => {
    if (!resourceId) return;
    setDetailLoading(true);
    try {
      const res = await getCompositeAppInfo({ resourceId });
      setAgentDetail(unwrapData(res));
    } catch (error: any) {
      message.error(error?.message || t('fileBrowserEntry.error.loadResourceInfoFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, [resourceId, t]);

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
      message.error(error?.message || t('fileBrowserEntry.error.loadRelatedResourcesFailed'));
    } finally {
      setResourceLoading(false);
    }
  }, [relResourceList?.length, resourceId, t]);

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
    setModelDetail(null);
    setRelatedResources([]);
    setDetailResourceId(undefined);
  }, [resourceId]);

  useEffect(() => {
    if (!open || activeTab !== 'model') return;
    loadModelDetail();
  }, [activeTab, loadModelDetail, open]);

  useEffect(() => {
    if (!open || activeTab !== 'resources') return;
    loadRelatedResources();
  }, [activeTab, loadRelatedResources, open]);

  const openFileBrowser = () => {
    if (!resourceId) {
      message.warning(t('fileBrowserEntry.warning.missingResourceId'));
      return;
    }
    setPortalContainer(resolvePortalContainer());
    setActiveTab('files');
    setOpen(true);
  };

  const handleOpenKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFileBrowser();
  };

  const container = portalContainer || resolvePortalContainer();
  const fileManagementTip = t('queryInput.tooltip.fileManagement');
  const isMobileRoute = pathname === '/mobile' || pathname.startsWith('/mobile/');

  if (isMobileRoute || !beyondToken) {
    return null;
  }

  const resourceColumns = [
    {
      title: t('fileBrowserEntry.resource.name'),
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
    { title: t('fileBrowserEntry.resource.code'), dataIndex: 'resourceCode', key: 'resourceCode' },
    { title: t('fileBrowserEntry.resource.type'), dataIndex: 'resourceBizType', key: 'resourceBizType' },
    {
      title: t('fileBrowserEntry.resource.source'),
      dataIndex: 'systemCode',
      key: 'systemCode',
      render: (text: string, record: any) =>
        record?.resourceSource || record?.sourceSystemName || record?.sourceSystem || text || '-',
    },
    {
      title: t('fileBrowserEntry.resource.updateTime'),
      dataIndex: 'updateTime',
      key: 'updateTime',
      render: (text: string, record: any) => formatDate(text || record?.modifyTime || record?.gmtModified),
    },
  ];

  const tabItems = [
    {
      key: 'files',
      label: t('fileBrowserEntry.tab.files'),
      children: (
        <div className={styles.filePane}>
          <FileBrowserPanel resourceId={resourceId} />
        </div>
      ),
    },
    {
      key: 'model',
      label: t('fileBrowserEntry.tab.model'),
      children: (
        <div className={styles.modelScrollPane}>
          <Spin spinning={modelDetailLoading || detailLoading}>
            <div className={styles.modelPane}>
              <Card className={styles.modelInfoCard}>
                <div className={styles.modelHeader}>
                  <div>
                    <div className={styles.modelName}>
                      {modelInfo?.model || modelDetail?.modelName || t('fileBrowserEntry.model.notConfigured')}
                    </div>
                    <div className={styles.modelSubTitle}>
                      {t('fileBrowserEntry.model.id')}: {modelInfo?.modelId || '-'}
                    </div>
                  </div>
                  <Tag color={modelInfo?.modelId ? 'green' : 'default'}>
                    {modelInfo?.modelId
                      ? t('fileBrowserEntry.model.configured')
                      : t('fileBrowserEntry.model.notConfiguredShort')}
                  </Tag>
                </div>
                <Descriptions column={2} size="small">
                  <Descriptions.Item label={t('fileBrowserEntry.model.code')}>
                    {modelDetail?.modelCode || modelInfo?.model || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('fileBrowserEntry.model.type')}>
                    {modelDetail?.modelType || modelDetail?.type || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('fileBrowserEntry.model.temperature')}>
                    {modelInfo?.temperature ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('fileBrowserEntry.model.history')}>
                    {modelInfo?.history ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('fileBrowserEntry.model.maxToken')}>
                    {modelInfo?.maxToken ?? modelDetail?.maxContentToken ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('fileBrowserEntry.model.updateTime')}>
                    {modelDetail?.updateTime || '-'}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </div>
          </Spin>
        </div>
      ),
    },
    {
      key: 'resources',
      label: t('fileBrowserEntry.tab.resources'),
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
          <img className={styles.fileBrowserIcon} src={fileBrowserIcon} alt={fileManagementTip} />
        </span>
      </Tooltip>
      {open &&
        container &&
        createPortal(
          <div className={styles.fileBrowserOverlay}>
            <button
              className={styles.closeBtn}
              type="button"
              aria-label={t('fileBrowserEntry.close')}
              onClick={() => setOpen(false)}
            >
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
