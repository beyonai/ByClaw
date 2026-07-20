import React, { useCallback, useEffect, useState, type Key } from 'react';
import { Segmented, Tooltip, type MenuProps } from 'antd';
import type { FileBrowserItem } from '@/service/fileBrowser';
import type { FileTreeItem } from '../constants';
import { isDirectory } from '../utils';
import FileTreeList from './FileTreeList';
import styles from '../index.module.less';

export interface FileSpaceGroup {
  key: Key;
  title: React.ReactNode;
  titleText?: string;
  currentPath: string;
  items: FileBrowserItem[];
  loading?: boolean;
  emptyText: React.ReactNode;
  count?: number;
}

interface FileSpaceBlockProps {
  title: React.ReactNode;
  count?: number;
  loading?: boolean;
  items?: FileBrowserItem[];
  currentPath?: string;
  emptyText: React.ReactNode;
  groups?: FileSpaceGroup[];
  childrenByPath: Record<string, FileBrowserItem[]>;
  expandedKeys: Key[];
  switchOptions?: { label: React.ReactNode; value: string }[];
  switchValue?: string;
  defaultGroupsCollapsed?: boolean;
  groupCollapseResetKey?: Key;
  showActions?: boolean;
  onSwitchChange?: (value: string) => void;
  onExpand: (keys: Key[]) => void;
  onLoadData: (node: FileTreeItem) => Promise<void>;
  onNodeClick?: (event: React.MouseEvent, node: FileTreeItem) => void;
  onNodeDoubleClick?: (item: FileTreeItem) => void;
  getActionItems?: (item: FileBrowserItem) => MenuProps['items'];
  onAction?: (key: Key, item: FileBrowserItem) => void;
}

export const getFileSpaceFileCount = (items: FileBrowserItem[] = []) =>
  items.filter((item) => !isDirectory(item)).length;

// 文件空间块复用文件模块目录树，供项目资源等只读场景展示会话/共享文件。
const FileSpaceBlock: React.FC<FileSpaceBlockProps> = ({
  title,
  count,
  loading = false,
  items = [],
  currentPath = '/',
  emptyText,
  groups,
  childrenByPath,
  expandedKeys,
  switchOptions,
  switchValue,
  defaultGroupsCollapsed = false,
  groupCollapseResetKey,
  showActions = false,
  onSwitchChange,
  onExpand,
  onLoadData,
  onNodeClick,
  onNodeDoubleClick,
  getActionItems,
  onAction,
}) => {
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const groupKeySignature = (groups || []).map((group) => `${group.key}`).join('\n');
  const noopActionItems = useCallback(() => [], []);
  const noopAction = useCallback(() => undefined, []);
  const noopNodeClick = useCallback(() => undefined, []);
  const noopNodeDoubleClick = useCallback(() => undefined, []);

  useEffect(() => {
    // 切换会话范围或分组数据变化时，按调用方指定的默认状态重置折叠状态。
    const groupKeys = groupKeySignature ? groupKeySignature.split('\n') : [];
    setCollapsedGroupKeys(defaultGroupsCollapsed ? new Set(groupKeys) : new Set());
  }, [defaultGroupsCollapsed, groupCollapseResetKey, groupKeySignature]);

  // 会话分组没有后端折叠状态，前端记录折叠 key，让整条标题行都能展开/收起。
  const toggleGroup = useCallback((groupKey: Key) => {
    const normalizedKey = `${groupKey}`;
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(normalizedKey)) {
        next.delete(normalizedKey);
      } else {
        next.add(normalizedKey);
      }
      return next;
    });
  }, []);

  const handleGroupKeyDown = useCallback(
    (groupKey: Key, event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleGroup(groupKey);
    },
    [toggleGroup]
  );

  const renderTree = (
    treeItems: FileBrowserItem[],
    treeCurrentPath: string,
    treeLoading: boolean,
    treeEmptyText: React.ReactNode
  ) => (
    <div className={styles.fileSpaceTreeWrap}>
      <FileTreeList
        items={treeItems}
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
        currentPath={treeCurrentPath}
        loading={treeLoading}
        emptyText={treeEmptyText}
        showActions={showActions}
        onExpand={onExpand}
        onLoadData={onLoadData}
        onNodeClick={onNodeClick || noopNodeClick}
        onNodeDoubleClick={onNodeDoubleClick || noopNodeDoubleClick}
        getActionItems={getActionItems || noopActionItems}
        onAction={onAction || noopAction}
      />
    </div>
  );

  return (
    <div className={styles.fileSpaceBlock}>
      <div className={styles.fileSpaceHeader}>
        <span className={styles.fileSpaceTitle}>{title}</span>
        {!!switchOptions?.length && (
          <Segmented
            size="small"
            value={switchValue}
            options={switchOptions}
            className={styles.fileSpaceSegmented}
            onChange={(value) => onSwitchChange?.(`${value}`)}
          />
        )}
        {typeof count === 'number' && <span className={styles.fileSpaceCount}>{count}</span>}
      </div>
      {groups ? (
        groups.length ? (
          <div className={styles.fileSpaceGroupList}>
            {groups.map((group) => {
              const isCollapsed = collapsedGroupKeys.has(`${group.key}`);

              return (
                <div
                  key={group.key}
                  className={`${styles.fileSpaceGroup} ${isCollapsed ? styles.fileSpaceGroupCollapsed : ''}`}
                >
                  <div
                    className={styles.fileSpaceGroupHeader}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGroup(group.key)}
                    onKeyDown={(event) => handleGroupKeyDown(group.key, event)}
                  >
                    <span className={styles.fileSpaceGroupArrow}>▾</span>
                    <Tooltip placement="top" title={group.titleText || group.title}>
                      <span className={styles.fileSpaceGroupTitle}>{group.title}</span>
                    </Tooltip>
                    {typeof group.count === 'number' && (
                      <span className={styles.fileSpaceGroupCount}>{group.count} 个文件</span>
                    )}
                  </div>
                  {!isCollapsed && renderTree(group.items, group.currentPath, !!group.loading, group.emptyText)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.fileSpaceEmpty}>{emptyText}</div>
        )
      ) : (
        renderTree(items, currentPath, loading, emptyText)
      )}
    </div>
  );
};

export default FileSpaceBlock;
