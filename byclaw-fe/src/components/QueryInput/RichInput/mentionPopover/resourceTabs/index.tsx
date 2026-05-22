import { Button, Tabs, Input, Spin, Upload, App } from 'antd';
import { useIntl, useNavigate, useSelector } from '@umijs/max';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { trim } from 'lodash';
import ResourceCitation from '@/components/Resources/components/ResourceCitation';
import Empty from '@/components/Empty';
import { Empty as AntdEmpty } from 'antd';
import { ResourceType } from '../../utils/constants';
import { IResourceType } from '../../types';
import { ResourceTypeMap } from '@/constants/resource';
import {
  queryDigEmployeeRelResourceAuth,
  listUserSpace,
  previewFile,
  uploadSkillZip,
} from '@/pages/manager/service/resources';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';
import styles from './style.module.less';
import useGlobal from '@/hooks/useGlobal';

const defaultVisibleKeys = getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG);
interface Props {
  open?: boolean;
  keyword?: string;
  agentId?: string;
  sessionId?: string;
  header?: React.ReactNode;
  onSelect: (item: any, type: IResourceType) => void;
  showKnowledgeTab?: boolean;
  showSpaceTab?: boolean;
  showSkillTab?: boolean;
  agentIds?: string;
}

/** 「工具」Tab：不含对象类型 */
const TOOL_TAB_BIZ_TYPES = [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT] as const;
const KNOWLEDGE_TAB_BIZ_TYPES = [ResourceTypeMap.knowledgeBase, ResourceTypeMap.knowledgeBaseQa] as const;

