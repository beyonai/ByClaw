import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Tooltip,
  Tree,
  Typography,
  Upload,
  message,
} from 'antd';
import { EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import { DragType } from '@/components/QueryInput/withDrag';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import {
  downloadFile,
  downloadFolder,
  getDefaultPath,
  listFiles,
  searchFiles,
  uploadFiles,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import {
  createFolder as createKnowledgeFolder,
  queryDirAndFileByLevel,
  uploadFiles as uploadKnowledgeFiles,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { getKnowledgeFileIconType } from '@/constants/icon';
import commonStyles from '../Knowledge/components/common.module.less';
import styles from './index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

function getIconType(name: string, isDir: boolean): string {
  return getKnowledgeFileIconType(name, {
    isDirectory: isDir,
    directoryIconType: 'wenjianjialanse',
  });
}

function isDirectory(item: FileBrowserItem) {
  return item.isDir || (item as any).dir;
}

function unwrapListResponse<T>(res: any): T[] {
  const data = res?.data ?? res ?? [];
  return Array.isArray(data) ? data : [];
}

function ensureDirectoryPath(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

function getParentDirectoryPath(path: string) {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return segments.length ? `/${segments.join('/')}/` : '/';
}

function getPathDepth(path: string) {
  return path.split('/').filter(Boolean).length;
}

function sortFileBrowserItems(items: FileBrowserItem[]) {
  const dirs = items.filter((item) => isDirectory(item));
  const files = items.filter((item) => !isDirectory(item));
  return [...dirs, ...files];
}

function joinKnowledgeDirectoryPath(parentPath: string, name: string) {
  return `${ensureDirectoryPath(parentPath)}${name}/`.replace(/\/+/g, '/');
}

function getRawBlob(res: any) {
  return res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
}

function toFileTreeData(list: FileBrowserItem[], childrenByPath: Record<string, FileBrowserItem[]>): FileTreeItem[] {
  return sortFileBrowserItems(list).map((item) => {
    const dir = isDirectory(item);
    const directoryPath = ensureDirectoryPath(item.path);
    return {
      ...item,
      key: dir ? directoryPath : item.path,
      title: <span>{item.name}</span>,
      isLeaf: !dir,
      children:
        dir && childrenByPath[directoryPath]
          ? toFileTreeData(childrenByPath[directoryPath], childrenByPath)
          : undefined,
    };
  });
}

function normalizeReferenceItem(item: FileBrowserItem, resourceId: string) {
  const dir = isDirectory(item);
  return {
    ...item,
    id: item.path,
    collectionName: item.name,
    resourceId,
    type: dir ? 'directory' : 'file',
  };
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'jpeg') return 'jpg';
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

interface FileMiniListProps {
  resourceId: string;
}

interface FilePreviewPanelProps {
  blob: Blob | null;
  fileName: string;
  fileType: string;
  loading: boolean;
  onClose: () => void;
}

interface FileTreeItem extends FileBrowserItem {
  key: string;
  title: React.ReactNode;
  isLeaf: boolean;
  children?: FileTreeItem[];
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

const FileMiniList: React.FC<FileMiniListProps> = ({ resourceId }) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const clickTimerRef = useRef<number | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInitialized, setPathInitialized] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<FileBrowserItem | null>(null);
  const [knowledgeKeyword, setKnowledgeKeyword] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);
  const [knowledgeDirectoryPath, setKnowledgeDirectoryPath] = useState('/');
  const [knowledgeFolders, setKnowledgeFolders] = useState<QueryDirAndFileByLevelItem[]>([]);
  const [knowledgeFolderLoading, setKnowledgeFolderLoading] = useState(false);
  const [savingToKnowledge, setSavingToKnowledge] = useState(false);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pendingUploadPath, setPendingUploadPath] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const fetchList = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const res: any = await listFiles({ resourceId, path });
        const data = res?.data ?? res ?? [];
        setItems(Array.isArray(data) ? data : []);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [intl, resourceId]
  );

  useEffect(() => {
    setPathInitialized(false);
    setCurrentPath('');
    setItems([]);
    setSearchValue('');
    setIsSearching(false);
    setChildrenByPath({});
    if (!resourceId) return;
    getDefaultPath(resourceId)
      .then((res: any) => {
        setCurrentPath(res?.data ?? res ?? '/');
        setPathInitialized(true);
      })
      .catch(() => {
        setCurrentPath('/');
        setPathInitialized(true);
      });
  }, [resourceId]);

  useEffect(() => {
    if (resourceId && pathInitialized && currentPath) {
      fetchList(currentPath);
    }
  }, [currentPath, fetchList, pathInitialized, resourceId]);

  const folderPath = useMemo(() => {
    const segments = currentPath.split('/').filter(Boolean);
    const paths = [{ title: intl.formatMessage({ id: 'fileBrowser.root' }), id: '/' }];
    const firstSegment = segments[0];
    if (firstSegment) {
      paths.push({ title: firstSegment, id: `/${firstSegment}/` });
    }
    return paths;
  }, [currentPath, intl]);

  const sortedItems = useMemo(() => {
    return sortFileBrowserItems(items);
  }, [items]);

  const fileTreeData = useMemo(() => {
    return toFileTreeData(sortedItems, childrenByPath);
  }, [childrenByPath, sortedItems]);

  const knowledgeFolderPath = useMemo(() => {
    const segments = knowledgeDirectoryPath.split('/').filter(Boolean);
    const paths = [{ title: intl.formatMessage({ id: 'fileBrowser.root' }), id: '/' }];
    let accumulated = '/';
    for (const segment of segments) {
      accumulated += `${segment}/`;
      paths.push({ title: segment, id: accumulated });
    }
    return paths;
  }, [intl, knowledgeDirectoryPath]);

  const loadKnowledgeBases = useCallback(
    async (keyword = knowledgeKeyword) => {
      setKnowledgeLoading(true);
      try {
        const response = await queryDigEmployeeRelResourceAuth({
          resourceId,
          pageNum: 1,
          pageSize: 30,
          keyword: keyword.trim(),
          resourceStatus: '2',
          resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
        });
        const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        setKnowledgeBases(rows);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setKnowledgeLoading(false);
      }
    },
    [intl, knowledgeKeyword, resourceId]
  );

  const loadKnowledgeFolders = useCallback(
    async (kb: IKnowledgeBaseItem, directoryPath: string) => {
      setKnowledgeFolderLoading(true);
      try {
        const response = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath,
        });
        setKnowledgeFolders(
          unwrapListResponse<QueryDirAndFileByLevelItem>(response).filter((item) => item.type === 'directory')
        );
        setKnowledgeDirectoryPath(directoryPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setKnowledgeFolderLoading(false);
      }
    },
    [intl]
  );

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const target = folderPath[index];
      if (!target) return;
      setSearchValue('');
      setIsSearching(false);
      setChildrenByPath({});
      setCurrentPath(target.id);
    },
    [folderPath]
  );

  const handleSearch = useCallback(
    async (keyword: string) => {
      const nextKeyword = keyword.trim();
      if (!nextKeyword) {
        setIsSearching(false);
        setChildrenByPath({});
        fetchList(currentPath);
        return;
      }
      setIsSearching(true);
      setChildrenByPath({});
      setLoading(true);
      try {
        const res: any = await searchFiles({ resourceId, path: currentPath, keyword: nextKeyword });
        const data = res?.data ?? res ?? [];
        setItems(Array.isArray(data) ? data : []);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [currentPath, fetchList, intl, resourceId]
  );

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const renderPreviewPanel = useCallback(
    (item: FileBrowserItem, options: { blob?: Blob | null; loading: boolean }) => {
      setDetailPanel?.(
        <FilePreviewPanel
          blob={options.blob ?? null}
          fileName={item.name}
          fileType={getFileType(item.name)}
          loading={options.loading}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const handlePreview = useCallback(
    async (item: FileBrowserItem) => {
      if (!isPreviewable(item.name)) return;

      renderPreviewPanel(item, { loading: true });
      try {
        const res: any = await downloadFile(resourceId, item.path);
        const rawBlob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const mimeType = getMimeType(item.name);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        renderPreviewPanel(item, { blob, loading: false });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
        clearDetailPanel?.();
      }
    },
    [clearDetailPanel, intl, renderPreviewPanel, resourceId]
  );

  const handleDownload = useCallback(
    async (item: FileBrowserItem) => {
      const messageKey = isDirectory(item) ? 'folderDownload' : 'fileDownload';
      message.loading({
        content: intl.formatMessage({
          id: isDirectory(item) ? 'fileBrowser.download.folderDownloading' : 'fileBrowser.download.downloading',
        }),
        key: messageKey,
        duration: 0,
      });
      try {
        const res: any = isDirectory(item)
          ? await downloadFolder(resourceId, item.path)
          : await downloadFile(resourceId, item.path);
        const blob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res?.fileName || (isDirectory(item) ? `${item.name}.zip` : item.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        message.destroy(messageKey);
      } catch (error: any) {
        message.destroy(messageKey);
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.download.failed' }));
      }
    },
    [intl, resourceId]
  );

  const executeUpload = useCallback(
    async (targetPath: string, fileList: File[]) => {
      if (!fileList.length || uploadingFiles) return;
      const uploadPath = ensureDirectoryPath(targetPath || currentPath || '/');
      setUploadingFiles(true);
      try {
        await uploadFiles(resourceId, uploadPath, fileList);
        message.success(intl.formatMessage({ id: 'fileBrowser.upload.success' }));
        setUploadConfirmOpen(false);
        setPendingUploadFiles([]);
        setPendingUploadPath('');
        if (uploadPath === ensureDirectoryPath(currentPath)) {
          setSearchValue('');
          setIsSearching(false);
          setChildrenByPath({});
          await fetchList(currentPath);
          return;
        }
        const res: any = await listFiles({ resourceId, path: uploadPath });
        setChildrenByPath((prev) => ({
          ...prev,
          [uploadPath]: unwrapListResponse<FileBrowserItem>(res),
        }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      } finally {
        setUploadingFiles(false);
      }
    },
    [currentPath, fetchList, intl, resourceId, uploadingFiles]
  );

  const handleUploadSelect = useCallback((targetPath: string, fileList: File[]) => {
    if (!fileList.length) return;
    setPendingUploadPath(ensureDirectoryPath(targetPath));
    setPendingUploadFiles(fileList);
    setUploadConfirmOpen(true);
  }, []);

  const handleCancelUploadConfirm = useCallback(() => {
    if (uploadingFiles) return;
    setUploadConfirmOpen(false);
    setPendingUploadFiles([]);
    setPendingUploadPath('');
  }, [uploadingFiles]);

  const previewUploadFiles = pendingUploadFiles.slice(0, 3);
  const remainingUploadFileCount = pendingUploadFiles.length - previewUploadFiles.length;

  const loadTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      if (childrenByPath[path]) return;
      try {
        const res: any = await listFiles({ resourceId, path });
        setChildrenByPath((prev) => ({
          ...prev,
          [path]: unwrapListResponse<FileBrowserItem>(res),
        }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [childrenByPath, intl, resourceId]
  );

  const handleTreeNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      clearClickTimer();
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (isDirectory(node)) {
          if (isSearching || getPathDepth(currentPath) === 0) {
            setSearchValue('');
            setIsSearching(false);
            setChildrenByPath({});
            setCurrentPath(ensureDirectoryPath(node.path));
          }
          return;
        }
        void handlePreview(node);
      }, 220);
    },
    [clearClickTimer, currentPath, handlePreview, isSearching]
  );

  const handleItemDoubleClick = useCallback(
    (item: FileBrowserItem) => {
      clearClickTimer();
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, resourceId),
        type: isDirectory(item) ? DragType.folder : DragType.file,
      });
    },
    [EventEmitter, clearClickTimer, resourceId]
  );

  const openSaveToKnowledge = useCallback(
    (item: FileBrowserItem) => {
      clearClickTimer();
      setSaveTarget(item);
      setKnowledgeKeyword('');
      setSelectedKnowledgeBase(null);
      setKnowledgeDirectoryPath('/');
      setKnowledgeFolders([]);
      setSaveModalOpen(true);
      void loadKnowledgeBases('');
    },
    [clearClickTimer, loadKnowledgeBases]
  );

  const handleSelectKnowledgeBase = useCallback(
    (kb: IKnowledgeBaseItem) => {
      setSelectedKnowledgeBase(kb);
      void loadKnowledgeFolders(kb, '/');
    },
    [loadKnowledgeFolders]
  );

  const uploadFileToKnowledge = useCallback(
    async (item: FileBrowserItem, kb: IKnowledgeBaseItem, directoryPath: string) => {
      const res: any = await downloadFile(resourceId, item.path);
      const rawBlob = getRawBlob(res);
      const mimeType = rawBlob.type || getMimeType(item.name) || undefined;
      const file = new File([rawBlob], item.name, mimeType ? { type: mimeType } : undefined);
      const formData = new FormData();
      formData.append('resourceId', String(kb.resourceId));
      formData.append('directoryPath', directoryPath);
      formData.append('files', file);
      await uploadKnowledgeFiles(formData);
    },
    [resourceId]
  );

  const ensureKnowledgeFolder = useCallback(
    async (kb: IKnowledgeBaseItem, parentDirectoryPath: string, folderName: string) => {
      try {
        await createKnowledgeFolder({
          resourceId: Number(kb.resourceId),
          directoryName: folderName,
          directoryPath: parentDirectoryPath,
          directoryDescription: '',
        });
      } catch (error) {
        const response = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath: parentDirectoryPath,
        });
        const existed = unwrapListResponse<QueryDirAndFileByLevelItem>(response).some(
          (item) => item.type === 'directory' && item.name === folderName
        );
        if (!existed) {
          throw error;
        }
      }
    },
    []
  );

  const copyFileBrowserDirectoryToKnowledge = useCallback(
    async function copyDirectory(
      item: FileBrowserItem,
      kb: IKnowledgeBaseItem,
      parentDirectoryPath: string
    ): Promise<void> {
      const targetDirectoryPath = joinKnowledgeDirectoryPath(parentDirectoryPath, item.name);
      await ensureKnowledgeFolder(kb, parentDirectoryPath, item.name);

      const response = await listFiles({ resourceId, path: ensureDirectoryPath(item.path) });
      const children = unwrapListResponse<FileBrowserItem>(response);
      for (const child of children) {
        if (isDirectory(child)) {
          await copyDirectory(child, kb, targetDirectoryPath);
        } else {
          await uploadFileToKnowledge(child, kb, targetDirectoryPath);
        }
      }
    },
    [ensureKnowledgeFolder, resourceId, uploadFileToKnowledge]
  );

  const handleConfirmSaveToKnowledge = useCallback(async () => {
    if (!saveTarget) return;
    if (!selectedKnowledgeBase) {
      message.warning(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' }));
      return;
    }

    setSavingToKnowledge(true);
    try {
      if (isDirectory(saveTarget)) {
        await copyFileBrowserDirectoryToKnowledge(saveTarget, selectedKnowledgeBase, knowledgeDirectoryPath);
      } else {
        await uploadFileToKnowledge(saveTarget, selectedKnowledgeBase, knowledgeDirectoryPath);
      }
      message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
      setSaveModalOpen(false);
      setSaveTarget(null);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }));
    } finally {
      setSavingToKnowledge(false);
    }
  }, [
    copyFileBrowserDirectoryToKnowledge,
    intl,
    knowledgeDirectoryPath,
    message,
    saveTarget,
    selectedKnowledgeBase,
    uploadFileToKnowledge,
  ]);

  useEffect(() => {
    return clearClickTimer;
  }, [clearClickTimer]);

  return (
    <div className={styles.miniList}>
      <Input
        allowClear
        value={searchValue}
        suffix={<SearchOutlined onClick={() => handleSearch(searchValue)} />}
        placeholder={intl.formatMessage({ id: 'fileBrowser.toolbar.search' })}
        onChange={(event) => setSearchValue(event.target.value)}
        onPressEnter={() => handleSearch(searchValue)}
      />
      <div className={styles.breadcrumbBar}>
        {isSearching ? (
          <span className={styles.searchResult}>{searchValue}</span>
        ) : (
          <KnowledgeBreadcrumb folderPath={folderPath} handleBreadcrumbClick={handleBreadcrumbClick} />
        )}
      </div>
      <Spin spinning={loading} wrapperClassName={styles.listSpin}>
        <div className={styles.treeScroll}>
          {fileTreeData.length ? (
            <Tree.DirectoryTree
              showIcon
              selectable={false}
              treeData={fileTreeData}
              loadData={(node) => loadTreeNode(node as unknown as FileTreeItem)}
              icon={(node) => {
                const item = node as unknown as FileTreeItem;
                return (
                  <Tooltip title={item.name} placement="right">
                    <span>
                      <AntdIcon type={`icon-${getIconType(item.name, isDirectory(item))}`} />
                    </span>
                  </Tooltip>
                );
              }}
              className={`${commonStyles.tree} ${styles.fileTree}`}
              onClick={handleTreeNodeClick as any}
              onDoubleClick={(_, node) => handleItemDoubleClick(node as unknown as FileTreeItem)}
              titleRender={(item) => (
                <Tooltip title={item.name} placement="right">
                  <span className={styles.treeTitleContent}>
                    <span className={styles.treeTitleText}>{item.name}</span>
                    <Dropdown
                      trigger={['hover']}
                      overlayClassName={employeeStyles.mydropdown}
                      menu={{
                        items: [
                          {
                            key: 'upload',
                            label: (
                              <Upload
                                showUploadList={false}
                                multiple
                                beforeUpload={(_, fileList) => {
                                  const targetPath = isDirectory(item) ? item.path : getParentDirectoryPath(item.path);
                                  handleUploadSelect(targetPath, fileList as unknown as File[]);
                                  return false;
                                }}
                              >
                                <div className={employeeStyles.dropdownMenuItem}>
                                  {intl.formatMessage({ id: 'fileBrowser.toolbar.upload' })}
                                </div>
                              </Upload>
                            ),
                          },
                          {
                            key: 'download',
                            label: (
                              <div className={employeeStyles.dropdownMenuItem}>
                                {intl.formatMessage({ id: 'directoryManage.downloadFile' })}
                              </div>
                            ),
                          },
                          {
                            key: 'saveToKnowledge',
                            label: (
                              <div className={employeeStyles.dropdownMenuItem}>
                                {intl.formatMessage({ id: 'fileSider.saveToKnowledge' })}
                              </div>
                            ),
                          },
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'download') {
                            void handleDownload(item as FileTreeItem);
                          } else if (key === 'saveToKnowledge') {
                            openSaveToKnowledge(item as FileTreeItem);
                          }
                        },
                      }}
                    >
                      <EllipsisOutlined
                        className={commonStyles.treeActionIcon}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </span>
                </Tooltip>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'fileBrowser.empty' })} />
          )}
        </div>
      </Spin>
      <Modal
        title={intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmTitle' })}
        open={uploadConfirmOpen}
        okText={intl.formatMessage({ id: 'fileBrowser.toolbar.upload' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={uploadingFiles}
        onOk={() => executeUpload(pendingUploadPath, pendingUploadFiles)}
        onCancel={handleCancelUploadConfirm}
        destroyOnClose
        width="50vw"
        style={{ minWidth: 640, maxWidth: 960 }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space
            direction="vertical"
            size={12}
            style={{
              width: '100%',
              padding: 16,
              border: '1px solid #f0f0f0',
              borderRadius: 10,
              background: '#fafafa',
            }}
          >
            <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.uploadInfo' })}</Typography.Text>
            <div style={{ display: 'grid', gridTemplateColumns: '86px minmax(0, 1fr)', rowGap: 8, columnGap: 12 }}>
              <Typography.Text type="secondary">
                {intl.formatMessage({ id: 'knowledgeDetail.uploadDirectory' })}
              </Typography.Text>
              <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
                {pendingUploadPath || '/'}
              </Typography.Text>
              <Typography.Text type="secondary">
                {intl.formatMessage({ id: 'knowledgeDetail.selectedFiles' })}
              </Typography.Text>
              <Typography.Text>
                {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmFiles' }, { count: pendingUploadFiles.length })}
              </Typography.Text>
            </div>

            <div style={{ width: '100%', padding: 12, borderRadius: 10, background: '#fff' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.fileList' })}</Typography.Text>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {previewUploadFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: '#f7f8fa',
                      }}
                    >
                      <Typography.Text ellipsis style={{ flex: 1, maxWidth: '100%' }}>
                        {file.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ flex: 'none', fontSize: 12 }}>
                        {formatFileSize(file.size)}
                      </Typography.Text>
                    </div>
                  ))}
                </Space>
                {remainingUploadFileCount > 0 && (
                  <Typography.Text type="secondary">
                    {intl.formatMessage(
                      { id: 'knowledgeDetail.uploadConfirmMoreFiles' },
                      { count: remainingUploadFileCount }
                    )}
                  </Typography.Text>
                )}
              </Space>
            </div>
          </Space>
        </Space>
      </Modal>
      <Modal
        open={saveModalOpen}
        title={intl.formatMessage({ id: 'fileSider.saveToKnowledge' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={savingToKnowledge}
        okButtonProps={{ disabled: !selectedKnowledgeBase }}
        onOk={handleConfirmSaveToKnowledge}
        onCancel={() => {
          if (savingToKnowledge) return;
          setSaveModalOpen(false);
          setSaveTarget(null);
        }}
        destroyOnClose
      >
        {!selectedKnowledgeBase ? (
          <>
            <Input.Search
              allowClear
              value={knowledgeKeyword}
              placeholder={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.searchPlaceholder' })}
              onChange={(event) => setKnowledgeKeyword(event.target.value)}
              onSearch={() => loadKnowledgeBases()}
              style={{ marginBottom: 12 }}
            />
            <Spin spinning={knowledgeLoading}>
              <List
                dataSource={knowledgeBases}
                locale={{ emptyText: intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' }) }}
                renderItem={(kb) => (
                  <List.Item onClick={() => handleSelectKnowledgeBase(kb)} style={{ cursor: 'pointer' }}>
                    <List.Item.Meta
                      avatar={<AntdIcon type="icon-zhishi" />}
                      title={<Typography.Text>{kb.resourceName}</Typography.Text>}
                      description={kb.resourceDesc}
                    />
                  </List.Item>
                )}
              />
            </Spin>
          </>
        ) : (
          <>
            <Button
              size="small"
              style={{ marginBottom: 12 }}
              onClick={() => {
                setSelectedKnowledgeBase(null);
                setKnowledgeFolders([]);
                setKnowledgeDirectoryPath('/');
              }}
            >
              {intl.formatMessage({ id: 'fileSider.saveToKnowledge.backToList' })}
            </Button>
            <Typography.Paragraph strong ellipsis>
              {selectedKnowledgeBase.resourceName}
            </Typography.Paragraph>
            <KnowledgeBreadcrumb
              folderPath={knowledgeFolderPath}
              handleBreadcrumbClick={(index) => {
                const target = knowledgeFolderPath[index];
                if (target && selectedKnowledgeBase) {
                  void loadKnowledgeFolders(selectedKnowledgeBase, target.id);
                }
              }}
            />
            <Spin spinning={knowledgeFolderLoading}>
              <List
                dataSource={knowledgeFolders}
                locale={{ emptyText: intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' }) }}
                renderItem={(folder) => (
                  <List.Item
                    onClick={() => {
                      if (!selectedKnowledgeBase) return;
                      const nextPath =
                        String(folder.directoryPath ?? '').trim() ||
                        joinKnowledgeDirectoryPath(knowledgeDirectoryPath, folder.name);
                      void loadKnowledgeFolders(
                        selectedKnowledgeBase,
                        nextPath.startsWith('/') ? nextPath : `/${nextPath}`
                      );
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <List.Item.Meta
                      avatar={<AntdIcon type="icon-wenjianjialanse" />}
                      title={<Typography.Text>{folder.name}</Typography.Text>}
                    />
                  </List.Item>
                )}
              />
            </Spin>
          </>
        )}
      </Modal>
    </div>
  );
};

export default FileMiniList;
