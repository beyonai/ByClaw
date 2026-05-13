/* eslint-disable indent */
import { SearchOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, List, Modal, Spin, Tooltip, message, theme, Radio } from 'antd';
import dayjs from 'dayjs';
import { trim, reverse } from 'lodash';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import { useIntl } from '@umijs/max';
import KnowledgeBreadcrumb from '../KnowledgeBreadcrumb';
import { getResourceListByPage, queryDirAndFileByLevel } from '@/service/knowledgeCenter';
import { ResourceTypeMap, FileUploadStatusMap, FileUploadStatusColors } from '@/constants/resource';
import { getRuntimeActualUrl } from '@/utils';
import { saveShowcaseToDoc } from '@/service/showcase';
import AntdIcon from '@/components/AntdIcon';
import EmptyTips from '@/components/EmptyTips';
import classnames from 'classnames';
import styles from './index.module.less';

interface KnowledgeBaseModalProps {
  open: boolean;
  onClose: () => void;
  value: { [fieldKey: string]: string }[];
  onOk: (value: { [fieldKey: string]: string }[]) => void;
  max?: number;
  fileTypes?: Array<'doc' | 'txt' | 'xlsx' | 'docx' | 'ppt' | 'pptx' | 'pdf' | 'md'>;
  isLimitStatus?: boolean;
  isAchievementSpace?: boolean;
  achievementId?: string | number;

  title?: string;
  mode?: string;
  ownershipType?: number;
}

type FloderPath = {
  title: string;
  href: string;
  path?: string;
  id?: string;

  /** 知识库 resourceId，用于 queryDirAndFileByLevel */
  resourceId?: number | string;
  type?: 'base' | 'directory' | 'file';
};

type ColumnsType = {
  title: string;
  dataIndex: string;
  render?: (text: any, record: { [fieldKey: string]: string }) => React.ReactNode;
};

