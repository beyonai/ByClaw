import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Input, Modal, Spin, Tooltip, Tree } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import styles from './index.module.less';

export interface KnowledgeTargetItem {
  id?: string | number;
  resourceId?: string | number;
  resourceName?: string;
  name?: string;
  resourceDesc?: string;
  description?: string;
}

export interface KnowledgeTargetSelectorProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
  okDisabled?: boolean;
  width?: number | string;
  zIndex?: number;
  destroyOnClose?: boolean;
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  onSearch: (keyword: string) => void;
  knowledgeBases: KnowledgeTargetItem[];
  knowledgeLoading?: boolean;
  selectedKnowledgeBase?: KnowledgeTargetItem | null;
  onSelectKnowledgeBase: (knowledgeBase: KnowledgeTargetItem) => void;
  directoryPath: string;
  folders: QueryDirAndFileByLevelItem[];
  folderLoading?: boolean;
  onFolderClick: (folder: QueryDirAndFileByLevelItem, directoryPath: string) => void;
  onLoadFolderChildren?: (directoryPath: string) => Promise<QueryDirAndFileByLevelItem[] | void>;
  emptyText?: React.ReactNode;
  folderEmptyText?: React.ReactNode;
  footerExtra?: React.ReactNode;
  className?: string;
}

type KnowledgeTargetSelectorContentProps = Omit<
  KnowledgeTargetSelectorProps,
  'open' | 'onOk' | 'onCancel' | 'confirmLoading' | 'okDisabled' | 'width' | 'zIndex' | 'destroyOnClose' | 'footerExtra'
>;

