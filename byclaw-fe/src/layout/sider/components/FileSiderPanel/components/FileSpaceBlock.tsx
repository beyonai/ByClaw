import React, { useCallback, useEffect, useState, type Key } from 'react';
import { Empty, Segmented, Tooltip, type MenuProps } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
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
  headerExtra?: React.ReactNode;
  contentBefore?: React.ReactNode;
  alternateContent?: React.ReactNode;
  showAlternateContent?: boolean;
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
  // 外层已有统一工具栏时隐藏自身标题栏，避免同一文件列表重复出现卡片头部。
  hideHeader?: boolean;
  compactTreePadding?: boolean;
  fillContainer?: boolean;
  resourceEmptyStyle?: boolean;
  defaultGroupsCollapsed?: boolean;
  accordionGroups?: boolean;
  groupCollapseResetKey?: Key;
  showActions?: boolean;
  onRefresh?: () => void;
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
  headerExtra,
  contentBefore,
  alternateContent,
  showAlternateContent = false,
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
  hideHeader = false,
  compactTreePadding = false,
  fillContainer = false,
  resourceEmptyStyle = false,
  defaultGroupsCollapsed = false,
  accordionGroups = false,
  groupCollapseResetKey,
  showActions = false,
  onRefresh,
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

  // 会话分组没有后端折叠状态；手风琴模式展开一项时，将其它分组一并折叠。
  const toggleGroup = useCallback(
    (groupKey: Key) => {
      const normalizedKey = `${groupKey}`;
      setCollapsedGroupKeys((prev) => {
        const next = new Set(prev);
        if (next.has(normalizedKey)) {
          if (accordionGroups) {
            const groupKeys = groupKeySignature ? groupKeySignature.split('\n') : [];
            return new Set(groupKeys.filter((key) => key !== normalizedKey));
          }
          next.delete(normalizedKey);
          return next;
        }
        next.add(normalizedKey);
        return next;
      });
    },
    [accordionGroups, groupKeySignature]
  );

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
    <div className={`${styles.fileSpaceTreeWrap} ${compactTreePadding ? styles.fileSpaceTreeWrapCompact : ''}`}>
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
    <div
      className={[
        styles.fileSpaceBlock,
        // 成果抽屉需要由文件树承接剩余高度，避免复用组件默认的固定卡片高度。
        fillContainer ? styles.fileSpaceBlockFill : '',
        fillContainer ? styles.fileSpaceBlockPlain : '',
        // 资源 Tab 的文件空间空态需要和代码变更卡片使用相同的高度与居中方式。
        resourceEmptyStyle ? styles.fileSpaceBlockResource : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!hideHeader && (
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
          {headerExtra}
          {onRefresh && (
            <button type="button" className={styles.fileSpaceRefresh} onClick={onRefresh} aria-label="refresh">
              <ReloadOutlined spin={loading} />
            </button>
          )}
        </div>
      )}
      <div className={`${styles.fileSpacePrimaryContent} ${showAlternateContent ? styles.fileSpaceContentHidden : ''}`}>
        {contentBefore}
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
          ) : resourceEmptyStyle ? (
            <div className={styles.fileSpaceEmpty}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
            </div>
          ) : (
            <div className={styles.fileSpaceEmpty}>{emptyText}</div>
          )
        ) : (
          renderTree(items, currentPath, loading, emptyText)
        )}
      </div>
      <div
        className={`${styles.fileSpaceAlternateContent} ${showAlternateContent ? '' : styles.fileSpaceContentHidden}`}
      >
        {alternateContent}
      </div>
    </div>
  );
};

export default FileSpaceBlock;
