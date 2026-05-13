/**
 * SourceTree 组件
 * 知识来源树，展示所有已添加的知识来源
 */

import React, { useCallback, useState } from 'react';
import { Checkbox, Collapse, Spin, message, Dropdown } from 'antd';
import {
  FileTextOutlined,
  GlobalOutlined,
  RightOutlined,
  LoadingOutlined,
  EllipsisOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { fileIconMap } from '@/constants/icon';
import useGlobal from '@/hooks/useGlobal';
import type { KnowledgeSource, SourceRootId, SourceTreeNode, SourceTreeNodeId, SourceTreeProps } from '../types';
import styles from './index.less';
import { SourceRootIdMap, SourceTreeNodeTypeMap } from '../const';
import { getSkillNodeIconType, getSourceRootIdByNodeId } from '../utils';

const SourceTree: React.FC<SourceTreeProps> = (props) => {
  const { treeData, checkedIds, onCheckChange, onFileNodeClick, onRenameNode, onDeleteNode } = props;

  const [localExpandedKeys, setLocalExpandedKeys] = useState<string[]>([SourceRootIdMap.userImported]);
  const intl = useIntl();
  const { uploadFileConfig } = useGlobal();

  const handleToggleExpand = useCallback((id: string) => {
    setLocalExpandedKeys((prev) => {
      const isExpanded = prev.includes(id);
      const nextKeys = isExpanded ? prev.filter((key) => key !== id) : [...prev, id];
      return nextKeys;
    });
  }, []);

  const getCheckedFileCount = useCallback((ids: SourceTreeNodeId[]): number => {
    const filePrefix = `${SourceTreeNodeTypeMap.file}-`;
    return ids.filter((id) => `${id}`.startsWith(filePrefix)).length;
  }, []);

  const handleNodeCheck = useCallback(
    (node: SourceTreeNode, checked: boolean) => {
      if (
        checked &&
        node.type === SourceTreeNodeTypeMap.file &&
        uploadFileConfig &&
        uploadFileConfig.maxFileCount > 0
      ) {
        const targetId = node.id as SourceTreeNodeId;
        const exists = checkedIds.includes(targetId);
        const nextIds = exists ? checkedIds : [...checkedIds, targetId];
        const nextFileCount = getCheckedFileCount(nextIds);

        if (nextFileCount > uploadFileConfig.maxFileCount) {
          message.error(intl.formatMessage({ id: 'upload.maxFilesLimit' }, { count: uploadFileConfig.maxFileCount }));
          return;
        }
      }

      onCheckChange(node, checked, node.rootId);
    },
    [checkedIds, getCheckedFileCount, onCheckChange, uploadFileConfig]
  );

  const handleSelectAll = useCallback(
    (node: SourceTreeNode, checked: boolean) => {
      const allIds: SourceTreeNode[] = [];

      const collectIds = (n: SourceTreeNode) => {
        if (n.type !== SourceTreeNodeTypeMap.folder && n.sourceData) {
          allIds.push(n);
        }
        if (n.totalChildren) {
          n.totalChildren.forEach(collectIds);
        } else if (n.children) {
          n.children.forEach(collectIds);
        }
      };

      collectIds(node);

      onCheckChange(allIds, checked, node.rootId);
    },
    [checkedIds, onCheckChange]
  );

  const getCheckedCount = useCallback(
    (node: SourceTreeNode): number => {
      if (node.type === SourceTreeNodeTypeMap.folder) {
        return checkedIds.filter((id) => getSourceRootIdByNodeId(id) === node.rootId).length;
      }
      if (node.type !== SourceTreeNodeTypeMap.folder) {
        return checkedIds.includes(node.id as SourceTreeNodeId) ? 1 : 0;
      }

      if (node.children && node.children.length > 0) {
        return node.children.reduce((sum, child) => sum + getCheckedCount(child), 0);
      }

      return 0;
    },
    [checkedIds]
  );

  const isNodeChecked = useCallback(
    (node: SourceTreeNode): boolean => {
      if (node.type === SourceTreeNodeTypeMap.folder) {
        const checkedCount = getCheckedCount(node);
        return checkedCount > 0 && checkedCount === node.totalCount!;
      }
      if (node.type !== SourceTreeNodeTypeMap.folder) {
        return checkedIds.includes(node.id as SourceTreeNodeId);
      }

      if (node.children && node.children.length > 0) {
        return node.children.every((child) => isNodeChecked(child));
      }

      return false;
    },
    [checkedIds, getCheckedCount]
  );

  const isNodeIndeterminate = useCallback(
    (node: SourceTreeNode): boolean => {
      if (node.type === SourceTreeNodeTypeMap.folder) {
        const checkedCount = getCheckedCount(node);
        return checkedCount > 0 && checkedCount < node.totalCount!;
      }
      if (node.type !== SourceTreeNodeTypeMap.folder) return false;

      if (node.children && node.children.length > 0) {
        const checkedChildren = node.children.filter((child) => isNodeChecked(child));
        return checkedChildren.length > 0 && checkedChildren.length < node.children.length;
      }

      return false;
    },
    [isNodeChecked, getCheckedCount]
  );

  const getFileIconType = (node: SourceTreeNode): string => {
    const sourceData = node.sourceData as any;

    let rawType: string | undefined =
      sourceData?.fileType ||
      sourceData?.type ||
      sourceData?.fileExtension ||
      (typeof sourceData?.fileName === 'string' ? sourceData.fileName.split('.').pop() : undefined);

    if (!rawType && typeof node.title === 'string') {
      const parts = node.title.split('.');
      if (parts.length > 1) {
        rawType = parts.pop();
      }
    }

    const normalized = (rawType || '').toString().toLowerCase();
    const key = normalized || 'file';

    return fileIconMap[key] || fileIconMap.file;
  };

  const renderNodeIcon = (node: SourceTreeNode) => {
    if (node.icon) return <span className={styles.nodeIcon}>{node.icon}</span>;

    switch (node.type) {
      case SourceTreeNodeTypeMap.more:
        return <EyeOutlined />;
      case SourceTreeNodeTypeMap.file: {
        const iconType = getFileIconType(node);
        return <AntdIcon type={iconType} className={styles.nodeIcon} />;
      }
      case SourceTreeNodeTypeMap.webSearch:
        return <GlobalOutlined className={styles.nodeIcon} />;
      case SourceTreeNodeTypeMap.skill:
        return <AntdIcon type={getSkillNodeIconType(node.sourceData as KnowledgeSource)} />;
      default:
        return <FileTextOutlined className={styles.nodeIcon} />;
    }
  };

  const renderTreeNode = (node: SourceTreeNode, level: number = 0, rootId?: SourceRootId) => {
    const isChecked = isNodeChecked(node);
    const isIndeterminate = isNodeIndeterminate(node);
    const isExpanded = localExpandedKeys.includes(node.id);

    if (node.type === SourceTreeNodeTypeMap.folder) {
      const checkedCount = getCheckedCount(node);
      const isExpandable = node.expandable !== false;

      const header = (
        <div
          className={styles.folderHeader}
          style={{ paddingLeft: level * 16 }}
          onClick={isExpandable ? () => handleToggleExpand(node.id) : undefined}
        >
          <div className={styles.folderLeft}>
            {isExpandable && (
              <RightOutlined className={`${styles.expandIcon} ${isExpanded ? styles.expandIconExpanded : ''}`} />
            )}
            {renderNodeIcon(node)}
            <span className={styles.folderTitle}>{node.title}</span>
          </div>
          <div className={styles.folderRight}>
            <span
              className={styles.summaryCount}
              onClick={(e) => {
                e.stopPropagation();
                node.onSummaryClick?.(node.rootId);
              }}
            >
              {checkedCount}/{node.totalCount ?? 0}
            </span>
            <Checkbox
              checked={isChecked}
              indeterminate={isIndeterminate}
              onChange={(e) => handleSelectAll(node, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      );

      return (
        <div key={node.id}>
          {header}
          {node.children && node.children.length > 0 && isExpandable && (
            <Collapse ghost bordered={false} activeKey={isExpanded ? [node.id] : []} className={styles.collapse}>
              <Collapse.Panel key={node.id} showArrow={false} header={null} collapsible="disabled">
                <div className={styles.childrenWrapper}>
                  {node.children.map((child) => renderTreeNode(child, level + 1, rootId as SourceRootId))}
                </div>
              </Collapse.Panel>
            </Collapse>
          )}
        </div>
      );
    }

    // loading 状态的节点展示名称和旋转图标
    if (node.loading) {
      return (
        <div
          key={node.id}
          className={`${styles.sourceNode} ${styles.loadingNode}`}
          style={{ paddingLeft: level * 16 + 8 }}
        >
          <div className={styles.sourceLeft}>
            <Spin indicator={<LoadingOutlined spin />} size="small" className={styles.loadingIcon} />
            <span className={styles.sourceTitle}>{node.title}</span>
          </div>
          <Checkbox disabled checked={isChecked} />
        </div>
      );
    }

    const isInUserImportedRoot = rootId === SourceRootIdMap.userImported;
    const hasMenu = isInUserImportedRoot && (!!onRenameNode || !!onDeleteNode);

    const menuItems =
      hasMenu &&
      [onRenameNode && { key: 'rename', label: '重命名' }, onDeleteNode && { key: 'delete', label: '删除' }].filter(
        Boolean
      );

    return (
      <div key={node.id} className={styles.sourceNode} style={{ paddingLeft: level * 16 + 8 }}>
        <div className={styles.sourceLeft}>
          {renderNodeIcon(node)}
          <span
            title={node.title}
            className={styles.sourceTitle}
            onClick={(e) => {
              e.stopPropagation();
              if (node.type === SourceTreeNodeTypeMap.file && onFileNodeClick) {
                onFileNodeClick(node);
              } else if (node.type === SourceTreeNodeTypeMap.more && node.onSummaryClick) {
                node.onSummaryClick(node.rootId);
              }
            }}
          >
            {node.title}
          </span>
        </div>
        <div className={styles.sourceRight}>
          {hasMenu && menuItems && (
            <Dropdown
              trigger={['click']}
              menu={{
                items: menuItems as any,
                onClick: ({ key, domEvent }) => {
                  domEvent?.stopPropagation();
                  if (key === 'rename' && onRenameNode) {
                    onRenameNode(node);
                  } else if (key === 'delete' && onDeleteNode) {
                    onDeleteNode(node);
                  }
                },
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <EllipsisOutlined className={styles.moreIcon} />
              </span>
            </Dropdown>
          )}
          {node.type !== SourceTreeNodeTypeMap.more && (
            <Checkbox checked={isChecked} onChange={(e) => handleNodeCheck(node, e.target.checked)} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.sourceTreeWrapper}>
      {treeData.map((node) => renderTreeNode(node, 0, node.id as SourceRootId))}
    </div>
  );
};

export default SourceTree;
