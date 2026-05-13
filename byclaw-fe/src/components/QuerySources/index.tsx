/* eslint-disable lines-around-comment */
/**
 * QuerySources 组件
 * 知识来源管理组件，负责知识来源的搜索、导入、勾选等操作
 */

import React, { useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import { Button, Spin, Modal, Input } from 'antd';
import classNames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { PlusOutlined } from '@ant-design/icons';
import useGlobal from '@/hooks/useGlobal';
import { useIntl } from '@umijs/max';
import { debounce, intersection, isString } from 'lodash';
import { DEFAULT_SIDER_CONTENT_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import type {
  QuerySourcesProps,
  SourceTreeNode,
  SourceRootId,
  WebSearchResult,
  SourceTreeNodeId,
  LoadingSourceItem,
  ISource,
  KnowledgeSource,
} from './types';
import WebSearch from './WebSearch';
import SourceTree from './SourceTree';
import WebSearchDetailPanel from './SourceDetailPanel/SearchResult';
import PreviewFilePanel, { PreviewFileInfo } from './SourceDetailPanel/PreviewFilePanel';
import AddSourceModal from './AddSourceModal';
import GroupSelectModal from './GroupSelectModal';
import { useSources } from './hooks/useSources';
import { SourceRootIdMap, SourceTreeNodeTypeMap, rootInfoMap } from './const';
import styles from './index.less';
import { useSearch } from './hooks/useSearch';
import { useFileUpload } from './hooks/useFileUpload';
import NullableAntdCompWithAnim from '../NullableAntdCompWithAnim';
import {
  isSeachQueryMode,
  isFunctionCloudMode,
  getSourceRootIdByNodeId,
  getCheckedSourcesBySource,
  filterCheckedSourcesByVisibleRootIds,
} from './utils';
import useCheck from './hooks/useCheck';

const QuerySources: React.FC<QuerySourcesProps> = (props) => {
  const { className, style } = props;
  const intl = useIntl();

  const { sessionId, agentInfo, EventEmitter } = useGlobal();
  const { agentType } = agentInfo || {};

  const { setSiderContentWidth } = useContext(SiderContentContext);

  const onCheckChangeMapRef = useRef<Map<string, (keys: KnowledgeSource[]) => void>>(new Map());
  const cacheSessionIdRef = useRef<string | undefined>(sessionId);

  const [enableRootIds, setEnableRootIds] = useState<SourceRootId[]>([]);
  const visibleRootIds = useMemo(() => {
    let l: SourceRootId[] = [];

    if (isSeachQueryMode(agentType)) {
      l = [
        SourceRootIdMap.userImported,
        SourceRootIdMap.knowledgeBases,
        SourceRootIdMap.enterpriseKnowledgeBases,
        // SourceRootIdMap.skills,
        SourceRootIdMap.favorites,
      ];
    }
    if (isFunctionCloudMode(agentType)) {
      l = [
        SourceRootIdMap.knowledgeBases,
        SourceRootIdMap.enterpriseKnowledgeBases,
        SourceRootIdMap.skills,
        SourceRootIdMap.favorites,
      ];
    }
    return intersection(l, enableRootIds);
  }, [agentType, enableRootIds]);

  const {
    searchInfo,
    searchStatus,
    searchResults,
    isImporting,
    handleWebSearch,
    handleDeleteSearchResult,
    handleImportSearchResults,
  } = useSearch();

  const { checkedIds, setCheckedIds, handleCheckChange } = useCheck({
    cacheSessionIdRef,
  });

  /** 所有知识来源（按目录组织）及其加载方法 */
  const {
    sources,
    setSources,
    loading: initialLoading,
    renameUserImportedNode,
    deleteUserImportedNode,
  } = useSources({
    sessionId,
    setCheckedIds,
    visibleRootIds,
    cacheSessionIdRef,
  });

  /** 详情Panel展开状态 */
  const [detailPanelOpenType, setDetailPanelOpenType] = useState<'' | 'webSearchResult' | 'filePreview'>('');

  /** 文件预览面板当前文件 */
  const [previewFile, setPreviewFile] = useState<PreviewFileInfo | null>(null);

  /** 添加来源弹窗状态 */
  const [isModalOpen, setIsModalOpen] = useState(false);

  /** 大数据量分组选择弹窗状态 */
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupModalGroupId, setGroupModalGroupId] = useState<SourceRootId | null>(null);
  const [groupModalCheckedIds, setGroupModalCheckedIds] = useState<SourceTreeNodeId[]>([]);

  /** 正在加载的来源项（用于文件上传、文字粘贴的 loading 状态） */
  const [loadingSources, setLoadingSources] = useState<LoadingSourceItem[]>([]);

  /** 文件上传 Hook */
  const { handleFileUpload, handleTextUpload } = useFileUpload({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSources: setSources as any,
    setLoadingSources,
    setCheckedIds,
    sessionId,
  });

  /**
   * 导入搜索结果
   */
  const onImportWebSearchResults = useCallback(
    async (targetResults: WebSearchResult[]) => {
      if (targetResults.length === 0) return;
      const resp = await handleImportSearchResults(targetResults);
      if (!resp) return;

      // 个人知识库和企业知识库搜索的结果，导入时添加到【用户导入来源】
      const { mode } = searchInfo;
      if (mode === 'knowledgeBase' || mode === 'enterpriseKnowledgeBase') {
        // 将导入结果转换为用户导入来源格式
        const importedItems = resp.list.map((item) => ({
          ...item,
          type: 'file' as const,
          resourceId: item.fileId,
        }));

        setSources((prev) => ({
          ...prev,
          userImported: {
            ...prev.userImported,
            items: [...prev.userImported.items, ...importedItems],
            totalCount: prev.userImported.totalCount + importedItems.length,
          },
        }));
        setCheckedIds((prev) => [...prev, ...importedItems.map((item) => item.id)]);
      } else {
        // Web搜索的结果直接添加到用户导入来源
        setSources((prev) => ({
          ...prev,
          userImported: {
            ...prev.userImported,
            items: [...prev.userImported.items, ...resp.list],
            totalCount: prev.userImported.totalCount + resp.list.length,
          },
        }));
        setCheckedIds((prev) => [...prev, ...resp.list.map((item) => item.id)]);
      }
    },
    [handleImportSearchResults, searchInfo]
  );

  const changeSiderContentWidth = useCallback((openPanel: boolean) => {
    if (openPanel) {
      setSiderContentWidth(DEFAULT_SIDER_CONTENT_WIDTH + 200);
    } else {
      setSiderContentWidth(DEFAULT_SIDER_CONTENT_WIDTH);
    }
  }, []);

  /**
   * 查看搜索结果详情
   */
  const handleViewWebSearchResultDetail = useCallback(() => {
    changeSiderContentWidth(true);
    setDetailPanelOpenType('webSearchResult');
  }, []);

  /**
   * 关闭详情Panel
   */
  const handleCloseDetailPanel = useCallback(() => {
    changeSiderContentWidth(false);
    setDetailPanelOpenType('');
    setPreviewFile(null);
  }, []);

  /**
   * 打开文件预览详情
   */
  const handleOpenFilePreview = useCallback(
    (node: SourceTreeNode) => {
      if (!node.sourceData) return;
      const sourceData = node.sourceData as any;

      const fileUrl: string | undefined = sourceData.fileUrl || sourceData.url;
      if (!fileUrl) return;

      const fileName: string =
        sourceData.fileName ||
        sourceData.originFileName ||
        sourceData.title ||
        (typeof node.title === 'string' ? node.title : '');

      setPreviewFile({
        fileUrl,
        fileName,
        fileId: sourceData.fileId,
      });
      changeSiderContentWidth(true);
      setDetailPanelOpenType('filePreview');
    },
    [changeSiderContentWidth]
  );

  /**
   * 打开添加来源弹窗
   */
  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  /**
   * 关闭添加来源弹窗
   */
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  /**
   * 处理粘贴网址
   * 关闭弹窗后，使用 Web 搜索的方式搜索该 URL
   */
  const onPasteUrl = useCallback(
    (url: string) => {
      // 调用 Web 搜索，将 URL 作为搜索词
      handleWebSearch(url, 'webSearch');
    },
    [handleWebSearch]
  );

  /**
   * 打开大数据量分组的选择弹窗
   */
  const handleOpenGroupModal = useCallback(
    async (groupId: SourceRootId) => {
      setGroupModalGroupId(groupId);
      setGroupModalVisible(true);
      setGroupModalCheckedIds(checkedIds.filter((id) => getSourceRootIdByNodeId(id) === groupId));
    },
    [sources, checkedIds]
  );

  const handleGroupModalCancel = useCallback(() => {
    setGroupModalVisible(false);
  }, []);

  /**
   * 确认大数据量分组的选择
   */
  const handleGroupModalOk = useCallback(
    (groupCheckedIds: SourceTreeNodeId[]) => {
      if (!groupModalGroupId) return;

      const nextCheckedIds = checkedIds.filter((id) => getSourceRootIdByNodeId(id) !== groupModalGroupId);
      if (groupCheckedIds.length) {
        nextCheckedIds.push(...groupCheckedIds);
      }

      setCheckedIds(nextCheckedIds);
      handleGroupModalCancel();
    },
    [groupModalGroupId, checkedIds]
  );

  // ==================== Memos ====================
  /**
   * 构建树节点数据
   */
  const treeData = useMemo<SourceTreeNode[]>(() => {
    if (!visibleRootIds.length) return [];
    const canPopupGroupModal = (rootId: SourceRootId) =>
      [SourceRootIdMap.knowledgeBases, SourceRootIdMap.enterpriseKnowledgeBases, SourceRootIdMap.skills].includes(
        rootId
      );

    const sourceTreeNodeFactory = (item: KnowledgeSource, rootId: SourceRootId) => {
      const node: SourceTreeNode = {
        rootId,
        id: item.id,
        title: item.title,
        type: item.type,
        sourceData: item,
      };
      if (canPopupGroupModal(rootId) && item.type === SourceTreeNodeTypeMap.more) {
        node.onSummaryClick = handleOpenGroupModal;
      }
      return node;
    };

    return visibleRootIds.map((rootId) => {
      // 构建子节点列表
      const children = sources[rootId].items.map((item) => {
        return sourceTreeNodeFactory(item, rootId);
      });

      // 如果是用户导入来源，添加 loading 状态的节点
      if (rootId === SourceRootIdMap.userImported && loadingSources.length > 0) {
        loadingSources.forEach((loadingItem) => {
          children.push({
            rootId,
            id: loadingItem.id,
            title: loadingItem.title,
            type: loadingItem.type,
            loading: true, // loading 状态禁止交互
          });
        });
      }

      let IconComp: any = rootInfoMap[rootId].icon;
      if (isString(IconComp) && IconComp?.startsWith('icon-')) {
        IconComp = <AntdIcon type={rootInfoMap[rootId].icon as string} />;
      } else {
        IconComp = <IconComp />;
      }

      return {
        rootId,
        id: rootId,
        title: rootInfoMap[rootId].title,
        type: SourceTreeNodeTypeMap.folder,
        expandable: true,
        // expandable: [
        //   SourceRootIdMap.knowledgeBases,
        //   SourceRootIdMap.enterpriseKnowledgeBases,
        //   SourceRootIdMap.skills,
        // ].includes(rootId)
        //   ? !largeDataMode
        //   : true,
        icon: IconComp,
        children,
        totalChildren: sources[rootId].totalItems?.map((item) => sourceTreeNodeFactory(item, rootId)) ?? [],
        totalCount: sources[rootId].totalCount + (rootId === SourceRootIdMap.userImported ? loadingSources.length : 0),
        onSummaryClick: canPopupGroupModal(rootId) ? handleOpenGroupModal : undefined,
      };
    });
  }, [visibleRootIds, sources, checkedIds, handleOpenGroupModal, loadingSources]);

  /**
   * Web搜索是否禁用
   */
  const isWebSearchDisabled = useMemo(() => {
    return searchStatus === 'searching' || (searchStatus === 'completed' && searchResults.length > 0);
  }, [searchStatus, searchResults]);

  /**
   * 渲染添加来源按钮
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderAddButton = useCallback(() => {
    if (visibleRootIds.includes(SourceRootIdMap.userImported)) {
      return (
        <Button className={styles.addButton} onClick={handleOpenModal} type="text" size="small">
          <PlusOutlined />
          添加来源
        </Button>
      );
    }
    return null;
  }, [visibleRootIds, handleOpenModal]);

  /**
   * 渲染顶部标题
   */
  const renderHeader = useCallback(
    () => (
      <div className={classNames(styles.header, 'ub ub-ac ub-pj')}>
        <span className={styles.headerTitle}>工作空间</span>
        {renderAddButton()}
      </div>
    ),
    [renderAddButton]
  );

  /**
   * 渲染Web搜索区域
   */
  const renderWebSearch = () => {
    return (
      <WebSearch
        isImporting={isImporting}
        status={searchStatus}
        results={searchResults}
        onSearch={handleWebSearch}
        onDeleteResult={handleDeleteSearchResult}
        onImportResults={onImportWebSearchResults}
        onViewDetail={handleViewWebSearchResultDetail}
        disabled={isWebSearchDisabled}
      />
    );
  };

  /**
   * 处理节点重命名（仅用户导入来源下的文件节点）
   */
  const handleRenameNode = useCallback(
    (node: SourceTreeNode, newTitle: string) => {
      renameUserImportedNode(node.id as SourceTreeNodeId, newTitle);
    },
    [renameUserImportedNode]
  );

  /**
   * 处理节点删除（仅用户导入来源下的文件节点）
   */
  const handleDeleteNode = useCallback(
    (node: SourceTreeNode) => {
      deleteUserImportedNode(node.id as SourceTreeNodeId);
    },
    [deleteUserImportedNode]
  );

  const updateCheckChangeMap = useCallback(
    debounce((checkedIds: SourceTreeNodeId[], source: ISource) => {
      const l = getCheckedSourcesBySource(checkedIds, source);
      onCheckChangeMapRef.current.values().forEach((callback) => {
        callback(l);
      });
    }, 500),
    []
  );

  /**
   * 渲染来源树
   */
  const renderSourceTree = () => (
    <SourceTree
      treeData={treeData}
      checkedIds={checkedIds}
      onCheckChange={handleCheckChange}
      onFileNodeClick={handleOpenFilePreview}
      onRenameNode={(node) => {
        let nextTitle = node.title;
        Modal.confirm({
          title: intl.formatMessage({ id: 'common.rename' }),
          content: (
            <Input
              autoFocus
              defaultValue={node.title}
              onChange={(e) => {
                nextTitle = e.target.value;
              }}
              onPressEnter={() => {
                const trimmed = (nextTitle || '').trim();
                if (!trimmed || trimmed === node.title) {
                  Modal.destroyAll();
                  return;
                }
                handleRenameNode(node, trimmed);
                Modal.destroyAll();
              }}
            />
          ),
          onOk: () => {
            const trimmed = (nextTitle || '').trim();
            if (!trimmed || trimmed === node.title) {
              return;
            }
            handleRenameNode(node, trimmed);
          },
        });
      }}
      onDeleteNode={(node) => {
        Modal.confirm({
          content: intl.formatMessage({ id: 'common.deleteConfirm2' }, { content: node.title }),
          onOk: () => {
            handleDeleteNode(node);
          },
        });
      }}
    />
  );

  /**
   * 渲染web搜索结果详情Panel
   */
  const renderWebSearchDetailPanel = () => {
    const isOpen = detailPanelOpenType === 'webSearchResult';
    return (
      <NullableAntdCompWithAnim open={isOpen}>
        <WebSearchDetailPanel
          isImporting={isImporting}
          isOpen={isOpen}
          searchResults={searchResults}
          onClose={handleCloseDetailPanel}
          onConfirmImport={onImportWebSearchResults}
          searchMode={searchInfo.mode}
        />
      </NullableAntdCompWithAnim>
    );
  };

  /**
   * 渲染文件预览详情Panel
   */
  const renderFilePreviewPanel = () => {
    const isOpen = detailPanelOpenType === 'filePreview';
    return (
      <NullableAntdCompWithAnim open={isOpen}>
        <PreviewFilePanel isOpen={isOpen} file={previewFile || undefined} onClose={handleCloseDetailPanel} />
      </NullableAntdCompWithAnim>
    );
  };

  /**
   * 渲染添加来源弹窗
   */
  const renderAddModal = () => (
    <NullableAntdCompWithAnim open={isModalOpen}>
      <AddSourceModal
        visible={isModalOpen}
        onClose={handleCloseModal}
        onFileUpload={handleFileUpload}
        onPasteUrl={onPasteUrl}
        onPasteText={handleTextUpload}
      />
    </NullableAntdCompWithAnim>
  );

  useEffect(() => {
    const handler = (enableRootIds: SourceRootId[]) => {
      setEnableRootIds(enableRootIds);
    };
    EventEmitter.on('querysources-enable-rootid-list', handler);
    return () => {
      EventEmitter.off('querysources-enable-rootid-list', handler);
    };
  }, []);

  useEffect(() => {
    const registerHandler = ({ key, callback }: { key: string; callback: (keys: KnowledgeSource[]) => void }) => {
      onCheckChangeMapRef.current.set(key, callback);
    };

    const unregisterHandler = (key: string) => {
      onCheckChangeMapRef.current.delete(key);
    };

    EventEmitter.on('querysources-register-oncheckchange', registerHandler);
    EventEmitter.on('querysources-unregister-oncheckchange', unregisterHandler);

    return () => {
      EventEmitter.off('querysources-register-oncheckchange', registerHandler);
      EventEmitter.off('querysources-unregister-oncheckchange', unregisterHandler);
    };
  }, []);

  useEffect(() => {
    const fliterCheckedIds = filterCheckedSourcesByVisibleRootIds(checkedIds, visibleRootIds);
    updateCheckChangeMap(fliterCheckedIds, sources);
  }, [checkedIds, sources, visibleRootIds]);

  useEffect(() => {
    if (`${cacheSessionIdRef.current}` === `${sessionId}`) return;
    cacheSessionIdRef.current = `${sessionId}`;
  }, [sessionId]);

  // ==================== Render ====================
  return (
    <div className={`${styles.querySources} ${className || ''}`} style={style}>
      {renderHeader()}
      <Spin spinning={initialLoading} wrapperClassName={styles.contentSpin}>
        {visibleRootIds.includes(SourceRootIdMap.userImported) && (
          <div className={styles.searchWrapper}>{renderWebSearch()}</div>
        )}
        <div className={styles.treeWrapper}>{renderSourceTree()}</div>
      </Spin>
      {renderWebSearchDetailPanel()}
      {renderFilePreviewPanel()}
      {renderAddModal()}
      <NullableAntdCompWithAnim open={groupModalVisible}>
        <GroupSelectModal
          visible={groupModalVisible}
          groupId={groupModalGroupId}
          checkedIds={groupModalCheckedIds}
          onCancel={handleGroupModalCancel}
          onOk={handleGroupModalOk}
        />
      </NullableAntdCompWithAnim>
    </div>
  );
};

export default QuerySources;
