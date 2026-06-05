import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, message, Modal, Spin, Tooltip, Upload } from 'antd';
import { CaretUpOutlined, CaretDownOutlined, ReloadOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import ButtonsWithMore from '@/components/ButtonsWithMore';
import InfiniteScrollTable from '@/components/InfiniteScrollTable';
import {
  listFiles,
  uploadFiles,
  downloadFile,
  deleteFiles,
  renameFile,
  moveFiles,
  createFolder,
  getDefaultPath,
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
}

function getIconType(name: string, isDir: boolean): string {
  if (isDir) return 'wenjianjia';
  if (/\.(doc|docx)$/i.test(name)) return 'Word';
  if (/\.pdf$/i.test(name)) return 'PDF';
  if (/\.(xls|xlsx|csv)$/i.test(name)) return 'Excel';
  if (/\.txt$/i.test(name)) return 'jishiben';
  if (/\.(ppt|pptx)$/i.test(name)) return 'PPT';
  if (/\.md$/i.test(name)) return 'markdown';
  if (/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(name)) return 'Image';
  if (/\.(mp4|avi|mov|mkv|webm)$/i.test(name)) return 'shipin';
  if (/\.(mp3|wav|flac)$/i.test(name)) return 'yinpin';
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'a-Data-fileshujuwenjian';
  if (/\.(js|ts|jsx|tsx|py|java|c|cpp|go|rs|rb|sh)$/i.test(name)) return 'a-Codedaima';
  return 'a-Data-fileshujuwenjian';
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return 'image';
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

type SortField = 'name' | 'size' | 'lastModified';
type SortOrder = 'asc' | 'desc' | 'none';

const FileBrowserPanel: React.FC<FileBrowserPanelProps> = ({ resourceId }) => {
  const intl = useIntl();
  const t = useCallback((id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values), [intl]);

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

  const [previewInfo, setPreviewInfo] = useState<{
    open: boolean;
    blob: Blob | null;
    loading: boolean;
    fileName: string;
    fileType: string;
  }>({
    open: false,
    blob: null,
    loading: false,
    fileName: '',
    fileType: '',
  });

  const [createFolderLoading, setCreateFolderLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('none');

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
    setCurrentPath(item.path.endsWith('/') ? item.path : item.path + '/');
  }, []);

  const handleRefresh = useCallback(() => {
    fetchList(currentPath);
  }, [currentPath, fetchList]);

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
      try {
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
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.download.failed'));
      }
    },
    [resourceId, t]
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

  const handlePreview = useCallback(
    async (item: FileBrowserItem) => {
      setPreviewInfo({ open: true, blob: null, loading: true, fileName: item.name, fileType: getFileType(item.name) });
      try {
        const res: any = await downloadFile(resourceId, item.path);
        const rawBlob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const mimeType = getMimeType(item.name);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        setPreviewInfo((prev) => ({ ...prev, blob, loading: false }));
      } catch (e: any) {
        message.error(e?.message || t('fileBrowser.preview.failed'));
        setPreviewInfo((prev) => ({ ...prev, open: false, loading: false }));
      }
    },
    [resourceId, t]
  );

  const handleCreateFolder = useCallback(async () => {
    const folderName = window.prompt(t('fileBrowser.createFolder.prompt'));
    if (!folderName?.trim()) return;
    setCreateFolderLoading(true);
    try {
      const path = currentPath.endsWith('/')
        ? `${currentPath}${folderName.trim()}/`
        : `${currentPath}/${folderName.trim()}/`;
      await createFolder({ resourceId, path });
      message.success(t('fileBrowser.createFolder.success'));
      handleRefresh();
    } catch (e: any) {
      message.error(e?.message || t('fileBrowser.createFolder.failed'));
    } finally {
      setCreateFolderLoading(false);
    }
  }, [currentPath, resourceId, t, handleRefresh]);

  const handleAction = useCallback(
    (key: string, record: FileBrowserItem) => {
      switch (key) {
        case 'preview':
          handlePreview(record);
          break;
        case 'download':
          handleDownload(record);
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
      }
    },
    [handlePreview, handleDownload, handleDelete, t]
  );

  const getActions = useCallback(
    (record: FileBrowserItem) => {
      const isDir = record.isDir || (record as any).dir;
      const actions: any[] = [];

      if (!isDir && isPreviewable(record.name)) {
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

      if (!isDir) {
        actions.push({
          label: t('fileBrowser.action.download'),
          key: 'download',
          icon: (
            <Tooltip title={t('fileBrowser.action.download')}>
              <span className="iconfont icon-a-Downloadxiazai" />
            </Tooltip>
          ),
        });
      }

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

      return actions;
    },
    [t]
  );

  const columns = useMemo(
    () => [
      {
        title: (
          <span className={styles.sortableHeader} onClick={() => toggleSort('name')}>
            {t('fileBrowser.column.name')} {getSortIcon('name')}
          </span>
        ),
        dataIndex: 'name',
        width: '40%',
        render: (v: string, record: FileBrowserItem) => {
          const isDir = record.isDir || (record as any).dir;
          const iconType = getIconType(v, isDir);
          const style: React.CSSProperties = isDir ? { cursor: 'pointer' } : {};
          const onClick = isDir ? () => handleEnterDir(record) : undefined;

          return (
            <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', ...style }} title={v}>
              <AntdIcon type={`icon-${iconType}`} style={{ fontSize: 24, marginRight: 14 }} />
              <div className="textEllipsis">{v}</div>
            </div>
          );
        },
      },
      {
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
      },
      {
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
      },
      {
        title: t('fileBrowser.column.actions'),
        dataIndex: 'actions',
        width: '25%',
        render: (_: any, record: FileBrowserItem) => {
          const actions = getActions(record);
          if (!actions.length) return null;
          return <ButtonsWithMore actions={actions} maximun={4} handleAction={(key) => handleAction(key, record)} />;
        },
      },
    ],
    [t, getActions, handleAction, handleEnterDir, toggleSort, getSortIcon]
  );

  return (
    <div className={styles.fileBrowserPanel}>
      <div className={styles.toolbar}>
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
          onClick={handleCreateFolder}
          loading={createFolderLoading}
        >
          {t('fileBrowser.toolbar.newFolder')}
        </Button>
        <div className={styles.toolbarRight}>
          <Button icon={<ReloadOutlined />} size="small" onClick={handleRefresh} />
        </div>
      </div>

      <div className={styles.breadcrumbBar}>
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
        <AntdIcon type="icon-a-Homeshouye" style={{ fontSize: 16 }} />
        <KnowledgeBreadcrumb folderPath={folderPath} handleBreadcrumbClick={handleBreadcrumbClick} />
      </div>

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
        centered
        destroyOnHidden
        open={previewInfo.open}
        title=""
        width="90vw"
        onCancel={() => setPreviewInfo((prev) => ({ ...prev, open: false, blob: null }))}
        footer={null}
        closable={false}
        styles={{
          content: { padding: 0, height: '90vh' },
          body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' },
        }}
      >
        <Spin spinning={previewInfo.loading} wrapperClassName="full-height-spin" style={{ flex: 1, minHeight: 0 }}>
          {previewInfo.blob && (
            <React.Suspense fallback={null}>
              <PreViewFile
                data={previewInfo.blob}
                type={previewInfo.fileType}
                title={previewInfo.fileName}
                className={styles.preview}
                extra={
                  <span
                    className={styles.previewClose}
                    onClick={() => setPreviewInfo((prev) => ({ ...prev, open: false, blob: null }))}
                  >
                    <AntdIcon type="icon-a-Closeguanbi1" />
                  </span>
                }
              />
            </React.Suspense>
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default FileBrowserPanel;
