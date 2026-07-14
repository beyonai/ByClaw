import React, { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import { Dropdown, Empty, Spin, Tooltip, Tree, type MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import AntdIcon from '@/components/AntdIcon';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import commonStyles from '../../Knowledge/components/common.module.less';
import type { FileBrowserItem } from '@/service/fileBrowser';
import type { FileTreeItem } from '../constants';
import {
  canPreviewFile,
  ensureDirectoryPath,
  getIconType,
  isDirectory,
  normalizeFileBrowserPath,
  sortFileBrowserItems,
} from '../utils';
import styles from '../index.module.less';

interface FileTreeListProps {
  items: FileBrowserItem[];
  childrenByPath: Record<string, FileBrowserItem[]>;
  expandedKeys: Key[];
  currentPath: string;
  loading: boolean;
  emptyText: React.ReactNode;
  onExpand: (keys: Key[]) => void;
  onLoadData: (node: FileTreeItem) => Promise<void>;
  onNodeClick: (event: React.MouseEvent, node: FileTreeItem) => void;
  onNodeDoubleClick: (item: FileTreeItem) => void;
  getActionItems: (item: FileBrowserItem) => MenuProps['items'];
  onAction: (key: Key, item: FileBrowserItem) => void;
}

function toFileTreeData(
  list: FileBrowserItem[],
  childrenByPath: Record<string, FileBrowserItem[]>,
  expandedDirectoryKeySet: Set<string>
): FileTreeItem[] {
  return sortFileBrowserItems(list).map((item) => {
    const dir = isDirectory(item);
    const directoryPath = ensureDirectoryPath(item.path);
    const expanded = dir && expandedDirectoryKeySet.has(directoryPath);
    return {
      ...item,
      key: dir ? directoryPath : item.path,
      title: <span>{item.name}</span>,
      isLeaf: !dir,
      className: expanded ? styles.treeNodeExpanded : undefined,
      children:
        dir && childrenByPath[directoryPath]
          ? toFileTreeData(childrenByPath[directoryPath], childrenByPath, expandedDirectoryKeySet)
          : undefined,
    };
  });
}

const FileTreeList: React.FC<FileTreeListProps> = ({
  items,
  childrenByPath,
  expandedKeys,
  currentPath,
  loading,
  emptyText,
  onExpand,
  onLoadData,
  onNodeClick,
  onNodeDoubleClick,
  getActionItems,
  onAction,
}) => {
  const [hoveredActionKey, setHoveredActionKey] = useState('');
  const [openActionKey, setOpenActionKey] = useState('');
  const closeActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeData = useMemo(() => {
    const expandedDirectoryKeySet = new Set(
      expandedKeys.map((key) => ensureDirectoryPath(normalizeFileBrowserPath(String(key))))
    );
    return toFileTreeData(items, childrenByPath, expandedDirectoryKeySet);
  }, [childrenByPath, expandedKeys, items]);

  const clearActionCloseTimer = useCallback(() => {
    if (closeActionTimerRef.current) {
      clearTimeout(closeActionTimerRef.current);
      closeActionTimerRef.current = null;
    }
  }, []);

  const keepActionOpen = useCallback(
    (actionKey: string) => {
      clearActionCloseTimer();
      setHoveredActionKey(actionKey);
      setOpenActionKey(actionKey);
    },
    [clearActionCloseTimer]
  );

  const closeActionLater = useCallback(
    (actionKey: string) => {
      clearActionCloseTimer();
      closeActionTimerRef.current = setTimeout(() => {
        setOpenActionKey((prev) => (prev === actionKey ? '' : prev));
        setHoveredActionKey((prev) => (prev === actionKey ? '' : prev));
      }, 180);
    },
    [clearActionCloseTimer]
  );

  useEffect(() => {
    return () => clearActionCloseTimer();
  }, [clearActionCloseTimer]);

  return (
    <div className={styles.categoryBody}>
      <Spin spinning={loading} wrapperClassName={styles.listSpin}>
        <div className={styles.treeScroll}>
          {treeData.length ? (
            <Tree.DirectoryTree
              showIcon
              selectable={false}
              treeData={treeData}
              expandedKeys={expandedKeys}
              onExpand={(keys, info) => {
                onExpand(keys);
                const item = info.node as unknown as FileTreeItem;
                const directoryPath = ensureDirectoryPath(normalizeFileBrowserPath(item.path));
                if (info.expanded && isDirectory(item) && childrenByPath[directoryPath]) {
                  void onLoadData(item);
                }
              }}
              loadData={(node) => onLoadData(node as unknown as FileTreeItem)}
              icon={(node) => {
                const item = node as unknown as FileTreeItem;
                const directoryExpanded =
                  isDirectory(item) && expandedKeys.includes(ensureDirectoryPath(normalizeFileBrowserPath(item.path)));
                const iconType = directoryExpanded
                  ? 'a-Folder-openwenjianjia-kai'
                  : getIconType(item.name, isDirectory(item));
                return (
                  <span>
                    <AntdIcon type={`icon-${iconType}`} />
                  </span>
                );
              }}
              className={`${commonStyles.tree} ${styles.fileTree}`}
              onClick={onNodeClick as any}
              onDoubleClick={(_, node) => onNodeDoubleClick(node as unknown as FileTreeItem)}
              titleRender={(item) => {
                const treeItem = item as FileTreeItem;
                const previewable = canPreviewFile(treeItem);
                const directoryExpanded =
                  isDirectory(treeItem) &&
                  expandedKeys.includes(ensureDirectoryPath(normalizeFileBrowserPath(treeItem.path)));
                const directoryCurrent =
                  isDirectory(treeItem) &&
                  ensureDirectoryPath(normalizeFileBrowserPath(treeItem.path)) ===
                    ensureDirectoryPath(normalizeFileBrowserPath(currentPath));
                const actionKey = `${treeItem.key || treeItem.path || ''}`;
                const actionVisible = hoveredActionKey === actionKey || openActionKey === actionKey;

                return (
                  <span
                    className={[
                      styles.treeTitleContent,
                      directoryExpanded ? styles.treeTitleContentExpanded : '',
                      directoryCurrent ? styles.treeTitleContentCurrent : '',
                      actionVisible ? styles.treeTitleContentActionVisible : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setHoveredActionKey(actionKey)}
                    onMouseLeave={() => {
                      if (openActionKey !== actionKey) {
                        setHoveredActionKey((prev) => (prev === actionKey ? '' : prev));
                      }
                    }}
                  >
                    <span
                      className={[styles.treeTitleName, previewable ? styles.previewableTreeTitle : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {/* 文件名提示放到上方，避免右侧浮层遮挡三个点操作按钮。 */}
                      <Tooltip title={item.name} placement="top">
                        <span className={styles.treeTitleText}>{item.name}</span>
                      </Tooltip>
                    </span>
                    <Dropdown
                      trigger={['hover']}
                      open={openActionKey === actionKey}
                      onOpenChange={(open) => {
                        if (open) {
                          keepActionOpen(actionKey);
                          return;
                        }
                        closeActionLater(actionKey);
                      }}
                      mouseEnterDelay={0}
                      mouseLeaveDelay={0.2}
                      overlayClassName={employeeStyles.mydropdown}
                      popupRender={(menus) => (
                        <div
                          onMouseEnter={() => keepActionOpen(actionKey)}
                          onMouseLeave={() => closeActionLater(actionKey)}
                        >
                          {menus}
                        </div>
                      )}
                      menu={{
                        items: getActionItems(treeItem),
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          clearActionCloseTimer();
                          setOpenActionKey('');
                          setHoveredActionKey('');
                          onAction(key, treeItem);
                        },
                      }}
                    >
                      <span
                        className={styles.treeActionTrigger}
                        onMouseEnter={() => keepActionOpen(actionKey)}
                        onMouseLeave={() => closeActionLater(actionKey)}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <EllipsisOutlined />
                      </span>
                    </Dropdown>
                  </span>
                );
              }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
          )}
        </div>
      </Spin>
    </div>
  );
};

export default FileTreeList;