function normalizeDirectoryPath(path?: string) {
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function joinDirectoryPath(parentPath: string, name: string) {
  return normalizeDirectoryPath(`${normalizeDirectoryPath(parentPath)}/${name}`);
}

function getKnowledgeBaseId(item: KnowledgeTargetItem) {
  return item.resourceId ?? item.id;
}

function getKnowledgeBaseName(item: KnowledgeTargetItem) {
  return item.resourceName ?? item.name ?? getKnowledgeBaseId(item) ?? '';
}

function getFolderPath(folder: QueryDirAndFileByLevelItem, parentPath: string) {
  return normalizeDirectoryPath(
    String(folder.directoryPath ?? '').trim() || joinDirectoryPath(parentPath, folder.name)
  );
}

interface FolderTreeNode {
  key: string;
  title: string;
  folder?: QueryDirAndFileByLevelItem;
  children?: FolderTreeNode[];
}

function buildFolderTreeNodes(
  parentPath: string,
  folders: QueryDirAndFileByLevelItem[],
  childrenByPath: Record<string, QueryDirAndFileByLevelItem[]>
): FolderTreeNode[] {
  return folders.map((folder) => {
    const folderPath = getFolderPath(folder, parentPath);
    const children = childrenByPath[folderPath];
    return {
      key: folderPath,
      title: folder.name,
      folder,
      children: children ? buildFolderTreeNodes(folderPath, children, childrenByPath) : undefined,
    };
  });
}

const KnowledgeTargetSelectorContent: React.FC<KnowledgeTargetSelectorContentProps> = (props) => {
  const {
    keyword,
    onKeywordChange,
    onSearch,
    knowledgeBases,
    knowledgeLoading = false,
    selectedKnowledgeBase,
    onSelectKnowledgeBase,
    directoryPath,
    folders,
    folderLoading = false,
    onFolderClick,
    onLoadFolderChildren,
    emptyText,
    folderEmptyText,
    className,
  } = props;
  const intl = useIntl();
  const normalizedDirectoryPath = normalizeDirectoryPath(directoryPath);
  const [rootFolders, setRootFolders] = useState<QueryDirAndFileByLevelItem[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, QueryDirAndFileByLevelItem[]>>({});
  const [selectedFolderKeys, setSelectedFolderKeys] = useState<React.Key[]>(['/']);
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<React.Key[]>(['/']);

  useEffect(() => {
    if (!selectedKnowledgeBase) {
      setRootFolders([]);
      setChildrenByPath({});
      setSelectedFolderKeys(['/']);
      setExpandedFolderKeys(['/']);
      return;
    }
    if (normalizedDirectoryPath === '/') {
      setRootFolders(folders);
      setSelectedFolderKeys(['/']);
      setExpandedFolderKeys((prev) => (prev.includes('/') ? prev : ['/', ...prev]));
    } else {
      setChildrenByPath((prev) => ({
        ...prev,
        [normalizedDirectoryPath]: folders,
      }));
      setSelectedFolderKeys([normalizedDirectoryPath]);
      setExpandedFolderKeys((prev) => [...new Set([...prev, '/', normalizedDirectoryPath])]);
    }
  }, [folders, normalizedDirectoryPath, selectedKnowledgeBase]);

  const folderTreeData = useMemo<FolderTreeNode[]>(() => {
    return [
      {
        key: '/',
        title: intl.formatMessage({ id: 'fileBrowser.root' }),
        children: buildFolderTreeNodes('/', rootFolders, childrenByPath),
      },
    ];
  }, [childrenByPath, intl, rootFolders]);

  const loadTreeNode = useCallback(
    async (node: FolderTreeNode) => {
      const path = String(node.key);
      if (path === '/' || childrenByPath[path] || !onLoadFolderChildren) {
        return;
      }
      const children = await onLoadFolderChildren(path);
      if (children) {
        setChildrenByPath((prev) => ({
          ...prev,
          [path]: children,
        }));
      }
    },
    [childrenByPath, onLoadFolderChildren]
  );

  return (
    <div className={[styles.selector, className].filter(Boolean).join(' ')}>
      <div className={styles.leftPanel}>
        <div className={styles.toolbar}>
          <Input.Search
            allowClear
            value={keyword}
            placeholder={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.searchPlaceholder' })}
            onChange={(event) => onKeywordChange(event.target.value)}
            onSearch={onSearch}
            className={styles.search}
          />
        </div>
        <Spin spinning={knowledgeLoading}>
          <div className={styles.content}>
            {knowledgeBases.length ? (
              <div className={styles.cardGrid}>
                {knowledgeBases.map((item) => {
                  const id = getKnowledgeBaseId(item);
                  const idStr = String(id);
                  const name = String(getKnowledgeBaseName(item));
                  const desc = item.resourceDesc ?? item.description;
                  const selected = selectedKnowledgeBase
                    ? String(getKnowledgeBaseId(selectedKnowledgeBase)) === idStr
                    : false;
                  return (
                    <div
                      key={idStr}
                      className={[styles.card, selected ? styles.cardSelected : ''].filter(Boolean).join(' ')}
                      onClick={() => {
                        onSelectKnowledgeBase(item);
                      }}
                    >
                      <span className={styles.cardIcon}>
                        <AntdIcon type="icon-chuangjianfangshi-wendangku" style={{ fontSize: 16 }} />
                      </span>
                      <div className={styles.cardBody}>
                        <Tooltip title={name}>
                          <div className={styles.cardTitle}>{name}</div>
                        </Tooltip>
                        {desc && (
                          <Tooltip title={String(desc)}>
                            <div className={styles.cardDesc}>{desc}</div>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              !knowledgeLoading && (
                <Empty description={emptyText ?? intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })} />
              )
            )}
          </div>
        </Spin>
      </div>
      <div className={styles.rightPanel}>
        <div className={styles.folderHeader}>
          <span className={styles.selectedTitle}>
            {selectedKnowledgeBase
              ? getKnowledgeBaseName(selectedKnowledgeBase)
              : intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' })}
          </span>
        </div>
        {selectedKnowledgeBase ? (
          <Spin spinning={folderLoading}>
            <div className={styles.folderTreeWrap}>
              <Tree
                className={styles.folderTree}
                treeData={folderTreeData}
                selectedKeys={selectedFolderKeys}
                expandedKeys={expandedFolderKeys}
                loadData={(node) => loadTreeNode(node as unknown as FolderTreeNode)}
                onExpand={(keys) => setExpandedFolderKeys(keys)}
                titleRender={(node) => (
                  <Tooltip title={node.title}>
                    <span className={styles.folderTreeTitle}>
                      <AntdIcon type="icon-wenjianjialanse" className={styles.folderIcon} />
                      <span className={styles.folderTreeName}>{node.title}</span>
                    </span>
                  </Tooltip>
                )}
                onSelect={(keys, info) => {
                  const node = info.node as unknown as FolderTreeNode;
                  const nextPath = String(node.key);
                  setSelectedFolderKeys(keys.length ? keys : [nextPath]);
                  setExpandedFolderKeys((prev) => [...new Set([...prev, nextPath])]);
                  onFolderClick(
                    node.folder || ({ name: node.title, type: 'directory', directoryPath: nextPath } as any),
                    nextPath
                  );
                }}
              />
              {!rootFolders.length && !folderLoading && (
                <Empty
                  className={styles.folderEmpty}
                  description={folderEmptyText ?? intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' })}
                />
              )}
            </div>
          </Spin>
        ) : (
          <Empty description={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' })} />
        )}
      </div>
    </div>
  );
};

const KnowledgeTargetSelector: React.FC<KnowledgeTargetSelectorProps> = (props) => {
  const {
    open,
    onOk,
    onCancel,
    confirmLoading,
    okDisabled,
    width = 900,
    zIndex,
    destroyOnClose = true,
    footerExtra,
    ...selectorProps
  } = props;
  const intl = useIntl();

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'fileSider.saveToKnowledge' })}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: okDisabled }}
      onOk={onOk}
      onCancel={onCancel}
      width={width}
      zIndex={zIndex}
      destroyOnClose={destroyOnClose}
    >
      <KnowledgeTargetSelectorContent {...selectorProps} />
      {footerExtra}
    </Modal>
  );
};

export default KnowledgeTargetSelector;
