import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, message, Modal, Spin, Tooltip, Upload } from 'antd';
import { CaretUpOutlined, CaretDownOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import ButtonsWithMore from '@/components/ButtonsWithMore';
import InfiniteScrollTable from '@/components/InfiniteScrollTable';
import { HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import { getFileIconType } from '@/constants/icon';
import {
  listFiles,
  uploadFiles,
  downloadFile,
  downloadFolder,
  deleteFiles,
  renameFile,
  moveFiles,
  createFolder,
  getDefaultPath,
  searchFiles,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import { formatFileSize, isPreviewable, getMimeType } from './constants';
import RenameModal from './RenameModal';
import MoveModal from './MoveModal';
import styles from './index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

interface FileBrowserPanelProps {
  resourceId: string;
  mode?: 'full' | 'preview';
}

interface FilePreviewPanelProps {
  blob: Blob | null;
  fileName: string;
  fileType: string;
  loading: boolean;
  onClose: () => void;
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

function canPreviewFile(record: FileBrowserItem) {
  const isDir = record.isDir || (record as any).dir;
  return !isDir && isPreviewable(record.name);
}

type SortField = 'name' | 'size' | 'lastModified';
type SortOrder = 'asc' | 'desc' | 'none';

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

const FileBrowserPanel: React.FC<FileBrowserPanelProps> = ({ resourceId, mode = 'full' }) => {
  const intl = useIntl();
  const t = useCallback((id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values), [intl]);
  const isPreviewMode = mode === 'preview';
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);

  const [currentPath, setCurrentPath] = useState<string>('');
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInitialized, setPathInitialized] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileBrowserItem | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [movePaths, setMovePaths] = useState<string[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);

  const [createFolderLoading, setCreateFolderLoading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState('');
  const [downloadingPaths, setDownloadingPaths] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('none');
  const [inputKeyword, setInputKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const fetchList = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const res: any = await listFiles({ resourceId, path });
        const data = res?.data ?? res ?? [];
        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.error.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [resourceId, t]
  );

  useEffect(() => {
    if (!resourceId) return;
    getDefaultPath(resourceId)
      .then((res: any) => {
        const defaultPath = res?.data ?? res ?? '/';
        setCurrentPath(defaultPath);
        setPathInitialized(true);
      })
      .catch(() => {
        setCurrentPath('/');
        setPathInitialized(true);
      });
  }, [resourceId]);

  useEffect(() => {
    if (resourceId && pathInitialized && currentPath) fetchList(currentPath);
  }, [resourceId, currentPath, pathInitialized, fetchList]);

  const sortedItems = useMemo(() => {
    const dirs = items.filter((i) => i.isDir || (i as any).dir);
    const files = items.filter((i) => !i.isDir && !(i as any).dir);

    const sortFn = (a: FileBrowserItem, b: FileBrowserItem) => {
      if (sortOrder === 'none') return 0;
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case 'lastModified':
          cmp = (a.lastModified || '').localeCompare(b.lastModified || '');
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    };

    const sortedDirs = [...dirs].sort(sortFn);
    const sortedFiles = [...files].sort(sortFn);
    return [...sortedDirs, ...sortedFiles];
  }, [items, sortField, sortOrder]);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField !== field) {
        setSortField(field);
        setSortOrder('asc');
      } else {
        setSortOrder((prev) => {
          if (prev === 'none') return 'asc';
          if (prev === 'asc') return 'desc';
          return 'none';
        });
      }
    },
    [sortField]
  );

  const getSortIcon = useCallback(
    (field: SortField) => {
      const isActive = sortField === field && sortOrder !== 'none';
      const activeColor = 'var(--beyond-color-primary, #1677ff)';
      const inactiveColor = '#bfbfbf';
      return (
        <span className={styles.sortIcons}>
          <CaretUpOutlined
            style={{ color: isActive && sortOrder === 'asc' ? activeColor : inactiveColor, fontSize: 10 }}
          />
          <CaretDownOutlined
            style={{ color: isActive && sortOrder === 'desc' ? activeColor : inactiveColor, fontSize: 10 }}
          />
        </span>
      );
    },
    [sortField, sortOrder]
  );

  const folderPath = useMemo(() => {
    const segments = currentPath.split('/').filter(Boolean);
    const paths = [{ title: t('fileBrowser.root'), id: '/' }];
    let accumulated = '/';
    for (const seg of segments) {
      accumulated += seg + '/';
      paths.push({ title: seg, id: accumulated });
    }
    return paths;
  }, [currentPath, t]);

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const target = folderPath[index];
      if (target) {
        setCurrentPath(target.id);
      }
    },
    [folderPath]
  );

  const handleGoBack = useCallback(() => {
    if (folderPath.length <= 1) return;
    const parent = folderPath[folderPath.length - 2];
    if (parent) setCurrentPath(parent.id);
  }, [folderPath]);

  const handleEnterDir = useCallback((item: FileBrowserItem) => {
    setInputKeyword('');
    setSearchKeyword('');
    setIsSearching(false);
    setCurrentPath(item.path.endsWith('/') ? item.path : item.path + '/');
  }, []);

  const handleRefresh = useCallback(() => {
    setInputKeyword('');
    setSearchKeyword('');
    setIsSearching(false);
    fetchList(currentPath);
  }, [currentPath, fetchList]);

  const handleSearch = useCallback(
    async (keyword: string) => {
      if (!keyword.trim()) {
        setIsSearching(false);
        setSearchKeyword('');
        fetchList(currentPath);
        return;
      }
      setSearchKeyword(keyword);
      setIsSearching(true);
      setLoading(true);
      try {
        const res: any = await searchFiles({ resourceId, path: currentPath, keyword: keyword.trim() });
        const data = res?.data ?? res ?? [];
        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.error.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [resourceId, currentPath, t, fetchList]
  );

  const handleUpload = useCallback(
    async (fileList: File[]) => {
      if (!fileList.length) return;
      try {
        await uploadFiles(resourceId, currentPath, fileList);
        message.success(t('fileBrowser.upload.success'));
        handleRefresh();
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.upload.failed'));
      }
    },
    [resourceId, currentPath, t, handleRefresh]
  );

  const handleDownload = useCallback(
    async (item: FileBrowserItem) => {
      if (downloadingPaths.has(item.path)) return;
      setDownloadingPaths((prev) => new Set(prev).add(item.path));
      try {
        message.loading({ content: t('fileBrowser.download.folderDownloading'), key: 'fileDownload', duration: 0 });
        const res: any = await downloadFile(resourceId, item.path);
        const blob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res?.fileName || item.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        message.destroy('fileDownload');
      } catch (e: any) {
        message.destroy('fileDownload');
        message.error(e?.message || t('fileBrowser.download.failed'));
      } finally {
        setDownloadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(item.path);
          return next;
        });
      }
    },
    [resourceId, t, downloadingPaths]
  );

  const handleDownloadFolder = useCallback(
    async (item: FileBrowserItem) => {
      if (downloadingPaths.has(item.path)) return;
      setDownloadingPaths((prev) => new Set(prev).add(item.path));
      try {
        message.loading({ content: t('fileBrowser.download.folderDownloading'), key: 'folderDownload', duration: 0 });
        const res: any = await downloadFolder(resourceId, item.path);
        const blob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.name}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        message.destroy('folderDownload');
      } catch (e: any) {
        message.destroy('folderDownload');
        message.error(e?.message || t('fileBrowser.download.failed'));
      } finally {
        setDownloadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(item.path);
          return next;
        });
      }
    },
    [resourceId, t, downloadingPaths]
  );

  const handleDelete = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      try {
        await deleteFiles({ resourceId, paths });
        message.success(t('fileBrowser.delete.success'));
        handleRefresh();
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.delete.failed'));
      }
    },
    [resourceId, t, handleRefresh]
  );

  const handleRenameOk = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      setRenameLoading(true);
      try {
        await renameFile({ resourceId, sourcePath: renameTarget.path, newName });
        message.success(t('fileBrowser.rename.success'));
        setRenameOpen(false);
        handleRefresh();
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.rename.failed'));
      } finally {
        setRenameLoading(false);
      }
    },
    [renameTarget, resourceId, t, handleRefresh]
  );

  const handleMoveOk = useCallback(
    async (targetDirectory: string) => {
      setMoveLoading(true);
      try {
        await moveFiles({ resourceId, sourcePaths: movePaths, targetDirectory });
        message.success(t('fileBrowser.move.success'));
        setMoveOpen(false);
        setMovePaths([]);
        handleRefresh();
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.move.failed'));
      } finally {
        setMoveLoading(false);
      }
    },
    [resourceId, movePaths, t, handleRefresh]
  );

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
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.preview.failed'));
        clearDetailPanel?.();
      }
    },
    [clearDetailPanel, renderPreviewPanel, resourceId, t]
  );

  const handleCreateFolder = useCallback(async () => {
    if (!createFolderName.trim()) return;
    setCreateFolderLoading(true);
    try {
      const path = currentPath.endsWith('/')
        ? `${currentPath}${createFolderName.trim()}/`
        : `${currentPath}/${createFolderName.trim()}/`;
      await createFolder({ resourceId, path });
      message.success(t('fileBrowser.createFolder.success'));
      setCreateFolderOpen(false);
      setCreateFolderName('');
      handleRefresh();
    } catch (e: any) {
      message.error(e?.message || t('fileBrowser.createFolder.failed'));
    } finally {
      setCreateFolderLoading(false);
    }
  }, [currentPath, createFolderName, resourceId, t, handleRefresh]);

  const handleAction = useCallback(
    (key: string, record: FileBrowserItem) => {
      const isDir = record.isDir || (record as any).dir;
      switch (key) {
        case 'preview':
          handlePreview(record);
          break;
        case 'download':
          if (isDir) {
            handleDownloadFolder(record);
          } else {
            handleDownload(record);
          }
          break;
        case 'rename':
          setRenameTarget(record);
          setRenameOpen(true);
          break;
        case 'move':
          setMovePaths([record.path]);
          setMoveOpen(true);
          break;
        case 'delete':
          Modal.confirm({
            title: t('fileBrowser.delete.confirm'),
            content: t('fileBrowser.delete.confirmName', { name: record.name }),
            onOk: () => handleDelete([record.path]),
          });
          break;
        case 'info':
          Modal.info({
            title: t('fileBrowser.action.info'),
            content: (
              <div>
                <p>
                  <b>{t('fileBrowser.column.name')}:</b> {record.name}
                </p>
                <p>
                  <b>{t('fileBrowser.info.path')}:</b> {record.path}
                </p>
                <p>
                  <b>{t('fileBrowser.column.size')}:</b>{' '}
                  {record.isDir || (record as any).dir ? '-' : formatFileSize(record.size)}
                </p>
                <p>
                  <b>{t('fileBrowser.column.lastModified')}:</b>{' '}
                  {record.lastModified ? new Date(record.lastModified).toLocaleString() : '-'}
                </p>
              </div>
            ),
            okText: t('fileBrowser.info.ok'),
          });
          break;
        case 'locate': {
          const path = record.path;
          const parentPath = isDir ? path.replace(/[^/]+\/?$/, '') : path.replace(/[^/]+$/, '');
          setInputKeyword('');
          setSearchKeyword('');
          setIsSearching(false);
          setCurrentPath(parentPath || '/');
          break;
        }
      }
    },
    [handleDownload, handleDownloadFolder, handleDelete, handlePreview, t]
  );

  const getActions = useCallback(
    (record: FileBrowserItem) => {
      const actions: any[] = [];

      if (isSearching) {
        actions.push({
          label: t('fileBrowser.action.locate'),
          key: 'locate',
          icon: (
            <Tooltip title={t('fileBrowser.action.locate')}>
              <span className="iconfont icon-a-Localyidingwei" />
            </Tooltip>
          ),
        });
      }

      if (canPreviewFile(record)) {
        actions.push({
          label: t('fileBrowser.action.preview'),
          key: 'preview',
          icon: (
            <Tooltip title={t('fileBrowser.action.preview')}>
              <span className="iconfont icon-a-Preview-openyulan-dakai" />
            </Tooltip>
          ),
        });
      }

      actions.push({
        label: t('fileBrowser.action.download'),
        key: 'download',
        disabled: downloadingPaths.has(record.path),
        icon: (
          <Tooltip title={t('fileBrowser.action.download')}>
            <span className="iconfont icon-a-Downloadxiazai" />
          </Tooltip>
        ),
      });

      if (!isPreviewMode) {
        actions.push({
          label: t('fileBrowser.action.info'),
          key: 'info',
          icon: (
            <Tooltip title={t('fileBrowser.action.info')}>
              <span className="iconfont icon-a-Infoxinxi" />
            </Tooltip>
          ),
        });

        actions.push({
          label: t('fileBrowser.action.rename'),
          key: 'rename',
          icon: (
            <Tooltip title={t('fileBrowser.action.rename')}>
              <span className="iconfont icon-a-Editbianji" />
            </Tooltip>
          ),
        });

        actions.push({
          label: t('fileBrowser.action.delete'),
          key: 'delete',
          icon: (
            <Tooltip title={t('fileBrowser.action.delete')}>
              <span className="iconfont icon-a-Deleteshanchu" />
            </Tooltip>
          ),
        });
      }

      return actions;
    },
    [t, isSearching, downloadingPaths, isPreviewMode]
  );

  const columns = useMemo(() => {
    const nameColumn = {
      title: (
        <span className={styles.sortableHeader} onClick={() => toggleSort('name')}>
          {t('fileBrowser.column.name')} {getSortIcon('name')}
        </span>
      ),
      dataIndex: 'name',
      width: isPreviewMode ? '85%' : '40%',
      render: (v: string, record: FileBrowserItem) => {
        const isDir = record.isDir || (record as any).dir;
        const canPreview = canPreviewFile(record);
        const iconType = getFileIconType(v, { isDirectory: isDir });
        const cursor = isDir || canPreview ? 'pointer' : 'default';
        const style: React.CSSProperties = { cursor };
        const onClick = isDir
          ? () => handleEnterDir(record)
          : canPreview
            ? () => handlePreview(record)
            : () => message.warning(t('fileBrowser.preview.unavailable'));

        return (
          <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', ...style }} title={record.path}>
            <AntdIcon type={`icon-${iconType}`} style={{ fontSize: 24, marginRight: 14, flexShrink: 0 }} />
            <div style={{ overflow: 'hidden' }}>
              <div className="textEllipsis" style={{ cursor }}>
                {v}
              </div>
              {isSearching && <div className={styles.searchPath}>{record.path}</div>}
            </div>
          </div>
        );
      },
    };
    const sizeColumn = {
      title: (
        <span className={styles.sortableHeader} onClick={() => toggleSort('size')}>
          {t('fileBrowser.column.size')} {getSortIcon('size')}
        </span>
      ),
      dataIndex: 'size',
      width: '15%',
      render: (v: number, record: FileBrowserItem) => {
        const isDir = record.isDir || (record as any).dir;
        return isDir ? '-' : formatFileSize(v);
      },
    };
    const modifiedColumn = {
      title: (
        <span className={styles.sortableHeader} onClick={() => toggleSort('lastModified')}>
          {t('fileBrowser.column.lastModified')} {getSortIcon('lastModified')}
        </span>
      ),
      dataIndex: 'lastModified',
      width: '20%',
      render: (v: string) => {
        if (!v) return '-';
        try {
          return new Date(v).toLocaleString();
        } catch {
          return v;
        }
      },
    };
    const actionColumn = {
      title: t('fileBrowser.column.actions'),
      dataIndex: 'actions',
      width: isPreviewMode ? '15%' : '25%',
      render: (_: any, record: FileBrowserItem) => {
        const actions = getActions(record);
        if (!actions.length) return null;
        return (
          <ButtonsWithMore
            actions={actions}
            maximun={isPreviewMode ? 3 : 4}
            handleAction={(key) => handleAction(key, record)}
          />
        );
      },
    };

    return isPreviewMode ? [nameColumn, actionColumn] : [nameColumn, sizeColumn, modifiedColumn, actionColumn];
  }, [t, getActions, handleAction, handleEnterDir, handlePreview, toggleSort, getSortIcon, isSearching, isPreviewMode]);

  return (
    <div className={`${styles.fileBrowserPanel} ${isPreviewMode ? styles.previewMode : ''}`}>
      <div className={styles.toolbar}>
        {!isPreviewMode && (
          <>
            <Upload
              showUploadList={false}
              multiple
              beforeUpload={(_, fileList) => {
                handleUpload(fileList as unknown as File[]);
                return false;
              }}
            >
              <Button icon={<AntdIcon type="icon-a-Uploadshangchuan" style={{ fontSize: 18 }} />} size="small">
                {t('fileBrowser.toolbar.upload')}
              </Button>
            </Upload>
            <Button
              icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" style={{ fontSize: 18 }} />}
              size="small"
              onClick={() => {
                setCreateFolderName('');
                setCreateFolderOpen(true);
              }}
            >
              {t('fileBrowser.toolbar.newFolder')}
            </Button>
          </>
        )}
        <div className={styles.toolbarRight}>
          <Input
            className={styles.searchInput}
            allowClear
            value={inputKeyword}
            suffix={<SearchOutlined onClick={() => handleSearch(inputKeyword)} />}
            placeholder={t('fileBrowser.toolbar.search')}
            onChange={(event) => setInputKeyword(event.target.value)}
            onPressEnter={() => handleSearch(inputKeyword)}
            size="small"
          />
          {!isPreviewMode && <Button icon={<ReloadOutlined />} size="small" onClick={handleRefresh} />}
        </div>
      </div>

      {isSearching ? (
        <div className={styles.breadcrumbBar}>
          <span className={styles.searchResult}>
            {sortedItems.length > 0
              ? t('fileBrowser.search.result', { keyword: searchKeyword, count: sortedItems.length })
              : t('fileBrowser.search.noResult')}
          </span>
        </div>
      ) : (
        <div className={styles.breadcrumbBar}>
          {!isPreviewMode && (
            <Tooltip title={t('fileBrowser.toolbar.back')}>
              <span
                className={styles.backBtn}
                onClick={handleGoBack}
                style={{
                  opacity: folderPath.length <= 1 ? 0.3 : 1,
                  cursor: folderPath.length <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <AntdIcon type="icon-a-Returnfanhui" style={{ fontSize: 16 }} />
              </span>
            </Tooltip>
          )}
          {!isPreviewMode && <AntdIcon type="icon-a-Homeshouye" style={{ fontSize: 16 }} />}
          <KnowledgeBreadcrumb folderPath={folderPath} handleBreadcrumbClick={handleBreadcrumbClick} />
        </div>
      )}

      <div className={styles.content}>
        <InfiniteScrollTable
          next={() => {}}
          hasMore={false}
          dataSource={sortedItems}
          columns={columns}
          rowKey="path"
          emptyLocale={{
            emptyText: <Empty description={t('fileBrowser.empty')} />,
          }}
          endMessage={null}
          scrollDivId="fileBrowserTable"
          loading={loading}
        />
      </div>

      <RenameModal
        open={renameOpen}
        currentName={renameTarget?.name || ''}
        onOk={handleRenameOk}
        onCancel={() => setRenameOpen(false)}
        loading={renameLoading}
      />
      <MoveModal
        open={moveOpen}
        resourceId={resourceId}
        onOk={handleMoveOk}
        onCancel={() => setMoveOpen(false)}
        loading={moveLoading}
      />
      <Modal
        title={t('fileBrowser.toolbar.newFolder')}
        open={createFolderOpen}
        onOk={handleCreateFolder}
        onCancel={() => setCreateFolderOpen(false)}
        confirmLoading={createFolderLoading}
        destroyOnHidden
      >
        <Input
          value={createFolderName}
          onChange={(e) => setCreateFolderName(e.target.value)}
          placeholder={t('fileBrowser.createFolder.prompt')}
          onPressEnter={handleCreateFolder}
          autoFocus
        />
      </Modal>
    </div>
  );
};

export default FileBrowserPanel;
