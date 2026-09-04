import React, { useMemo, type Key } from 'react';
import { Button, Dropdown, Empty, Popover, Spin, Tree, message, type MenuProps } from 'antd';
import { CopyOutlined, EllipsisOutlined } from '@ant-design/icons';
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
import { copyTextToClipboard } from '@/utils/copy';
import { useIntl } from '@umijs/max';

interface FileTreeListProps {
  items: FileBrowserItem[];
  childrenByPath: Record<string, FileBrowserItem[]>;
  expandedKeys: Key[];
  // 受控 loadedKeys：rc-tree 内部把加载过的 key 永久记进 loadedKeys 并据此跳过 loadData，
  // 不受控时刷新后无法重新拉子目录。传入后由调用方在缓存失效时摘掉对应 key。
  loadedKeys?: Key[];
  currentPath: string;
  loading: boolean;
  emptyText: React.ReactNode;
  // 项目资源等只读场景复用文件树时关闭三点操作，文件模块默认仍展示。
  showActions?: boolean;
  showItemMeta?: boolean;
  onExpand: (keys: Key[]) => void;
  onLoadData: (node: FileTreeItem) => Promise<void>;
  onNodeClick: (event: React.MouseEvent, node: FileTreeItem) => void;
  onNodeDoubleClick: (item: FileTreeItem) => void;
  getActionItems: (item: FileBrowserItem) => MenuProps['items'];
  onAction: (key: Key, item: FileBrowserItem) => void;
}

export const FilePathTooltip: React.FC<{ item: FileBrowserItem; children: React.ReactNode }> = ({ item, children }) => {
  const intl = useIntl();
  const handleCopy = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void copyTextToClipboard(item.path, () => message.success(intl.formatMessage({ id: 'fileBrowser.copy.success' })));
  };
  return (
    <Popover
      placement="right"
      align={{ offset: [50, 0] }}
      trigger="hover"
      overlayClassName={styles.filePathTooltipOverlay}
      content={
        <div className={styles.filePathTooltip}>
          <div className={styles.filePathTooltipName}>{item.name}</div>
          <div className={styles.filePathTooltipPathRow}>
            <span className={styles.filePathTooltipPath}>{item.path}</span>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              className={styles.filePathTooltipCopy}
              aria-label={intl.formatMessage({ id: 'common.copy' })}
              onClick={handleCopy}
            />
          </div>
        </div>
      }
    >
      {children}
    </Popover>
  );
};

function toFileTreeData(
  list: FileBrowserItem[],
  childrenByPath: Record<string, FileBrowserItem[]>,
  expandedDirectoryKeySet: Set<string>,
  ancestorDirectoryPaths: Set<string> = new Set()
): FileTreeItem[] {
  // 接口异常时可能把当前目录再次作为子节点返回；递归渲染前去重并阻断祖先路径，避免栈溢出。
  const seenPaths = new Set<string>();
  return sortFileBrowserItems(list)
    .filter((item) => {
      const path = normalizeFileBrowserPath(item.path);
      if (seenPaths.has(path)) return false;
      seenPaths.add(path);
      return true;
    })
    .map((item) => {
      const dir = isDirectory(item);
      const directoryPath = ensureDirectoryPath(item.path);
      const expanded = dir && expandedDirectoryKeySet.has(directoryPath);
      const nextAncestorPaths = new Set(ancestorDirectoryPaths);
      nextAncestorPaths.add(directoryPath);
      const childItems = dir && childrenByPath[directoryPath];
      return {
        ...item,
        key: dir ? directoryPath : item.path,
        title: <span>{item.name}</span>,
        isLeaf: !dir,
        className: expanded ? styles.treeNodeExpanded : undefined,
        children:
          childItems && !ancestorDirectoryPaths.has(directoryPath)
            ? toFileTreeData(childItems, childrenByPath, expandedDirectoryKeySet, nextAncestorPaths)
            : undefined,
      };
    });
}

const formatFileSize = (size?: number) => {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatFileUpdatedAt = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
      hour12: false,
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
};

