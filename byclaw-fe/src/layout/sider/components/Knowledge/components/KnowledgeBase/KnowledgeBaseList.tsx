import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Input, Button, Radio, Dropdown, List, theme, App, Tooltip, Typography } from 'antd';
import { PlusOutlined, FilterOutlined, SearchOutlined } from '@ant-design/icons';
import { trim, get, isEmpty, intersection, debounce } from 'lodash';
import { useIntl, useNavigate, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import DetailPanel from '@/pages/knowledgeCenter/components/DetailPanel';
import ShareModal from '@/pages/knowledgeCenter/components/shareModal';
import { getRuntimeActualUrl } from '@/utils';
import withDrag, { DragType, IDragType } from '@/components/QueryInput/withDrag';
import { deleteKnowledge } from '@/pages/manager/service/resources';
import { queryAuthDoc } from '@/service/knowledgeCenter';
import { IKnowledgeBaseItem } from './types';
import InfiniteScrollAntdList from '../../../InfiniteScrollAntdList';
import commonStyles from '../common.module.less';
import EmptyTips from '@/components/EmptyTips';
import useModuleEvent from '@/hooks/useModuleEvent';
import { isTopAgent } from '@/service/digitalEmployees';
import styles from './index.module.less';

const { Paragraph } = Typography;

interface KnowledgeBaseListProps {
  editable?: boolean;
  onSelect?: (item: IKnowledgeBaseItem, type: IDragType) => void;
  onDrilldown: (item: IKnowledgeBaseItem) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
}

/** 筛选：all 不传 ownerType；shared→企业 enterprise；private→个人 personal */
enum FilterType {
  all = 'all',
  shared = 'shared',
  private = 'private',
}

type ResourceCatalogMain = 'enterprise' | 'personal';

const Draggable = withDrag(DragType.knowledgeBase);

const KnowledgeBaseList = (props: KnowledgeBaseListProps) => {
  const { editable, onSelect, onDrilldown, keyword } = props;
  const searchValue = useRef('');
  const listFetchRef = useRef(false);
  const [filterType, setFilterType] = useState<FilterType>(FilterType.all);
  const [loading, setLoading] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [modalState, setModalState] = useState<{
    openType: '' | 'add' | 'rename' | 'share';
    info?: IKnowledgeBaseItem;
  }>({ openType: '' });
  const navigate = useNavigate();
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

  const filterTypes = useMemo(
    () => [
      { key: FilterType.all, label: intl.formatMessage({ id: 'dialogueRecord.all' }) },
      { key: FilterType.shared, label: intl.formatMessage({ id: 'knowledgeCenter.shared' }) },
      { key: FilterType.private, label: intl.formatMessage({ id: 'knowledgeCenter.myCreation' }) },
    ],
    [intl]
  );

  // 获取知识库列表
  const loadKnowledgeBases = async (reset = false) => {
    if (listFetchRef.current) return;
    listFetchRef.current = true;
    if (reset) {
      setLoading(true);
    }
    try {
      const payload: {
        pageNum: number;
        pageSize: number;
        keyword: string;
        type: string;
        ownerType?: ResourceCatalogMain;
      } = {
        pageNum: 1,
        pageSize: 100,
        keyword: searchValue.current.trim(),
        type: 'all',
      };
      if (filterType === FilterType.shared) {
        payload.ownerType = 'enterprise';
      } else if (filterType === FilterType.private) {
        payload.ownerType = 'personal';
      }
      const response = await queryAuthDoc(payload);
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
  };

  // 初始加载
  useEffect(() => {
    loadKnowledgeBases(true);
  }, [filterType]);

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
          {editable && (
            <Tooltip title={intl.formatMessage({ id: 'knowledgeCenter.create' })}>
              <Button icon={<PlusOutlined />} onClick={() => setModalState({ openType: 'add' })} />
            </Tooltip>
          )}
          {/* {!agentId && ( */}
          <Dropdown
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
          </Dropdown>
          {/* )} */}
        </div>
      </div>
      <InfiniteScrollAntdList
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
            <AntdIcon
              key={`open-${item.resourceId}`}
              type="icon-a-Folder-openwenjianjia-kai"
              onClick={(e) => {
                e.stopPropagation();
                onDrilldown(item);
              }}
            />,
          ];
          if (editable && (`${item?.createBy}` === `${userInfo.userId}` || isUser)) {
            actions.push(
              <Dropdown
                key={`actions-${item.resourceId}`}
                trigger={['click']}
                menu={{
                  items: getDropdownMenuItems(item),
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    onRowMenuItemClick(key, item);
                  },
                }}
              >
                <span onClick={(e) => e.stopPropagation()}>
                  <AntdIcon type="icon-a-Setting-configshezhipeizhi" />
                </span>
              </Dropdown>
            );
          }
          return (
            <Draggable key={item.resourceId} data={item}>
              <List.Item
                key={item.resourceId}
                actions={actions}
                onClick={() => onSelect?.(item, DragType.knowledgeBase)}
              >
                <List.Item.Meta
                  title={
                    <div className="textEllipsis" title={item.resourceName}>
                      <span className={styles.nameText}>{item.resourceName}</span>
                      {`${item?.isTop}` === '1' && isUser && (
                        <AntdIcon type="icon-zhiding-fill" className={styles.pinBadge} />
                      )}
                    </div>
                  }
                  description={
                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                      {item.resourceDesc}
                    </Paragraph>
                  }
                  avatar={
                    item.resourceLogoUrl ? (
                      <img src={getRuntimeActualUrl(`/byaiService${item.resourceLogoUrl}`)} alt="" />
                    ) : (
                      <AntdIcon type="icon-a-Book-oneshuji12" style={{ color: colorPrimary }} />
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