interface ResourceItem {
  type: 'base' | 'directory' | 'file';
  name: string;
  path: string;
  time: string;
  id: string;
  [key: string]: any; // 兼容其他动态字段
  fileUploadState?: keyof typeof FileUploadStatusMap;
}
const KnowledgeBaseModal: React.FC<KnowledgeBaseModalProps> = (props) => {
  const intl = useIntl();
  const {
    open,
    onClose,
    value = [],
    onOk,
    max = 999999,
    isAchievementSpace = false,
    achievementId,
    title = intl.formatMessage({ id: 'knowledgeBaseModal.defaultTitle' }),
    mode = 'file',
    ownershipType = 3,
  } = props;
  const { isLimitStatus } = props;

  const [folderPath, setFolderPath] = useState<FloderPath[]>([
    {
      title: intl.formatMessage({ id: 'knowledgeBaseModal.allKnowledgeBases' }),
      href: '',
    },
  ]);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selectedItems, setSelectedItems] = useState<{ [fieldKey: string]: string }[]>(value);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [searchValue, setSearchValue] = React.useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const {
    token: { colorPrimary },
  } = theme.useToken();
  const pageSize = 20;
  const rootListFetchRef = useRef(false);

  const fetchRootData = async (reset = false) => {
    if (rootListFetchRef.current) return;
    rootListFetchRef.current = true;
    if (reset) {
      setLoading(true);
      setItems([]);
    }
    try {
      const currentPage = reset ? 1 : pageIndex;
      const searchValue$ = searchValue.trim();
      const payload = {
        pageSize,
        pageNum: currentPage,
      };
      const res = await getResourceListByPage({
        ...payload,
        resourceName: searchValue$,
        ownershipType,
        resourceTypeList: [ResourceTypeMap.knowledgeBase, ResourceTypeMap.knowledgeBaseQa],
        queryAll: true,
      });
      const rows = Array.isArray(res?.rows) ? res.rows : Array.isArray(res?.list) ? res.list : [];

      if (rows.length > 0) {
        // 处理根目录数据，设置为 base 类型
        const rootItems = rows.map((item: any) => ({
          type: 'base',
          name: item.resourceName,
          path: `/knowledge/${item.resourceSourcePkId}`,
          time: item.updateTime || item.createTime || '',
          id: item.resourceSourcePkId,
          ...item,
        }));
        if (reset) {
          setItems(rootItems || []);
        } else {
          setItems((prev) => [...prev, ...rootItems]);
        }
        setPageIndex(currentPage + 1);
        setHasMore(rows.length >= pageSize);
      } else {
        setHasMore(false);
        if (reset) {
          setItems([]);
        }
      }
    } catch (error) {
      console.error('获取根目录数据失败:', error);
      setHasMore(false);
      if (reset) {
        setPageIndex(1);
      }
    } finally {
      rootListFetchRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      rootListFetchRef.current = false;
      fetchRootData(true);
    }
  }, [open]);

  const isOnlyOneFile = max <= 1;

  // 获取子目录和文件数据
  const fetchChildrenData = async (item: any) => {
    setLoading(true);
    setHasMore(false);
    try {
      const kbResourceId = Number(
        item.type === 'base' ? item.resourceId : folderPath[1]?.resourceId ?? item.resourceId
      );
      const directoryPath =
        item.type === 'base'
          ? '/'
          : (() => {
              const p = String(item?.directoryPath ?? '').trim();
              return p ? (p.startsWith('/') ? p : `/${p}`) : '/';
            })();
      const res = await queryDirAndFileByLevel({
        resourceId: kbResourceId,
        directoryPath,
      });

      if (res) {
        const kw = searchValue.trim().toLowerCase();
        // 处理子目录和文件数据
        let childrenItems = (res || []).map((row: any) => ({
          type: row.type === 'file' ? 'file' : 'directory',
          name: row.name,
          path: `${folderPath[folderPath.length - 1]?.path || ''}/${row.name}`,
          time: row.updateTime || row.createTime || '',
          id: row.id,
          ...row,
        }));
        if (kw) {
          childrenItems = childrenItems.filter((it: ResourceItem) =>
            String(it.name ?? '')
              .toLowerCase()
              .includes(kw)
          );
        }
        return childrenItems;
      }
      return [];
    } catch (error) {
      console.error('获取子目录数据失败:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType[] = [
    {
      dataIndex: 'name',
      title: intl.formatMessage({ id: 'common.fileName' }),
      render: (v: string, record: any) => {
        let iconType = '';
        if (/\.(doc|docx)$/.test(v)) {
          iconType = 'Word';
        } else if (v?.endsWith('.pdf')) {
          iconType = 'PDF';
        } else if (/\.(xls|xlsx)$/.test(v)) {
          iconType = 'Excel';
        } else if (v?.endsWith('.txt')) {
          iconType = 'jishiben';
        } else if (v?.endsWith('.ppt')) {
          iconType = 'PPT';
        } else if (/\.(png|jpg|jpeg)$/.test(v)) {
          iconType = 'Image';
        } else if (record.type === 'directory') {
          iconType = 'wenjianjia';
        }

        return (
          <div style={{ display: 'flex', alignItems: 'center', columnGap: 12, width: '100%' }}>
            {(() => {
              let iconElement;
              if (record.type === 'base') {
                if (record.resourceLogoUrl) {
                  iconElement = <img src={getRuntimeActualUrl(`/byaiService${record.resourceLogoUrl}`)} alt="" />;
                } else {
                  iconElement = <AntdIcon type="icon-a-Book-oneshuji12" style={{ color: colorPrimary }} />;
                }
              } else {
                iconElement = <AntdIcon type={`icon-${iconType}`} style={{ fontSize: 24, marginRight: 14 }} />;
              }

              return iconElement;
            })()}

            <Tooltip title={v}>
              <div className="textEllipsis">{v}</div>
            </Tooltip>
          </div>
        );
      },
    },
    {
      dataIndex: 'time',
      title: intl.formatMessage({ id: 'common.updateTime' }),
      render: (text: string | number) => {
        if (!text) return '';

        let t = '';

        if (isNaN(Number(text))) {
          t = String(text);
        } else {
          t = dayjs(Number(text)).format('YYYY-MM-DD HH:mm:ss');
        }

        return <div style={{ color: '#707680' }}>{t}</div>;
      },
    },
    // 只有当不在根目录时才显示构建状态列
    ...(folderPath.length !== 1
      ? [
          {
            dataIndex: 'fileUploadState',
            title: intl.formatMessage({ id: 'knowledgeBaseModal.buildStatus' }),
            render: (_: any, record: any) => {
              // 确保只有文件类型才显示状态，文件夹不显示
              if (record.type !== 'file') {
                return null;
              }
              return (
                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: FileUploadStatusColors[record.fileUploadState] || '#d9d9d9',
                      marginRight: 8,
                    }}
                  />
                  <span>{(FileUploadStatusMap as any)[record.fileUploadState] || ''}</span>
                </div>
              );
            },
          },
        ]
      : []),
  ];

  const handleClick = async (item: any) => {
    // 如果是目录或知识库，加载其子项
    if (item.type === 'base' || item.type === 'directory') {
      setLoading(true);
      try {
        const childrenItems = await fetchChildrenData(item);

        // 更新当前显示的项目
        setItems(childrenItems);
        // 更新面包屑路径
        setFolderPath((prev) => [
          ...prev,
          {
            ...item,
            title: item.name,
            href: item.path,
            id: item.id,
          },
        ]);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleBreadcrumbClick = async (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);

    // 根据新路径更新items
    if (index === 0) {
      // 返回根目录
      await fetchRootData(true);
    } else {
      // 返回到指定层级
      setLoading(true);
      try {
        const currentItem = newPath[newPath.length - 1];
        const childrenItems = await fetchChildrenData(currentItem);
        setItems(childrenItems);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleCheck = (obj: { [fieldKey: string]: string }, checked: boolean) => {
    if (checked) {
      if (!selectedItems.some((item) => item.id === obj.id)) {
        if (max === 1) {
          setSelectedItems((p) => reverse([...p, obj]).slice(0, max));
        } else {
          setSelectedItems((p) => [...p, obj].slice(0, max));
        }
      }
    } else {
      setSelectedItems((p) => p.filter((item) => item.id !== obj.id));
    }
  };

  const handleOk = async () => {
    if (isAchievementSpace) {
      if (!selectedItems.length) {
        message.warning(intl.formatMessage({ id: 'knowledgeBaseModal.selectFileToSave' }));
        return;
      }
      if (!achievementId) {
        message.warning(intl.formatMessage({ id: 'knowledgeBaseModal.achievementNotFound' }));
        return;
      }
      const target = selectedItems[0];
      const datasetId = target?.datasetId || target?.resourceSourcePkId;
      if (!datasetId) {
        message.warning(intl.formatMessage({ id: 'knowledgeBaseModal.datasetNotFound' }));
        return;
      }
      const fileCollectId = target?.fileCollectId ?? '-1';
      const datasetType = '4';
      try {
        setConfirmLoading(true);
        await saveShowcaseToDoc({
          datasetId: `${datasetId}`,
          datasetType,
          id: `${achievementId}`,
          metadata: JSON.stringify({
            datasetId: `${datasetId}`,
            fileCollectId: `${fileCollectId}`,
            datasetType,
          }),
        });
        message.success(intl.formatMessage({ id: 'knowledgeBaseModal.savedToKnowledgeBase' }));
        onOk(selectedItems);
      } catch (error) {
        console.error('保存成果到知识库失败:', error);
        message.error(intl.formatMessage({ id: 'common.saveFailed' }));
      } finally {
        setConfirmLoading(false);
      }
      return;
    }
    onOk(selectedItems);
  };

  const handleSearch = async () => {
    // 如果在根目录，使用全局搜索
    if (folderPath.length === 1) {
      await fetchRootData(true);
    } else {
      // 如果在子目录层级，使用当前目录搜索
      const currentItem = folderPath[folderPath.length - 1];
      if (currentItem.type === 'base' || currentItem.type === 'directory') {
        setLoading(true);
        try {
          const childrenItems = await fetchChildrenData(currentItem);
          setItems(childrenItems);
        } finally {
          setLoading(false);
        }
      }
    }
  };

  const getSelectableItems = (items: ResourceItem[]) => {
    return items.filter((item) => item.type === 'file' && `${item.fileUploadState}` === '3');
  };

  const canSelectItem = useCallback(
    (item: ResourceItem) => {
      if (mode === 'knowledgeBase') {
        return item.type === 'base';
      }
      return item.type === 'file' && (!isLimitStatus || `${item.fileUploadState}` === '3');
    },
    [isLimitStatus]
  );

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      footer={
        <div className="ub ub-pj ub-ac">
          <div className="ub ub-ac" style={{ columnGap: 12 }}>
            {!isOnlyOneFile && (
              <Checkbox
                checked={
                  getSelectableItems(items).length > 0 &&
                  selectedItems.filter((item) => items.find((obj) => item.id === obj.id)).length === items.length
                }
                indeterminate={selectedItems.length > 0}
                onChange={(e) => {
                  if (e.target.checked) {
                    const selectableItems = getSelectableItems(items);
                    setSelectedItems(
                      [
                        ...selectedItems.filter((item) => !selectableItems.find((i) => item.id === i.id)),
                        ...selectableItems,
                      ].slice(0, max)
                    );
                  } else {
                    const selectableItems = getSelectableItems(items);
                    setSelectedItems(selectedItems.filter((item) => !selectableItems.find((i) => item.id === i.id)));
                  }
                }}
              />
            )}
            {intl.formatMessage({ id: 'knowledgeBaseModal.selectedFiles' }, { count: selectedItems.length })}
          </div>
          <div>
            <Button onClick={onClose}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            <Button style={{ marginLeft: 8 }} type="primary" onClick={handleOk} loading={confirmLoading}>
              {intl.formatMessage({ id: 'knowledgeBaseModal.confirmAdd' }, { count: selectedItems.length })}
            </Button>
          </div>
        </div>
      }
      width={680}
      centered
      destroyOnHidden
      styles={{
        body: {
          height: '70vh',
          minHeight: '520px',
          maxHeight: '680px',
        },
      }}
    >
      <div className={styles.container}>
        <Input
          allowClear
          placeholder={intl.formatMessage({ id: 'knowledgeBaseModal.searchFile' })}
          value={searchValue}
          suffix={<SearchOutlined onClick={handleSearch} />}
          onChange={(e) => {
            setSearchValue(trim(e.target.value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSearch();
            }
          }}
          style={{ marginTop: 16 }}
        />
        <div className={styles.breadcrumb}>
          <KnowledgeBreadcrumb folderPath={folderPath} handleBreadcrumbClick={handleBreadcrumbClick} />
        </div>
        <div className={classnames(styles.tableHeader, { [styles.tableHeaderBase]: folderPath.length === 1 })}>
          <div className={styles.tableSelect} />
          {columns.map((item, key) => (
            <div className={styles.th} key={key}>
              {item.title}
            </div>
          ))}
        </div>
        {loading && (
          <div className="ub ub-ac ub-pc ub-f1" style={{ height: '400px' }}>
            <Spin spinning />
          </div>
        )}
        {!loading && (
          <div
            className={classnames(styles.tableBody, { [styles.tableBodyBase]: folderPath.length === 1 })}
            id="knowledgeBaseScrollableDiv"
          >
            <InfiniteScroll
              dataLength={items.length}
              next={() => {
                fetchRootData();
              }}
              hasMore={hasMore}
              loader={
                <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
                  <Spin />
                </div>
              }
              endMessage=""
              scrollableTarget="knowledgeBaseScrollableDiv"
              scrollThreshold="10px"
              hasChildren={items.length > 0}
              height={440}
            >
              <List
                dataSource={items}
                locale={{
                  emptyText: (
                    <EmptyTips
                      icon="️📘"
                      title={intl.formatMessage({ id: 'knowledgeBaseModal.emptyTitle' })}
                      description={intl.formatMessage({ id: 'knowledgeBaseModal.emptyDescription' })}
                    />
                  ),
                }}
                renderItem={(item, index) => (
                  <List.Item
                    key={index}
                    onClick={(e) => {
                      e.stopPropagation();

                      if (mode === 'knowledgeBase') {
                        if (item.type === 'base') {
                          const isSelected = selectedItems.some((selectedItem) => selectedItem.id === item.id);
                          handleCheck(item, !isSelected);
                        }
                      }
                      if (mode === 'file') {
                        if (item.type === 'base' || item.type === 'directory') {
                          handleClick(item);
                        }
                        if (canSelectItem(item)) {
                          const isSelected = selectedItems.some((selectedItem) => selectedItem.id === item.id);
                          handleCheck(item, !isSelected);
                        }
                      }
                    }}
                    className={classnames(styles.listItem, {
                      [styles.listItemBase]: item.type === 'base' || item.type === 'directory' || canSelectItem(item),
                    })}
                  >
                    <div className={styles.tableSelect}>
                      {((mode === 'knowledgeBase' && item.type === 'base') ||
                        (mode === 'file' && item.type === 'file')) && (
                        <>
                          {isOnlyOneFile && (
                            <Radio
                              checked={!!selectedItems?.find((i) => i.id === item.id)}
                              disabled={!canSelectItem(item)} // 只有构建成功才能选择
                            />
                          )}
                          {!isOnlyOneFile && (
                            <Checkbox
                              checked={!!selectedItems?.find((i) => i.id === item.id)}
                              disabled={!canSelectItem(item)} // 只有构建成功才能选择
                            />
                          )}
                        </>
                      )}
                    </div>
                    {columns.map((column, index) => (
                      <div className={styles.tr} key={index}>
                        {column?.render ? column?.render(item[column.dataIndex], item) : item[column.dataIndex]}
                      </div>
                    ))}
                  </List.Item>
                )}
              />
            </InfiniteScroll>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default KnowledgeBaseModal;
