import React, { useMemo, type Key } from 'react';
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
  // 项目资源等只读场景复用文件树时关闭三点操作，文件模块默认仍展示。
  showActions?: boolean;
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
  showActions = true,
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
                  <Tooltip title={item.name} placement="right">
                    <span>
                      <AntdIcon type={`icon-${iconType}`} />
                    </span>
                  </Tooltip>
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
                    <Tooltip title={item.name} placement="right">
                      <span
                        className={[styles.treeTitleName, previewable ? styles.previewableTreeTitle : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span className={styles.treeTitleText}>{item.name}</span>
                      </span>
                    </Tooltip>
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
