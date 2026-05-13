import React, { useContext, useState, useRef } from 'react';
import dayjs from 'dayjs';
import { useIntl } from '@umijs/max';
import { isEmpty, get, concat } from 'lodash';
import { List, Card, Typography, Space, Button, Dropdown, Collapse, Popconfirm, Spin, message } from 'antd';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import CaretRightOutlined from '@ant-design/icons/CaretRightOutlined';
import IconRender from '@/components/MessageList/components/FileRender/components/IconRender';

import usePreview from '@/components/MessageList/components/FileRender/components/Previewer/usePreview';
import Previewer from '@/components/MessageList/components/FileRender/components/Previewer';
import useDownload from '@/components/MessageList/components/FileRender/useDownload';

import { SearchAndQueryContext } from '@/pages/searchAndQuery';

import { getWorkspaceList, saveToShowcaseBatch, deleteWorkspace } from '@/service/session';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

const { Title, Text } = Typography;

// 文档项类型
type DocumentItem = {
  id: number;
  sessionId: number;
  name: string;
  relCount: number;
  createTime: string; // "2026-03-05 19:19:41"
  createBy: number;
  fileId: string;
  fileUrl: string;
  icon: null;
};

type CacheDocumentItem = DocumentItem & {
  timeAgo: string;
};

// 时间分组类型
interface TimeGroup {
  key: string;
  label: string;
  data: CacheDocumentItem[];
}

const DocumentItemHandler = (item: DocumentItem): CacheDocumentItem => {
  const now = dayjs();
  const createTime = dayjs(item.createTime);
  const diffMinutes = now.diff(createTime, 'minute');
  const diffHours = now.diff(createTime, 'hour');
  const diffDays = now.diff(createTime, 'day');
  const diffWeeks = now.diff(createTime, 'week');
  const diffMonths = now.diff(createTime, 'month');

  let timeAgo = '';

  if (diffMinutes < 1) {
    timeAgo = '刚刚';
  } else if (diffMinutes < 60) {
    timeAgo = `${diffMinutes}分钟前`;
  } else if (diffHours < 24) {
    timeAgo = `${diffHours}小时前`;
  } else if (diffDays < 7) {
    timeAgo = `${diffDays}天前`;
  } else if (diffWeeks < 4) {
    timeAgo = `${diffWeeks}周前`;
  } else if (diffMonths < 12) {
    timeAgo = `${diffMonths}个月前`;
  } else {
    const diffYears = now.diff(createTime, 'year');
    timeAgo = `${diffYears}年前`;
  }

  return {
    ...item,
    timeAgo,
  };
};

const timeGroupsHandler = (workspaceList: DocumentItem[]): TimeGroup[] => {
  // 先转换为带时间描述的文档项
  const cachedItems = workspaceList.map(DocumentItemHandler);

  // 按时间分组
  const groups: Record<string, CacheDocumentItem[]> = {
    recent: [], // 最近（今天）
    oneDay: [], // 昨天
    oneWeek: [], // 一周内
    oneMonth: [], // 一个月内
    halfYear: [], // 半年内
    oneYear: [], // 一年内
    older: [], // 更久
  };

  const now = dayjs();

  cachedItems.forEach((item) => {
    const createTime = dayjs(item.createTime);
    const diffDays = now.diff(createTime, 'day');
    const diffWeeks = now.diff(createTime, 'week');
    const diffMonths = now.diff(createTime, 'month');
    const diffYears = now.diff(createTime, 'year');

    if (diffDays < 1) {
      groups.recent.push(item);
    } else if (diffDays < 2) {
      groups.oneDay.push(item);
    } else if (diffWeeks < 1) {
      groups.oneWeek.push(item);
    } else if (diffMonths < 1) {
      groups.oneMonth.push(item);
    } else if (diffYears < 1) {
      groups.halfYear.push(item);
    } else {
      groups.older.push(item);
    }
  });

  // 构建 TimeGroup 数组
  const groupLabels: Record<string, string> = {
    recent: '最近生成',
    oneDay: '昨天',
    oneWeek: '一周内',
    oneMonth: '一个月内',
    halfYear: '半年内',
    oneYear: '一年内',
    older: '更久以前',
  };

  return Object.entries(groups).map(([key, data]) => ({
    key,
    label: groupLabels[key],
    data,
  }));
};