const ResourceTabs: React.FC<Props> = ({
  open,
  onSelect,
  keyword,
  header,
  agentId,
  sessionId,
  showKnowledgeTab,
  showSkillTab,
  agentIds,
}) => {
  const [activeTab, setActiveTab] = useState<string>();
  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultVisibleKeys);
  const initialKeyword = useMemo(() => trim(keyword || ''), [keyword]);
  const [searchValue, setSearchValue] = useState(initialKeyword);
  const [queryKeyword, setQueryKeyword] = useState(initialKeyword);
  const [sharedResources, setSharedResources] = useState<any[]>([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [brandVersion, setBrandVersion] = useState<'commercial' | 'openSource' | null>(null);
  const sharedQueryKeyRef = useRef('');
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const [fileList, setFileList] = useState<any[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const downloadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const downloadLockRef = useRef(false);

  const { layoutMode, agentInfo, EventEmitter } = useGlobal();

  const { agentType } = agentInfo || {};
  const isOpenSource = brandVersion === 'openSource';

  const { message } = App.useApp();

  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};

  useEffect(() => {
    getDcSystemConfigListByStandType({
      standType: 'MENU_ICON_SHOW_TAB',
    })
      .then((res: any) => {
        const configData = res?.data || res;
        if (Array.isArray(configData) && configData.length > 0) {
          const visibleMenuKeys = getVisibleMenuKeysFromConfig(configData);
          setVisibleKeys(visibleMenuKeys);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getDcSystemConfig({ paramCode: 'BYAI_BRAND_VERSION' })
      .then((res: any) => {
        setBrandVersion(res?.paramValue);
      })
      .catch(() => {
        setBrandVersion('openSource');
      });
  }, []);

  const isDebug = layoutMode === 'debug';
  const intl = useIntl();

  const navigate = useNavigate();

  const resolvedSessionId = useMemo(() => trim(sessionId || ''), [sessionId]);
  const normalizedAgentId = useMemo(() => {
    if (!agentId) return agentId;
    return agentId.split('_').pop() || agentId;
  }, [agentId]);

  // const { userInfo } = useSelector((state: any) => state.user);
  // const usersOrganizations = userInfo?.usersOrganizations || [];
  // const userTypeList = usersOrganizations.map((item: any) => item.userType);
  // isEmpty(intersection(userTypeList, ['PLAT_MAN', 'PLAT_DEVOPS']));

  const onSelectTool = useCallback(
    (item: any) => {
      onSelect(item, ResourceType.tool);
    },
    [onSelect]
  );

  const onSelectObject = useCallback(
    (item: any) => {
      onSelect(item, ResourceType.OBJECT);
    },
    [onSelect]
  );

  const onSelectSkill = useCallback(
    (item: any) => {
      onSelect(item, ResourceType.SKILL);
    },
    [onSelect]
  );

  const onSelectFile = useCallback(
    (item: any) => {
      onSelect(item, ResourceType.OBJECT);
    },
    [onSelect]
  );

  const fetchFileList = useCallback(
    async (path: string) => {
      setFileLoading(true);
      try {
        const response = await listUserSpace({
          prefix: path,
          resourceId: agentId,
        });
        setFileList(response || []);
      } catch (error) {
        console.error('Failed to load file list:', error);
        setFileList([]);
      } finally {
        setFileLoading(false);
      }
    },
    [agentId]
  );

  const handleFolderClick = useCallback(
    (folderPath: string) => {
      setPathHistory((prev) => [...prev, currentPath]);
      setCurrentPath(folderPath);
      fetchFileList(folderPath);
    },
    [currentPath, fetchFileList]
  );

  const handleBackClick = useCallback(() => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory((prev) => prev.slice(0, -1));
      setCurrentPath(previousPath);
      fetchFileList(previousPath);
    }
  }, [pathHistory, fetchFileList]);

  const handleDownloadFile = useCallback(
    (filePath: string, fileName: string) => {
      if (downloadLockRef.current || downloadingFile === filePath) {
        return;
      }

      downloadLockRef.current = true;
      setDownloadingFile(filePath);

      if (downloadTimerRef.current) {
        clearTimeout(downloadTimerRef.current);
      }

      downloadTimerRef.current = setTimeout(async () => {
        try {
          const response = await previewFile(filePath);
          const url = window.URL.createObjectURL(new Blob([response.file]));
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } catch (error) {
          console.error('文件下载失败:', error);
        } finally {
          downloadLockRef.current = false;
          setDownloadingFile(null);
          downloadTimerRef.current = null;
        }
      }, 200);
    },
    [downloadingFile]
  );

  useEffect(() => {
    if (activeTab === 'file') {
      fetchFileList(currentPath);
    }
  }, [activeTab, currentPath, fetchFileList]);

  const [skillUploading, setSkillUploading] = useState(false);

  const handleSkillUpload = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.zip')) {
        message.error(intl.formatMessage({ id: 'resourceTabs.skillUpload.onlyZip' }));
        return false;
      }

      const userCode = userInfo?.userCode;
      if (!userCode) {
        message.error(intl.formatMessage({ id: 'resourceTabs.skillUpload.noUserCode' }));
        return false;
      }
      setSkillUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userCode', userCode);
        if (normalizedAgentId) {
          formData.append('resourceId', normalizedAgentId);
        }

        const response = await uploadSkillZip(formData);

        message.success(response?.msg || intl.formatMessage({ id: 'resourceTabs.skillUpload.success' }));
        EventEmitter.emit('beyond-resourceList-resourceType-reload', 'SKILL');
        return true;
      } catch (error: any) {
        message.error(error?.message || error || intl.formatMessage({ id: 'resourceTabs.skillUpload.failed' }));
        return false;
      } finally {
        setSkillUploading(false);
      }
    },
    [userInfo, normalizedAgentId, intl, message]
  );

  const hasAnyTab = true;

  const shouldUseSharedResourceQuery = !!normalizedAgentId;

  useEffect(() => {
    setSearchValue(initialKeyword);
    setQueryKeyword(initialKeyword);
    sharedQueryKeyRef.current = '';
  }, [initialKeyword, normalizedAgentId, resolvedSessionId]);

  useEffect(() => {
    if (searchValue === queryKeyword) {
      return;
    }
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      const nextKeyword = trim(searchValue || '');
      setQueryKeyword((prev) => (prev === nextKeyword ? prev : nextKeyword));
    }, 400);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchValue, queryKeyword]);

  useEffect(() => {
    return () => {
      if (downloadTimerRef.current) {
        clearTimeout(downloadTimerRef.current);
      }
    };
  }, []);

  const fetchSharedResources = useCallback(
    async (keywordValue: string, force = false) => {
      if (activeTab === 'space' || activeTab === 'skill') {
        return;
      }
      if (!shouldUseSharedResourceQuery) {
        setSharedResources([]);
        setSharedLoading(false);
        sharedQueryKeyRef.current = '';
        return;
      }
      const currentQueryKey = `${normalizedAgentId}::${keywordValue}`;
      if (!force && sharedQueryKeyRef.current === currentQueryKey) {
        return;
      }
      setSharedResources([]);
      setSharedLoading(true);
      try {
        const response = await queryDigEmployeeRelResourceAuth({
          resourceId: normalizedAgentId,
          keyword: keywordValue,
          pageNum: 1,
          pageSize: 100,
        });
        const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        sharedQueryKeyRef.current = currentQueryKey;
        setSharedResources(rows);
      } catch (error) {
        setSharedResources([]);
        sharedQueryKeyRef.current = '';
        console.error('Failed to load digital employee related resources:', error);
      } finally {
        setSharedLoading(false);
      }
    },
    [normalizedAgentId, shouldUseSharedResourceQuery]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    fetchSharedResources(initialKeyword, true);
  }, [open, fetchSharedResources, initialKeyword]);

  useEffect(() => {
    if (!activeTab) {
      return;
    }
    fetchSharedResources(queryKeyword);
  }, [activeTab, queryKeyword, fetchSharedResources]);

  const getSharedTabResources = useCallback(
    (bizTypes: readonly string[]) => {
      return sharedResources.filter((item: any) => bizTypes.includes(item.resourceBizType));
    },
    [sharedResources]
  );

  useEffect(() => {
    const visible: string[] = ['space'];
    if (visibleKeys.includes('knowledge')) visible.push('knowledge');
    if (visibleKeys.includes('tool')) visible.push('tool');
    if (visibleKeys.includes('view')) visible.push('view');
    if (visibleKeys.includes('object')) visible.push('object');
    if (visibleKeys.includes('file')) visible.push('file');
    if (isOpenSource) visible.push('skill');
    if (!visible.length) return;
    const newActiveTabValue = activeTab && visible.includes(activeTab) ? activeTab : visible[0];
    setActiveTab(newActiveTabValue);
  }, [activeTab, showKnowledgeTab, showSkillTab, agentIds, visibleKeys, isOpenSource]);

  const tabItems = useMemo(() => {
    const items: {
      key: string;
      label: string;
      children: React.ReactNode;
    }[] = [];
    items.push({
      key: 'space',
      label: intl.formatMessage({ id: 'sider.space' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="SPACE"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
          />
        </div>
      ),
    });
    items.push({
      key: 'knowledge',
      label: intl.formatMessage({ id: 'sider.knowledge' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="KNOWLEDGE"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[...KNOWLEDGE_TAB_BIZ_TYPES]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources(KNOWLEDGE_TAB_BIZ_TYPES) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'object',
      label: intl.formatMessage({ id: 'common.object' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="OBJECT"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[ResourceTypeMap.OBJECT]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources([ResourceTypeMap.OBJECT]) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'tool',
      label: intl.formatMessage({ id: 'common.tool' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="TOOL"
            onSelect={onSelectTool}
            disableClick={true}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[...TOOL_TAB_BIZ_TYPES]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources(TOOL_TAB_BIZ_TYPES) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'view',
      label: intl.formatMessage({ id: 'common.viewName' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="VIEW"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[ResourceTypeMap.VIEW]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources([ResourceTypeMap.VIEW]) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    if (isOpenSource) {
      items.push({
        key: 'skill',
        label: intl.formatMessage({ id: 'common.skill' }),
        children: (
          <div className={styles.listContainer}>
            <ResourceCitation
              resourceType="SKILL"
              onSelect={onSelectSkill}
              keyword={queryKeyword}
              agentId={agentId}
              agentIds={agentIds}
            />
          </div>
        ),
      });
    }
    items.push({
      key: 'file',
      label: intl.formatMessage({ id: 'common.file' }),
      children: (
        <div className={styles.listContainer}>
          {pathHistory.length > 0 && (
            <div className={styles.filePathHeader}>
              <button type="button" className={styles.backButton} onClick={handleBackClick}>
                ← 返回上一级
              </button>
            </div>
          )}
          <div className={styles.fileList}>
            {fileLoading ? (
              <div className={classNames('ub ub-ac ub-pc', styles.loadingContainer)}>
                <Spin />
              </div>
            ) : fileList.length === 0 ? (
              <div className={styles.emptyContainer}>
                <Empty image={AntdEmpty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              fileList.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className={`${styles.fileItem} ${file.dir ? styles.folderItem : styles.fileItem}`}
                  onClick={() => {
                    if (file.dir) {
                      handleFolderClick(file.filePath);
                    } else {
                      onSelectFile({
                        resourceId: `${file.filePath}/${file.name}`,
                        resourceName: file.name,
                        resourceType: 'FILE',
                      });
                    }
                  }}
                >
                  <span className={styles.fileIcon}>{file.dir ? '📁' : '📄'}</span>
                  <span className={styles.fileName}>{file.name}</span>
                  {!file.dir && (
                    <Button
                      type="text"
                      size="small"
                      className={styles.downloadBtn}
                      loading={downloadingFile === file.filePath}
                      disabled={!!downloadingFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadFile(file.filePath, file.name);
                      }}
                    >
                      下载
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ),
    });
    return items;
  }, [
    intl,
    onSelect,
    onSelectObject,
    onSelectTool,
    onSelectFile,
    queryKeyword,
    agentId,
    agentIds,
    isOpenSource,
    showKnowledgeTab,
    showSkillTab,
    shouldUseSharedResourceQuery,
    sharedLoading,
    getSharedTabResources,
    resolvedSessionId,
    fileList,
    fileLoading,
    pathHistory,
    downloadingFile,
    handleBackClick,
    handleFolderClick,
    handleDownloadFile,
  ]);

  const visibleTabs = useMemo(() => {
    const baseTabs = [
      {
        key: 'space',
        label: intl.formatMessage({ id: 'sider.space' }),
      },
    ];

    const conditionalTabs = [
      {
        key: 'knowledge',
        label: intl.formatMessage({ id: 'sider.knowledge' }),
      },
      {
        key: 'tool',
        label: intl.formatMessage({ id: 'common.tool' }),
      },
      {
        key: 'view',
        label: intl.formatMessage({ id: 'common.viewName' }),
      },
      {
        key: 'object',
        label: intl.formatMessage({ id: 'common.object' }),
      },
    ];

    const skillTab = {
      key: 'skill',
      label: intl.formatMessage({ id: 'common.skill' }),
    };

    const fileTab = {
      key: 'file',
      label: intl.formatMessage({ id: 'common.file' }),
    };

    const filteredConditionalTabs = conditionalTabs.filter((tab) => {
      if (agentType === '005') {
        return !['knowledge', 'tool'].includes(tab.key);
      }
      if (agentType === '006') {
        return !['tool', 'view', 'object'].includes(tab.key);
      }
      return visibleKeys.includes(tab.key);
    });

    return [...baseTabs, ...filteredConditionalTabs, ...(isOpenSource ? [skillTab] : []), fileTab];
  }, [agentType, intl, visibleKeys, isOpenSource]);

  if (!hasAnyTab) {
    return (
      <div className={styles.wrap}>
        <Empty />
      </div>
    );
  }

  return (
    <div className={styles.wrap} style={{ width: isDebug ? '100vw' : '1100px' }}>
      {header}
      <div className={classNames(styles.headerRow, 'full-width')}>
        <Tabs
          className={classNames(styles.tabButtons, 'full-width')}
          activeKey={activeTab}
          items={visibleTabs}
          onChange={setActiveTab}
          size={isDebug ? 'small' : 'middle'}
          tabBarExtraContent={
            <div className={styles.searchRow}>
              {activeTab === 'skill' && (
                <Upload
                  accept=".zip"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleSkillUpload(file);
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={skillUploading} disabled={skillUploading}>
                    {intl.formatMessage({ id: 'resourceTabs.skillUpload.uploadButton' })}
                  </Button>
                </Upload>
              )}
              <Input
                allowClear
                disabled={!!keyword}
                placeholder={intl.formatMessage({ id: 'selectMember.searchPlaceholder' })}
                className={styles.searchInput}
                suffix={<SearchOutlined />}
                value={searchValue}
                onChange={(e) => {
                  setSearchValue(e.target.value);
                }}
                onBlur={() => {
                  const nextKeyword = trim(searchValue || '');
                  if (nextKeyword !== queryKeyword) {
                    if (debounceTimer.current) {
                      clearTimeout(debounceTimer.current);
                    }
                    setQueryKeyword(nextKeyword);
                  }
                }}
                onPressEnter={() => {
                  const nextKeyword = trim(searchValue || '');
                  if (nextKeyword !== queryKeyword) {
                    if (debounceTimer.current) {
                      clearTimeout(debounceTimer.current);
                    }
                    setQueryKeyword(nextKeyword);
                  }
                }}
              />
              {!isDebug && activeTab !== 'space' && activeTab !== 'skill' && (
                <Button
                  type="text"
                  onClick={() => {
                    const routeMap: Record<string, string> = {
                      knowledge: '/knowledgeCenter?tab=enterprise',
                      object: '/objectCenter?tab=enterprise',
                      view: '/viewCenter?tab=enterprise',
                      tool: '/toolCenter?tab=enterprise',
                    };
                    const route = activeTab ? routeMap[activeTab] || '/workspace' : '/workspace';
                    navigate(route);
                  }}
                >
                  {activeTab === 'knowledge' && intl.formatMessage({ id: 'resourceTabs.knowledgeCenter' })}
                  {activeTab === 'object' && intl.formatMessage({ id: 'resourceTabs.objectCenter' })}
                  {activeTab === 'view' && intl.formatMessage({ id: 'resourceTabs.viewCenter' })}
                  {activeTab === 'tool' && intl.formatMessage({ id: 'resourceTabs.toolCenter' })}
                </Button>
              )}
            </div>
          }
        />
      </div>
      <div className={styles.tabsWrap}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          destroyInactiveTabPane
          tabBarStyle={{ display: 'none' }}
          items={tabItems.map(({ key, label, children }) => ({ key, label, children }))}
        />
      </div>
    </div>
  );
};

export default ResourceTabs;