const FileTreeList: React.FC<FileTreeListProps> = ({
  items,
  childrenByPath,
  expandedKeys,
  loadedKeys,
  currentPath,
  loading,
  emptyText,
  showActions = true,
  showItemMeta = true,
  onExpand,
  onLoadData,
  onNodeClick,
  onNodeDoubleClick,
  getActionItems,
  onAction,
}) => {
  const treeData = useMemo(() => {
    const expandedDirectoryKeySet = new Set(
      expandedKeys.map((key) => ensureDirectoryPath(normalizeFileBrowserPath(String(key))))
    );
    return toFileTreeData(items, childrenByPath, expandedDirectoryKeySet);
  }, [childrenByPath, expandedKeys, items]);

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
              // 只有调用方真的接管了 loadedKeys 才透传：rc-tree 用 props.hasOwnProperty
              // 判断受控，传 undefined 也会让它停止自己维护 loadedKeys，从而弄坏懒加载。
              {...(loadedKeys ? { loadedKeys } : {})}
              onExpand={(keys) => onExpand(keys)}
              loadData={(node) => onLoadData(node as unknown as FileTreeItem)}
              icon={(node) => {
                const item = node as unknown as FileTreeItem;
                const directoryExpanded =
                  isDirectory(item) && expandedKeys.includes(ensureDirectoryPath(normalizeFileBrowserPath(item.path)));
                const iconType = directoryExpanded
                  ? 'a-Folder-openwenjianjia-kai'
                  : getIconType(item.name, isDirectory(item));
                return (
                  <FilePathTooltip item={item}>
                    <span>
                      <AntdIcon type={`icon-${iconType}`} />
                    </span>
                  </FilePathTooltip>
                );
              }}
              className={`${commonStyles.tree} ${styles.fileTree} ${!showItemMeta ? styles.fileTreeNoMeta : ''}`}
              onClick={onNodeClick as any}
              onDoubleClick={(_, node) => onNodeDoubleClick(node as unknown as FileTreeItem)}
              titleRender={(item) => {
                const treeItem = item as FileTreeItem;
                const hasItemMeta =
                  showItemMeta &&
                  Boolean(
                    (item as any).updatedAt ||
                      (item as any).lastModified ||
                      (item as any).createStaffName ||
                      (item as any).size
                  );
                const previewable = canPreviewFile(treeItem);
                const directoryExpanded =
                  isDirectory(treeItem) &&
                  expandedKeys.includes(ensureDirectoryPath(normalizeFileBrowserPath(treeItem.path)));
                const directoryCurrent =
                  isDirectory(treeItem) &&
                  ensureDirectoryPath(normalizeFileBrowserPath(treeItem.path)) ===
                    ensureDirectoryPath(normalizeFileBrowserPath(currentPath));

                return (
                  <span
                    className={[
                      styles.treeTitleContent,
                      directoryExpanded ? styles.treeTitleContentExpanded : '',
                      directoryCurrent ? styles.treeTitleContentCurrent : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <FilePathTooltip item={item}>
                      <span
                        className={[styles.treeTitleName, previewable ? styles.previewableTreeTitle : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span className={styles.treeTitleText}>{item.name}</span>
                        {hasItemMeta ? (
                          <span className={styles.treeTitleMeta}>
                            {!isDirectory(item) && (
                              <>
                                {formatFileSize((item as any).size)}
                                <span>·</span>
                              </>
                            )}
                            {((item as any).updatedAt || (item as any).lastModified) && (
                              <span>{formatFileUpdatedAt((item as any).updatedAt || (item as any).lastModified)}</span>
                            )}
                            <span className={styles.treeTitleMetaPerson}>{(item as any).createStaffName || '-'}</span>
                          </span>
                        ) : null}
                      </span>
                    </FilePathTooltip>
                    {showActions && (
                      <Dropdown
                        trigger={['hover']}
                        overlayClassName={employeeStyles.mydropdown}
                        menu={{
                          items: getActionItems(treeItem),
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            onAction(key, treeItem);
                          },
                        }}
                      >
                        <span
                          className={`${commonStyles.treeActionIcon} ${styles.treeActionTrigger}`}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <EllipsisOutlined />
                        </span>
                      </Dropdown>
                    )}
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
