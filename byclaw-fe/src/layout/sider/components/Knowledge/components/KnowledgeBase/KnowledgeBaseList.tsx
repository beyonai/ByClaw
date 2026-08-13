import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { Input, Dropdown, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { trim, get, isEmpty, intersection, debounce } from 'lodash';
import { useIntl, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import ResourceDetail from '@/components/Resources/components/ResourceDetail';
import DetailPanel from '@/pages/knowledgeCenter/components/DetailPanel';
import ShareModal from '@/pages/knowledgeCenter/components/shareModal';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import withDrag, { DragType, IDragType } from '@/components/QueryInput/withDrag';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import { batchHandleAuth, listAuthDetail } from '@/pages/manager/service/DigitalResourceMgr';
import { IKnowledgeBaseItem } from './types';
import InfiniteScrollAntdList from '../../../InfiniteScrollAntdList';
import commonStyles from '../common.module.less';
import EmptyTips from '@/components/EmptyTips';
import useModuleEvent from '@/hooks/useModuleEvent';
import useGlobal from '@/hooks/useGlobal';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import KnowledgeBaseListItem from './KnowledgeBaseListItem';

const SHARE_GRANT_TYPE = 'FORCE_USE';
const Draggable = withDrag(DragType.knowledgeBase);

const getGrantItem = (item: any) => ({
  ...item,
  id: `${String(item.grantToObjType).toLowerCase()}_${item.grantToObjId}`,
  name: item.grantToObjName,
  type: item.grantToObjType,
});

const transformGrantItem = (item: any) => {
  const [, idFromKey] = String(item.id || '').split('_');
  return {
    grantToObjId: idFromKey || item.grantToObjId,
    grantToObjType: item.type || item.grantToObjType,
  };
};

interface AuthDetailResponse {
  code?: number;
  msg?: string;
  data?: {
    redList?: any[];
    blackList?: any[];
  };
}

interface AuthSaveResponse {
  code?: number;
  msg?: string;
}

interface KnowledgeBaseListProps {
  editable?: boolean;
  onSelect?: (item: IKnowledgeBaseItem, type: IDragType) => void;
  onDrilldown: (item: IKnowledgeBaseItem) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
  activeAgentResourceId?: string;
}

// const PERSONAL_DEFAULT_OWNER_TYPE = 'personal_default';

const KnowledgeBaseList = (props: KnowledgeBaseListProps) => {
  const { onDrilldown, keyword, activeAgentResourceId } = props;
  const searchValue = useRef('');
  const listFetchRef = useRef(false);
  const itemClickTimerRef = useRef<number | null>(null);
  // const [filterType, setFilterType] = useState<FilterType>(FilterType.all);
  const [loading, setLoading] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [modalState, setModalState] = useState<{
    openType: '' | 'add' | 'rename' | 'share';
    info?: IKnowledgeBaseItem;
  }>({ openType: '' });
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareRecord, setShareRecord] = useState<IKnowledgeBaseItem | null>(null);
  const [shareAuthList, setShareAuthList] = useState<any[]>([]);
  const [shareBlackList, setShareBlackList] = useState<any[]>([]);
  const { EventEmitter } = useGlobal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const usersOrganizations = get(userInfo, 'usersOrganizations') || [];
  const userTypeList = usersOrganizations.map((item: any) => item.userType);
  const isUser = isEmpty(intersection(userTypeList, ['PLAT_MAN', 'PLAT_DEVOPS']));

  const intl = useIntl();
  // const {
  //   token: { colorPrimary },
  // } = theme.useToken();
  const { moduleEventEmitter, logoutModuleEvent } = useModuleEvent('KNOWLEDGE_CENTER');

  // const filterTypes = useMemo(
  //   () => [
  //     { key: FilterType.all, label: intl.formatMessage({ id: 'dialogueRecord.all' }) },
  //     { key: FilterType.shared, label: intl.formatMessage({ id: 'knowledgeCenter.shared' }) },
  //     { key: FilterType.private, label: intl.formatMessage({ id: 'knowledgeCenter.myCreation' }) },
  //   ],
  //   [intl]
  // );

  // 获取知识库列表
  const loadKnowledgeBases = useCallback(
    async (reset = false) => {
      if (listFetchRef.current) return;
      listFetchRef.current = true;
      if (reset) {
        setLoading(true);
      }
      try {
        const payload: {
          resourceId?: string;
          pageNum: number;
          pageSize: number;
          keyword: string;
          resourceStatus?: string;
          resourceBizTypeList?: string[];
        } = {
          resourceId: activeAgentResourceId,
          pageNum: 1,
          pageSize: 30,
          keyword: searchValue.current.trim(),
          resourceStatus: '2',
          resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
        };
        const response = await queryDigEmployeeRelResourceAuth(payload);
        const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        setKnowledgeBases(rows);
        setHasMore(false);
      } catch (error) {
        console.error('Failed to load knowledge bases:', error);
        setHasMore(false);
      } finally {
        listFetchRef.current = false;
        setLoading(false);
      }
    },
    [activeAgentResourceId]
  );

  // 初始加载
  useEffect(() => {
    loadKnowledgeBases(true);
  }, [loadKnowledgeBases]);

  useEffect(() => {
    const handleDefaultDigitalEmployeeChanged = () => {
      loadKnowledgeBases(true);
    };
    EventEmitter.on('default-digital-employee-changed', handleDefaultDigitalEmployeeChanged);
    return () => {
      EventEmitter.off('default-digital-employee-changed', handleDefaultDigitalEmployeeChanged);
    };
  }, [EventEmitter, loadKnowledgeBases]);

  useEffect(() => {
    const handleSiderMenuRefresh = (payload?: { key?: string }) => {
      if (payload?.key === 'knowledge') {
        loadKnowledgeBases(true);
      }
    };

    EventEmitter.on('sider-menu-tab-click-refresh', handleSiderMenuRefresh);
    return () => {
      EventEmitter.off('sider-menu-tab-click-refresh', handleSiderMenuRefresh);
    };
  }, [EventEmitter, loadKnowledgeBases]);

  useEffect(() => {
    const handleResourceInstalled = () => {
      loadKnowledgeBases(true);
    };

    window.addEventListener('digitalEmployeeResourceInstalled', handleResourceInstalled);
    return () => {
      window.removeEventListener('digitalEmployeeResourceInstalled', handleResourceInstalled);
    };
  }, [loadKnowledgeBases]);

  const onKeywordChanged = debounce((keyword: string) => {
    searchValue.current = keyword;
    loadKnowledgeBases(true);
  }, 200);

  useEffect(() => {
    if (keyword !== undefined) {
      searchValue.current = keyword;
      onKeywordChanged(keyword);
    }
  }, [keyword]);

  useEffect(() => {
    const onDelete = (item: IKnowledgeBaseItem) => {
      setKnowledgeBases((prev) => prev.filter((i) => i.resourceId !== item.resourceId));
    };
    const onRename = (item: Pick<IKnowledgeBaseItem, 'resourceId' | 'resourceName'>) => {
      setKnowledgeBases((prev) =>
        prev.map((i) => (i.resourceId === item.resourceId ? { ...i, resourceName: item.resourceName } : i))
      );
    };
    moduleEventEmitter.on('DELETE_KNOWLEDGE_BASE', onDelete);
    moduleEventEmitter.on('RENAME_KNOWLEDGE_BASE', onRename);
    return () => {
      moduleEventEmitter.off('DELETE_KNOWLEDGE_BASE', onDelete);
      moduleEventEmitter.off('RENAME_KNOWLEDGE_BASE', onRename);
      logoutModuleEvent();
    };
  }, []);

  const closeModal = useCallback(() => {
    setModalState({ openType: '' });
  }, []);

  const handleQuoteKnowledgeBase = useCallback(
    (item: IKnowledgeBaseItem) => {
      EventEmitter.emit('queryInput-insert-item', {
        item,
        type: DragType.knowledgeBase,
      });
    },
    [EventEmitter]
  );

  const clearItemClickTimer = useCallback(() => {
    if (itemClickTimerRef.current !== null) {
      window.clearTimeout(itemClickTimerRef.current);
      itemClickTimerRef.current = null;
    }
  }, []);

  const handleKnowledgeBaseItemClick = useCallback(
    (event: React.MouseEvent<HTMLElement>, item: IKnowledgeBaseItem) => {
      event.stopPropagation();
      clearItemClickTimer();
      itemClickTimerRef.current = window.setTimeout(() => {
        itemClickTimerRef.current = null;
        onDrilldown(item);
      }, 220);
    },
    [clearItemClickTimer, onDrilldown]
  );

  const handleKnowledgeBaseItemDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>, item: IKnowledgeBaseItem) => {
      event.stopPropagation();
      clearItemClickTimer();
      handleQuoteKnowledgeBase(item);
    },
    [clearItemClickTimer, handleQuoteKnowledgeBase]
  );

  useEffect(() => {
    return clearItemClickTimer;
  }, [clearItemClickTimer]);

  const handleDetail = useCallback(
    (item: IKnowledgeBaseItem) => {
      setDetailPanel?.(
        <ResourceDetail
          visible
          panel
          resourceId={item.resourceId}
          item={item}
          resourceName={intl.formatMessage({ id: 'resource.knowledge' })}
          onCancel={() => clearDetailPanel?.()}
          onEdit={() => {}}
        />,
        {
          width: 350,
          tabKey: `knowledge-resource:${item.resourceId}`,
          title: item.resourceName,
        }
      );
    },
    [clearDetailPanel, intl, setDetailPanel]
  );

  const handleShare = useCallback(
    async (item: IKnowledgeBaseItem) => {
      if (!item.resourceId || !item.resourceBizType) return;
      try {
        const detail = (await listAuthDetail({
          grantType: SHARE_GRANT_TYPE,
          grantObjType: item.resourceBizType,
          grantObjId: item.resourceId,
        })) as unknown as AuthDetailResponse;

        if (detail && detail.code === 0) {
          setShareRecord(item);
          setShareAuthList(detail.data?.redList?.map(getGrantItem) || []);
          setShareBlackList(detail.data?.blackList?.map(getGrantItem) || []);
          setShareModalOpen(true);
          return;
        }

        message.error(detail?.msg || intl.formatMessage({ id: 'common.operationFailed' }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
      }
    },
    [intl]
  );

  const handleShareCancel = useCallback(() => {
    setShareModalOpen(false);
    setShareRecord(null);
    setShareAuthList([]);
    setShareBlackList([]);
  }, []);

  const handleShareConfirm = useCallback(
    async (authList: any[]) => {
      if (!shareRecord?.resourceId || !shareRecord?.resourceBizType) return;

      const redList = authList.map((item) => ({
        ...transformGrantItem(item),
        grantType: SHARE_GRANT_TYPE,
      }));
      const blackList = shareBlackList.map((item) => ({
        ...transformGrantItem(item),
        grantType: SHARE_GRANT_TYPE,
      }));

      try {
        const res = (await batchHandleAuth(
          {
            grantObjId: shareRecord.resourceId,
            grantObjType: shareRecord.resourceBizType,
            redList,
            blackList,
            resourceId: shareRecord.resourceId,
          },
          '/byaiService/auth/privilegeGrant/setResourceUsers'
        )) as unknown as AuthSaveResponse;

        if (res && res.code === 0) {
          message.success(intl.formatMessage({ id: 'common.shareSuccess' }));
          handleShareCancel();
          loadKnowledgeBases(true);
          moduleEventEmitter.emit('REFRESH_KNOWLEDGE_BASE');
          return;
        }

        message.error(res?.msg || intl.formatMessage({ id: 'common.shareFailed' }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'common.shareFailed' }));
      }
    },
    [handleShareCancel, intl, loadKnowledgeBases, moduleEventEmitter, shareBlackList, shareRecord]
  );

  return (
    <div className={commonStyles.container}>
      {/* 搜索区域 */}
      <div className={commonStyles.searchArea} style={{ display: keyword ? 'none' : 'block' }}>
        <div className={commonStyles.searchControls}>
          <Input
            allowClear
            placeholder={intl.formatMessage({ id: 'selectMember.searchPlaceholder' })}
            className={commonStyles.searchInput}
            suffix={<SearchOutlined onClick={() => loadKnowledgeBases(true)} />}
            onChange={(e) => {
              searchValue.current = trim(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                loadKnowledgeBases(true);
              }
            }}
          />
          {/* {editable && (
            <Tooltip title={intl.formatMessage({ id: 'knowledgeCenter.create' })}>
              <Button icon={<PlusOutlined />} onClick={() => setModalState({ openType: 'add' })} />
            </Tooltip>
          )} */}
          {/* {!agentId && ( */}
          {/* <Dropdown
            trigger={['click']}
            menu={{
              onClick: ({ key }) => setFilterType(key as unknown as FilterType),
              items: filterTypes.map((item) => ({
                key: item.key,
                label: <Radio checked={filterType === item.key}>{item.label}</Radio>,
              })),
            }}
          >
            <Button icon={<FilterOutlined />} />
          </Dropdown> */}
          {/* )} */}
        </div>
      </div>
      <InfiniteScrollAntdList
        className={employeeStyles.employeesList}
        dataSource={knowledgeBases}
        hasMore={hasMore}
        loading={loading}
        next={() => loadKnowledgeBases()}
        renderEmpty={
          <EmptyTips
            icon="️📘"
            title={intl.formatMessage({ id: 'knowledgeBaseModal.emptyTitle' })}
            description={intl.formatMessage({ id: 'knowledgeBaseModal.emptyDescription' })}
          />
        }
        renderItem={(item) => {
          const actions = [
            <Dropdown
              key={`detail-${item.resourceId}`}
              trigger={['hover']}
              overlayClassName={employeeStyles.mydropdown}
              menu={{
                items: [
                  {
                    key: 'quote',
                    label: (
                      <div className={employeeStyles.dropdownMenuItem}>
                        {intl.formatMessage({ id: 'common.quote' })}
                      </div>
                    ),
                  },
                  {
                    key: 'detail',
                    label: (
                      <div className={employeeStyles.dropdownMenuItem}>
                        {intl.formatMessage({ id: 'common.detail' })}
                      </div>
                    ),
                  },
                  {
                    key: 'share',
                    label: (
                      <div className={employeeStyles.dropdownMenuItem}>
                        {intl.formatMessage({ id: 'common.share' })}
                      </div>
                    ),
                  },
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.preventDefault();
                  domEvent.stopPropagation();
                  if (key === 'quote') {
                    handleQuoteKnowledgeBase(item);
                    return;
                  }
                  if (key === 'share') {
                    void handleShare(item);
                    return;
                  }
                  handleDetail(item);
                },
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <AntdIcon type="icon-a-Moregengduo" />
              </span>
            </Dropdown>,
          ];

          return (
            <Draggable key={item.resourceId} data={item}>
              <KnowledgeBaseListItem
                item={item}
                actions={actions}
                isUser={isUser}
                onClick={handleKnowledgeBaseItemClick}
                onDoubleClick={handleKnowledgeBaseItemDoubleClick}
              />
            </Draggable>
          );
        }}
      />
      {modalState.openType === 'add' && (
        <DetailPanel
          onOk={() => {
            loadKnowledgeBases(true);
            closeModal();
            moduleEventEmitter.emit('REFRESH_KNOWLEDGE_BASE');
          }}
          onCancel={closeModal}
        />
      )}
      {modalState.openType === 'share' && (
        <ShareModal
          onOk={() => {
            loadKnowledgeBases(true);
            closeModal();
            moduleEventEmitter.emit('REFRESH_KNOWLEDGE_BASE');
          }}
          onCancel={closeModal}
          info={modalState.info}
        />
      )}
      {shareModalOpen && (
        <AddAuthModal
          title={intl.formatMessage({ id: 'auth.addAuthObject' })}
          value={shareAuthList}
          showPost={false}
          onCancel={handleShareCancel}
          onOk={handleShareConfirm}
        />
      )}
      {modalState.openType === 'rename' && (
        <DetailPanel
          mode="edit"
          onOk={(newName) => {
            moduleEventEmitter.emit('REFRESH_KNOWLEDGE_BASE');
            setKnowledgeBases((prev) =>
              prev.map((i) =>
                i.resourceId === modalState.info!.resourceId ? { ...i, resourceName: newName || i.resourceName } : i
              )
            );
            closeModal();
          }}
          onCancel={closeModal}
          info={modalState.info}
        />
      )}
    </div>
  );
};

export default KnowledgeBaseList;
