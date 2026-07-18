import React, { useCallback, type Key } from 'react';
import { Segmented, Tooltip } from 'antd';
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
  onSwitchChange?: (value: string) => void;
  onExpand: (keys: Key[]) => void;
  onLoadData: (node: FileTreeItem) => Promise<void>;
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
  onSwitchChange,
  onExpand,
  onLoadData,
}) => {
  const noopActionItems = useCallback(() => [], []);
  const noopAction = useCallback(() => undefined, []);
  const noopNodeClick = useCallback(() => undefined, []);
  const noopNodeDoubleClick = useCallback(() => undefined, []);

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
        showActions={false}
        onExpand={onExpand}
        onLoadData={onLoadData}
        onNodeClick={noopNodeClick}
        onNodeDoubleClick={noopNodeDoubleClick}
        getActionItems={noopActionItems}
        onAction={noopAction}
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
            {groups.map((group) => (
              <div key={group.key} className={styles.fileSpaceGroup}>
                <div className={styles.fileSpaceGroupHeader}>
                  <span className={styles.fileSpaceGroupArrow}>▾</span>
                  <Tooltip placement="top" title={group.titleText || group.title}>
                    <span className={styles.fileSpaceGroupTitle}>{group.title}</span>
                  </Tooltip>
                  {typeof group.count === 'number' && (
                    <span className={styles.fileSpaceGroupCount}>{group.count} 个文件</span>
                  )}
                </div>
                {renderTree(group.items, group.currentPath, !!group.loading, group.emptyText)}
              </div>
            ))}
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
