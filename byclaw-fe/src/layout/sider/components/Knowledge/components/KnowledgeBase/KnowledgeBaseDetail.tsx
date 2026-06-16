import React, { useState, useRef, useEffect, useCallback, useContext } from 'react';
import { Input, Breadcrumb, Tree, Spin, App, ConfigProvider, Dropdown } from 'antd';
import { EllipsisOutlined, LeftOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { AntdTreeNodeAttribute, EventDataNode } from 'antd/es/tree';
import AntdIcon from '@/components/AntdIcon';
import { useIntl, useSelector } from '@umijs/max';
import useVirtualHeight from '@/hooks/useVirtualHeight';
import useGlobal from '@/hooks/useGlobal';
import { downloadResourceFile } from '@/service/file';
import {
  createFolder as createFileBrowserFolder,
  listFiles as listFileBrowserFiles,
  uploadFiles as uploadFileBrowserFiles,
} from '@/service/fileBrowser';
import { resolveTreeItemDirectoryPath } from './service';
import { HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import { getKnowledgeFileIconType } from '@/constants/icon';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import useShowModal from '@/hooks/useShowModal';
import RenameModal from '@/pages/knowledgeDetail/components/RenameModal';
import { IDragType, DragType, onTreeNodeDragStart } from '@/components/QueryInput/withDrag';
import { IKnowledgeBaseItem, IKnowledgeCollectionItem, IKnowledgeDetailTreeItem } from './types';
import { delFolderOrFile, qryFolderAndFileList } from './service';
import { deleteTreeNode, updateTreeNode } from './utils';
import commonStyles from '../common.module.less';
import styles from './index.module.less';
import { TreeProps } from 'antd/lib';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

const SHARED_FILES_PATH = '/.shared/';

function getSessionFilesPath(sessionId: string) {
  return `/.sessions/${sessionId}/`;
}

function ensureDirectoryPath(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

function joinFileBrowserDirectoryPath(parentPath: string, name: string) {
  return `${ensureDirectoryPath(parentPath)}${name}/`.replace(/\/+/g, '/');
}

function getKnowledgeItemName(item: Pick<IKnowledgeDetailTreeItem, 'title' | 'collectionName'>) {
  return String(item.title || item.collectionName || '');
}

function getRawBlob(res: any) {
  return res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
}

function unwrapListResponse<T>(res: any): T[] {
  const data = res?.data ?? res ?? [];
  return Array.isArray(data) ? data : [];
}

function isFileBrowserDirectory(item: any) {
  return item?.isDir || item?.dir;
}

function toKnowledgeTreeItem(
  item: QueryDirAndFileByLevelItem,
  parentId: string,
  datasetId: string
): IKnowledgeDetailTreeItem {
  const directoryPath = String(item.directoryPath ?? '').trim();
  const pathKey =
    directoryPath || String(item.id !== null && item.id !== undefined ? item.id : `${parentId}/${item.name}`);

  return {
    id: String(item.id ?? ''),
    collectionName: item.name,
    datasetId,
    type: item.type,
    fileId: item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : undefined,
    parentId,
    directoryPath: item.directoryPath,
    title: item.name,
    key: pathKey,
    isLeaf: item.type === 'file',
  };
}

interface KnowledgeBaseDetailProps {
  editable?: boolean;
  dataset: IKnowledgeBaseItem;
  onGoBack: () => void;
  onSelect?: (item: IKnowledgeCollectionItem, type: IDragType) => void;
  activeAgentResourceId?: string;
}

function onDragStart(info: Parameters<Required<TreeProps>['onDragStart']>[0]) {
  const data = info.node as unknown as IKnowledgeDetailTreeItem;
  onTreeNodeDragStart(info.event, data, data.type === 'file' ? DragType.file : DragType.folder);
}

function getNodeIcon(p: AntdTreeNodeAttribute) {
  const { isLeaf, title } = p;
  const iconType = getKnowledgeFileIconType(title as string, {
    isDirectory: !isLeaf,
    directoryIconType: 'wenjianjialanse',
  });

  return <AntdIcon type={`icon-${iconType}`} />;
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'jpeg') return 'jpg';
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

interface FilePreviewPanelProps {
  blob: Blob | null;
  fileName: string;
  fileType: string;
  loading: boolean;
  onClose: () => void;
}

const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({ blob, fileName, fileType, loading, onClose }) => (
  <div className={styles.previewPanel}>
    <div className={styles.previewHeader}>
      <span className={styles.previewTitle}>{fileName}</span>
      <span className={styles.previewClose} onClick={onClose}>
        <AntdIcon type="icon-a-Closeguanbi1" />
      </span>
    </div>
    <div className={styles.previewBody}>
      <Spin spinning={loading} wrapperClassName={styles.previewSpin}>
        {blob && (
          <React.Suspense fallback={null}>
            <PreViewFile data={blob} type={fileType} title={fileName} className={styles.previewContent} />
          </React.Suspense>
        )}
      </Spin>
    </div>
  </div>
);

const KnowledgeBaseDetail = (props: KnowledgeBaseDetailProps) => {
  const { editable, dataset, onGoBack, onSelect, activeAgentResourceId } = props;
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<IKnowledgeDetailTreeItem[]>([]);
  const treeWrap = useRef<HTMLDivElement>(null);
  const treeClickTimerRef = useRef<number | null>(null);
  const virtualHeight = useVirtualHeight(treeWrap);
  const { EventEmitter, sessionId } = useGlobal();
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));

  const intl = useIntl();
  const { modal, message } = App.useApp();
  const [modalState, modalAction] = useShowModal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);

  const qryFlatternList = async (parentId: string) => {
    if (parentId === '-1') {
      setLoading(true);
      setTreeData([]);
    }
    let result: IKnowledgeDetailTreeItem[] = [];
    try {
      const resourceId = Number(dataset.resourceId);
      const directoryPath = parentId === '-1' ? '/' : String(parentId);
      const response = await qryFolderAndFileList({
        resourceId,
        directoryPath,
      });
      const datasetId = String(dataset.resourceSourcePkId ?? dataset.resourceId ?? '');
      result = (response || []).map((item: QueryDirAndFileByLevelItem) => {
        return toKnowledgeTreeItem(item, String(parentId), datasetId);
      }) as IKnowledgeDetailTreeItem[];
      const kw = searchValue.trim().toLowerCase();
      if (kw) {
        result = result.filter((r) => String(r.title).toLowerCase().includes(kw));
      }
      if (parentId === '-1') {
        setTreeData(result);
      }
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
    return result;
  };

  useEffect(() => {
    qryFlatternList('-1');
  }, [searchValue]);

  const clearTreeClickTimer = useCallback(() => {
    if (treeClickTimerRef.current !== null) {
      window.clearTimeout(treeClickTimerRef.current);
      treeClickTimerRef.current = null;
    }
  }, []);

  const getTreeNodeDragType = useCallback(
    (item: IKnowledgeDetailTreeItem): IDragType => (item.type === 'file' ? DragType.file : DragType.folder),
    []
  );

  const renderPreviewPanel = useCallback(
    (item: IKnowledgeDetailTreeItem, options: { blob?: Blob | null; loading: boolean }) => {
      setDetailPanel?.(
        <FilePreviewPanel
          blob={options.blob ?? null}
          fileName={String(item.title || item.collectionName || '')}
          fileType={getFileType(String(item.title || item.collectionName || ''))}
          loading={options.loading}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const handlePreviewFile = useCallback(
    async (item: IKnowledgeDetailTreeItem) => {
      const fileName = getKnowledgeItemName(item);
      if (!isPreviewable(fileName)) return;

      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!directoryPath) {
        message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }

      renderPreviewPanel(item, { loading: true });
      try {
        const res: any = await downloadResourceFile({
          resourceId: dataset.resourceId,
          directoryPath,
        });
        const rawBlob = getRawBlob(res);
        const mimeType = getMimeType(fileName);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        renderPreviewPanel(item, { blob, loading: false });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
        clearDetailPanel?.();
      }
    },
    [clearDetailPanel, dataset.resourceId, intl, message, renderPreviewPanel]
  );

  const copyKnowledgeFileToFileBrowser = useCallback(
    async (item: IKnowledgeDetailTreeItem, targetPath: string) => {
      const fileName = getKnowledgeItemName(item);
      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!activeAgentResourceId || !directoryPath || !fileName) {
        throw new Error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
      }

      const res: any = await downloadResourceFile({
        resourceId: dataset.resourceId,
        directoryPath,
      });
      const rawBlob = getRawBlob(res);
      const mimeType = rawBlob.type || getMimeType(fileName) || undefined;
      const file = new File([rawBlob], fileName, mimeType ? { type: mimeType } : undefined);
      await uploadFileBrowserFiles(activeAgentResourceId, targetPath, [file]);
    },
    [activeAgentResourceId, dataset.resourceId, intl]
  );

  const ensureFileBrowserDirectory = useCallback(
    async (parentPath: string, folderName: string, targetDirectoryPath: string) => {
      if (!activeAgentResourceId) {
        throw new Error(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: '' }));
      }

      try {
        await createFileBrowserFolder({ resourceId: activeAgentResourceId, path: targetDirectoryPath });
      } catch (error) {
        const response = await listFileBrowserFiles({ resourceId: activeAgentResourceId, path: parentPath });
        const siblings = unwrapListResponse<any>(response);
        const existed = siblings.some((item) => item?.name === folderName && isFileBrowserDirectory(item));
        if (!existed) {
          throw error;
        }
      }
    },
    [activeAgentResourceId, intl]
  );

  const copyKnowledgeDirectoryToFileBrowser = useCallback(
    async function copyDirectory(item: IKnowledgeDetailTreeItem, parentTargetPath: string): Promise<void> {
      const folderName = getKnowledgeItemName(item);
      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!activeAgentResourceId || !directoryPath || !folderName) {
        throw new Error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
      }

      const targetDirectoryPath = joinFileBrowserDirectoryPath(parentTargetPath, folderName);
      await ensureFileBrowserDirectory(parentTargetPath, folderName, targetDirectoryPath);

      const response = await qryFolderAndFileList({
        resourceId: Number(dataset.resourceId),
        directoryPath,
      });
      const datasetId = String(dataset.resourceSourcePkId ?? dataset.resourceId ?? '');
      const children = unwrapListResponse<QueryDirAndFileByLevelItem>(response).map((child) =>
        toKnowledgeTreeItem(child, directoryPath, datasetId)
      );

      for (const child of children) {
        if (child.type === 'directory') {
          await copyDirectory(child, targetDirectoryPath);
        } else {
          await copyKnowledgeFileToFileBrowser(child, targetDirectoryPath);
        }
      }
    },
    [
      activeAgentResourceId,
      copyKnowledgeFileToFileBrowser,
      dataset.resourceId,
      dataset.resourceSourcePkId,
      ensureFileBrowserDirectory,
      intl,
    ]
  );

  const handleSaveToFileBrowser = useCallback(
    async (item: IKnowledgeDetailTreeItem, targetPath: string, targetName: string, messageKey: string) => {
      if (!activeAgentResourceId) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: targetName }));
        return;
      }

      const fileName = getKnowledgeItemName(item);
      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!directoryPath || !fileName) {
        message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }

      message.loading({
        content: intl.formatMessage({ id: 'fileBrowser.save.saving' }, { target: targetName }),
        key: messageKey,
        duration: 0,
      });
      try {
        if (item.type === 'directory') {
          await copyKnowledgeDirectoryToFileBrowser(item, targetPath);
        } else {
          await copyKnowledgeFileToFileBrowser(item, targetPath);
        }
        message.destroy(messageKey);
        message.success(intl.formatMessage({ id: 'fileBrowser.save.success' }, { target: targetName }));
      } catch (error: any) {
        message.destroy(messageKey);
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.save.failed' }, { target: targetName }));
      }
    },
    [activeAgentResourceId, copyKnowledgeDirectoryToFileBrowser, copyKnowledgeFileToFileBrowser, intl, message]
  );

  const handleTreeNodeClick = useCallback(
    (event: React.MouseEvent, node: EventDataNode<IKnowledgeDetailTreeItem>) => {
      event.stopPropagation();
      clearTreeClickTimer();
      treeClickTimerRef.current = window.setTimeout(() => {
        treeClickTimerRef.current = null;
        if (node.type === 'file') {
          void handlePreviewFile(node);
          return;
        }
        onSelect?.(node, getTreeNodeDragType(node));
      }, 220);
    },
    [clearTreeClickTimer, getTreeNodeDragType, handlePreviewFile, onSelect]
  );

  const handleTreeNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: EventDataNode<IKnowledgeDetailTreeItem>) => {
      event.stopPropagation();
      clearTreeClickTimer();
      EventEmitter.emit('queryInput-insert-item', {
        item: node,
        type: getTreeNodeDragType(node),
      });
    },
    [EventEmitter, clearTreeClickTimer, getTreeNodeDragType]
  );

  useEffect(() => {
    return clearTreeClickTimer;
  }, [clearTreeClickTimer]);

  const expandFolder = ({ key, children }: EventDataNode<IKnowledgeDetailTreeItem>) =>
    new Promise<void>((resolve) => {
      if (children) {
        resolve();
        return;
      }
      qryFlatternList(key).then((result) => {
        setTreeData((origin) => updateTreeNode(origin, key, { children: result }));
        resolve();
      });
    });

  const onMenuItemClick = useCallback(
    (key: string, item: IKnowledgeDetailTreeItem) => {
      if (key === 'rename') {
        modalAction.handleShow('edit', item);
      } else if (key === 'delete') {
        modal.confirm({
          title: intl.formatMessage({ id: 'common.deleteTips' }),
          content: item.title,
          onOk: () =>
            new Promise<void>((resolve) => {
              delFolderOrFile(item, String(dataset.resourceId))
                .then(() => {
                  message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
                  setTreeData((prev) => deleteTreeNode(prev, key));
                })
                .finally(resolve);
            }),
        });
      } else if (key === 'download') {
        const directoryPath = resolveTreeItemDirectoryPath(item);
        if (!directoryPath) {
          message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
          return;
        }
        message.loading('');
        downloadResourceFile({
          resourceId: dataset.resourceId,
          directoryPath,
        }).then((res) => {
          message.destroy();
          downloadFile(res);
        });
      } else if (key === 'saveToSessionFiles') {
        if (!sessionId) return;
        void handleSaveToFileBrowser(
          item,
          getSessionFilesPath(sessionId),
          intl.formatMessage({ id: 'fileBrowser.save.target.sessionFiles' }),
          'saveToSessionFiles'
        );
      } else if (key === 'saveToSharedFiles') {
        void handleSaveToFileBrowser(
          item,
          SHARED_FILES_PATH,
          intl.formatMessage({ id: 'fileBrowser.save.target.sharedFiles' }),
          'saveToSharedFiles'
        );
      }
    },
    [dataset.resourceId, handleSaveToFileBrowser, intl, message, modal, modalAction, sessionId]
  );

  return (
    <ConfigProvider>
      <div className={commonStyles.container}>
        <div className={commonStyles.searchArea}>
          <Breadcrumb
            className={commonStyles.breadcrumb}
            style={{ marginTop: 0 }}
            items={[
              {
                key: '-1',
                title: (
                  <span>
                    <LeftOutlined />
                    {intl.formatMessage({ id: 'dialogueRecord.all' })}
                  </span>
                ),
                onClick: onGoBack,
              },
              { key: dataset.resourceId, title: dataset.resourceName },
            ]}
          />
          <div className={commonStyles.searchControls}>
            <Input.Search
              allowClear
              placeholder={intl.formatMessage({ id: 'selectMember.searchPlaceholder' })}
              onSearch={setSearchValue}
              className={commonStyles.searchInput}
            />
          </div>
        </div>
        <Spin spinning={loading} wrapperClassName={commonStyles.listSpinner}>
          <div ref={treeWrap} style={{ height: '100%' }}>
            <Tree.DirectoryTree
              showIcon
              allowDrop={() => false}
              onDragStart={onDragStart}
              selectable={false}
              height={virtualHeight}
              treeData={treeData}
              loadData={expandFolder}
              icon={getNodeIcon}
              className={classnames(commonStyles.tree, {
                [styles.selectable]: !!onSelect,
                [styles.notselectable]: !onSelect,
              })}
              onClick={handleTreeNodeClick}
              onDoubleClick={handleTreeNodeDoubleClick}
              draggable={editable ? { icon: <span /> } : false}
              titleRender={(item) => {
                if (!editable) {
                  return item.title;
                }
                const menus = [];
                if (`${item.createUserId}` === `${userInfo.userId}`) {
                  menus.push(
                    { key: 'rename', label: intl.formatMessage({ id: 'directoryManage.rename' }) },
                    { key: 'delete', label: intl.formatMessage({ id: 'common.delete' }) }
                  );
                }
                const fileBrowserMenus = [
                  {
                    key: 'saveToSharedFiles',
                    label: intl.formatMessage({ id: 'fileBrowser.save.toSharedFiles' }),
                  },
                ];
                if (item.type === 'file') {
                  fileBrowserMenus.unshift({
                    key: 'download',
                    label: intl.formatMessage({ id: 'directoryManage.downloadFile' }),
                  });
                }
                if (sessionId) {
                  fileBrowserMenus.splice(item.type === 'file' ? 1 : 0, 0, {
                    key: 'saveToSessionFiles',
                    label: intl.formatMessage({ id: 'fileBrowser.save.toSessionFiles' }),
                  });
                }
                if (fileBrowserMenus.length) {
                  menus.unshift(...fileBrowserMenus);
                }
                return (
                  <>
                    {item.title}
                    <Dropdown
                      trigger={['hover']}
                      menu={{
                        items: menus,
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          onMenuItemClick(key, item);
                        },
                      }}
                    >
                      <EllipsisOutlined
                        className={commonStyles.treeActionIcon}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </>
                );
              }}
            />
          </div>
        </Spin>
      </div>
      <RenameModal
        {...modalState}
        onCancel={modalAction.onCancel}
        resourceId={dataset.resourceId}
        onSuccess={async () => {
          await qryFlatternList('-1');
        }}
      />
    </ConfigProvider>
  );
};

export default KnowledgeBaseDetail;
