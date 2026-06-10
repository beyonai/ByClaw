import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Dropdown, List, theme, App, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { trim, get, isEmpty, intersection, debounce } from 'lodash';
import { useIntl, useNavigate, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import DetailPanel from '@/pages/knowledgeCenter/components/DetailPanel';
import ShareModal from '@/pages/knowledgeCenter/components/shareModal';
import { getRuntimeActualUrl } from '@/utils';
import withDrag, { DragType, IDragType } from '@/components/QueryInput/withDrag';
import { deleteKnowledge } from '@/pages/manager/service/resources';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import { IKnowledgeBaseItem } from './types';
import InfiniteScrollAntdList from '../../../InfiniteScrollAntdList';
import commonStyles from '../common.module.less';
import EmptyTips from '@/components/EmptyTips';
import useModuleEvent from '@/hooks/useModuleEvent';
import { isTopAgent } from '@/service/digitalEmployees';
import useGlobal from '@/hooks/useGlobal';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import styles from './index.module.less';

const { Title, Paragraph } = Typography;

interface KnowledgeBaseListProps {
  editable?: boolean;
  onSelect?: (item: IKnowledgeBaseItem, type: IDragType) => void;
  onDrilldown: (item: IKnowledgeBaseItem) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
  activeAgentResourceId?: string;
}

const Draggable = withDrag(DragType.knowledgeBase);

const KnowledgeBaseList = (props: KnowledgeBaseListProps) => {
  const { editable, onDrilldown, keyword, activeAgentResourceId } = props;
  const searchValue = useRef('');
  const listFetchRef = useRef(false);
  // const [filterType, setFilterType] = useState<FilterType>(FilterType.all);
  const [loading, setLoading] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [modalState, setModalState] = useState<{
    openType: '' | 'add' | 'rename' | 'share';
    info?: IKnowledgeBaseItem;
  }>({ openType: '' });
  const navigate = useNavigate();
  const { EventEmitter } = useGlobal();
  const { modal, message } = App.useApp();
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const usersOrganizations = get(userInfo, 'usersOrganizations') || [];
  const userTypeList = usersOrganizations.map((item: any) => item.userType);
  const isUser = isEmpty(intersection(userTypeList, ['PLAT_MAN', 'PLAT_DEVOPS']));

  const intl = useIntl();
  const {
    token: { colorPrimary },
  } = theme.useToken();
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

  // 每行菜单项
  const getDropdownMenuItems = (item: IKnowledgeBaseItem) => {
    const items = [];
    if (isUser) {
      if (`${item.isTop}` === '1') {
        items.push({ key: 'unpin', label: intl.formatMessage({ id: 'common.unpin' }) });
      }
      if (`${item.isTop}` === '0') {
        items.push({ key: 'pin', label: intl.formatMessage({ id: 'common.pin' }) });
      }
    }

    if (`${item?.createBy}` === `${userInfo.userId}`) {
      items.push(
        { key: 'detail', label: intl.formatMessage({ id: 'knowledgeDetail.detail' }) },
        { key: 'rename', label: intl.formatMessage({ id: 'directoryManage.rename' }) },
        { key: 'delete', label: intl.formatMessage({ id: 'common.delete' }) }
      );
    }
    return items;
  };

  // 置顶：将该条移动到第一条
  function onPin(resourceId: string) {
    if (!resourceId) return;
    setKnowledgeBases((prev) => {
      const newList = [...prev];
      const idx = newList.findIndex((i) => i.resourceId === resourceId);
      if (idx !== -1) {
        const target = { ...newList[idx], isTop: '1' };
        newList.splice(idx, 1);
        newList.unshift(target);
      }
      return newList;
    });
  }

  // 取消置顶：将该条移动到所有置顶之后、非置顶之前（成为非置顶的第一条）
  function onUnpin(resourceId: string) {
    if (!resourceId) return;
    setKnowledgeBases((prev) => {
      const newList = [...prev];
      const idx = newList.findIndex((i) => i.resourceId === resourceId);
      if (idx !== -1) {
        const target = { ...newList[idx], isTop: '0' };
        newList.splice(idx, 1);
        const firstNonTopIndex = newList.findIndex((i) => `${i.isTop}` === '0');
        if (firstNonTopIndex === -1) {
          newList.push(target);
        } else {
          newList.splice(firstNonTopIndex, 0, target);
        }
      }
      return newList;
    });
  }

  const onRowMenuItemClick = useCallback((key: string, item: IKnowledgeBaseItem) => {
    if (key === 'detail') {
      const param = {
        resourceId: item.resourceId,
        resourceBizType: item.resourceBizType,
        resourceSourcePkId: item.resourceSourcePkId,
      };
      const query = Object.entries(param).reduce((s, [K, v]) => `${s}${s ? '&' : '?'}${K}=${v}`, '');
      navigate(`/knowledgeDetail${query}`);
    } else if (key === 'rename') {
      setModalState({
        openType: 'rename',
        info: item,
      });
    } else if (key === 'share') {
      setModalState({
        openType: 'share',
        info: item,
      });
    } else if (key === 'delete') {
      const optResourceId = item.resourceId;
      modal.confirm({
        title: intl.formatMessage({ id: 'common.deleteTips' }),
        content: item.resourceName,
        onOk: () =>
          new Promise<void>((resolve) => {
            deleteKnowledge({
              resourceId: optResourceId,
            })
              .then(() => {
                message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
                setKnowledgeBases((prev) => prev.filter((i) => i.resourceId !== optResourceId));
                moduleEventEmitter.emit('REFRESH_KNOWLEDGE_BASE');
              })
              .finally(resolve);
          }),
      });
    } else if (key === 'unpin' || key === 'pin') {
      isTopAgent({
        agentIds: [item.resourceId],
        isTop: key === 'pin' ? 1 : 0,
        agentTypeList: [item.resourceBizType],
      }).then(() => {
        if (key === 'pin') {
          onPin(item.resourceId);
        } else {
          onUnpin(item.resourceId);
        }
      });
    }
  }, []);

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
          const canEditItem = editable && (`${item?.createBy}` === `${userInfo.userId}` || isUser);
          const actions = [
            <Dropdown
              key={`detail-${item.resourceId}`}
              trigger={['hover']}
              overlayClassName={employeeStyles.mydropdown}
              menu={{
                items: [
                  {
                    key: 'detail',
                    label: (
                      <div className={employeeStyles.dropdownMenuItem}>
                        {intl.formatMessage({ id: 'common.detail' })}
                      </div>
                    ),
                  },
                  ...(canEditItem ? getDropdownMenuItems(item) : []),
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.preventDefault();
                  domEvent.stopPropagation();

                  if (key === 'detail') {
                    onDrilldown(item);
                    return;
                  }

                  onRowMenuItemClick(key, item);
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
              <List.Item
                key={item.resourceId}
                className={styles.knowledgeItem}
                actions={actions}
                onDoubleClick={() => handleQuoteKnowledgeBase(item)}
              >
                <List.Item.Meta
                  title={
                    <Title className={employeeStyles.name}>
                      <span className={employeeStyles.nameRow} title={item.resourceName}>
                        <span className={employeeStyles.nameText}>{item.resourceName}</span>
                        {`${item?.isTop}` === '1' && isUser && (
                          <AntdIcon type="icon-zhiding-fill" className={employeeStyles.pinBadge} />
                        )}
                      </span>
                    </Title>
                  }
                  description={
                    <Paragraph
                      className={employeeStyles.description}
                      ellipsis={{ tooltip: { title: item.resourceDesc, placement: 'right' } }}
                    >
                      {item.resourceDesc}
                    </Paragraph>
                  }
                  avatar={
                    item.resourceLogoUrl ? (
                      <img
                        className={styles.avatar}
                        src={getRuntimeActualUrl(`/byaiService${item.resourceLogoUrl}`)}
                        alt=""
                      />
                    ) : (
                      <span className={styles.defaultAvatar}>
                        <AntdIcon type="icon-a-Book-oneshuji12" style={{ color: colorPrimary }} />
                      </span>
                    )
                  }
                />
              </List.Item>
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