const RenderDocumentCard = (props: { item: CacheDocumentItem; onRemove: () => Promise<void> }) => {
  const { item, onRemove } = props;
  const { name } = item;

  const intl = useIntl();

  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fileType = name.split('.').pop() || '';

  const { onPreview, previewInfo, onClosePreviewModal } = usePreview();
  const { downloadFile } = useDownload();

  // 更多操作菜单项
  const menuItems = [
    {
      key: 'preview',
      label: '预览',
      onClick: () =>
        onPreview({
          uid: item.id.toString(),
          downloadUrl: item.fileUrl,
          status: 'done',
          fileType: 'file',
        }),
    },
    {
      key: 'download',
      label: '下载',
      onClick: () =>
        downloadFile({
          fileName: item.name,
          fileUrl: item.fileUrl,
        }),
    },
    {
      key: 'saveToCollect',
      label: '保存到收藏夹',
      onClick: () => {
        setIsLoading(true);
        saveToShowcaseBatch({ workspaceIds: [item.id.toString()] })
          .then(() => {
            message.error(intl.formatMessage({ id: 'common.saveSuccess' }));
          })
          .catch(() => {
            message.error(intl.formatMessage({ id: 'common.saveFailed' }));
          })
          .finally(() => {
            setIsLoading(false);
          });
      },
    },
    {
      key: 'delete',
      label: (
        <Popconfirm
          title="确认删除"
          description={`确定要删除 "${item.name}" 吗？`}
          onConfirm={() => {
            setIsLoading(true);

            onRemove().finally(() => {
              setIsLoading(false);
            });
          }}
          okText="确认"
          cancelText="取消"
          placement="bottomRight"
        >
          <div className={styles.deleteMenuItem}>删除</div>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <Spin spinning={isLoading}>
        <List.Item className={styles.listItem}>
          <Card className={styles.card} variant="borderless">
            <div className={styles.cardContent}>
              {/* 左侧图标 */}
              <div className={styles.iconWrapper}>
                <IconRender fileType={fileType} />
              </div>

              {/* 中间内容 */}
              <div className={styles.content}>
                <Text className={styles.title} ellipsis>
                  {item.name}
                </Text>
                <Space size={4} className={styles.meta}>
                  <Text type="secondary" className={styles.metaText}>
                    {item.relCount} 个来源
                  </Text>
                  <Text type="secondary" className={styles.metaDot}>
                    ·
                  </Text>
                  <Text type="secondary" className={styles.metaText}>
                    {item.timeAgo}
                  </Text>
                </Space>
              </div>

              {/* 右侧更多按钮 */}
              <Dropdown
                open={open && !isLoading}
                onOpenChange={(isOpen) => {
                  if (isLoading) return;
                  setOpen(isOpen);
                }}
                menu={{ items: menuItems }}
                placement="bottomRight"
                trigger={['click']}
              >
                <Button type="text" icon={<MoreOutlined className={styles.moreIcon} />} className={styles.moreButton} />
              </Dropdown>
            </div>
          </Card>
        </List.Item>
      </Spin>
      <Previewer
        previewInfo={previewInfo}
        onClosePreviewModal={onClosePreviewModal}
        fileType={fileType}
        fileName={name}
      />
    </>
  );
};

const WorkSpace = () => {
  const [collapseItems, setCollapseItems] = useState<TimeGroup[]>([]);
  // 默认展开所有面板
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { sessionId, EventEmitter } = useGlobal();
  const { setIsWorkSpaceCollapsed } = useContext(SearchAndQueryContext);

  const abortControllerRef = useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (sessionId) {
      setIsLoading(true);
      abortControllerRef.current = new AbortController();

      getWorkspaceList({ sessionId }, abortControllerRef.current)
        .then((res: DocumentItem[]) => {
          const l = timeGroupsHandler(res || []);
          setCollapseItems(l);
          setActiveKeys(l.map((item) => item.key));

          if (!isEmpty(res)) {
            setIsWorkSpaceCollapsed(false);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsWorkSpaceCollapsed(true);
    }

    return () => {
      setCollapseItems([]);
      setActiveKeys([]);
      if (abortControllerRef.current) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
      }
    };
  }, [sessionId]);

  React.useEffect(() => {
    const addDocumentItem = (items: DocumentItem[]) => {
      if (isEmpty(items)) return;

      const addTimeGroups = timeGroupsHandler(concat([], items));

      const addActiveKeys: string[] = [];

      setCollapseItems((prev: TimeGroup[]) => {
        return prev.map((group: TimeGroup, index: number) => {
          const data = get(addTimeGroups, `${index}.data`);
          if (!isEmpty(data)) {
            addActiveKeys.push(get(addTimeGroups, `${index}.key`));

            return {
              ...group,
              data: [...data, ...group.data],
            };
          }

          return group;
        });
      });

      setActiveKeys((prev: string[]) => {
        return [...new Set([...prev, ...addActiveKeys])];
      });
    };

    EventEmitter.on('beyond-workspace-add-documentitem', addDocumentItem);

    return () => {
      EventEmitter.off('beyond-workspace-add-documentitem', addDocumentItem);
    };
  }, [EventEmitter]);

  return (
    <div className={styles.workSpace}>
      {/* 固定标题区 */}
      <div className={styles.header}>
        <Title level={5} className={styles.mainTitle}>
          会话空间
        </Title>
      </div>

      {/* 可滚动内容区 */}
      <div className={styles.contentArea}>
        <Spin spinning={isLoading} wrapperClassName={styles.spin}>
          <Collapse
            activeKey={activeKeys}
            onChange={(keys) => setActiveKeys(keys as string[])}
            expandIcon={({ isActive }) => (
              <CaretRightOutlined rotate={isActive ? 90 : 0} className={styles.collapseIcon} />
            )}
            ghost
            className={styles.collapse}
          >
            {collapseItems.map((item) => {
              if (isEmpty(item.data)) return null;

              return (
                <Collapse.Panel key={item.key} header={item.label}>
                  <List
                    split={false}
                    className={styles.groupList}
                    dataSource={item.data}
                    renderItem={(childItem) => (
                      <RenderDocumentCard
                        key={childItem.id}
                        item={childItem}
                        onRemove={() => {
                          return deleteWorkspace({ id: childItem.id.toString() })
                            .then(() => {
                              setCollapseItems((prev: TimeGroup[]) => {
                                return prev.map((group: TimeGroup) => {
                                  if (group.key === item.key) {
                                    return {
                                      ...group,
                                      data: group.data.filter((i: CacheDocumentItem) => i.id !== childItem.id),
                                    };
                                  }

                                  return group;
                                });
                              });
                              message.success('删除成功');
                            })
                            .catch(() => {
                              message.error('删除失败');
                            });
                        }}
                      />
                    )}
                  />
                </Collapse.Panel>
              );
            })}
          </Collapse>
        </Spin>
      </div>
    </div>
  );
};

export default WorkSpace;
