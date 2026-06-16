import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Input, List, Spin, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import { DragType } from '@/components/QueryInput/withDrag';
import InfiniteScrollAntdList from '@/layout/sider/components/InfiniteScrollAntdList';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import { downloadFile, getDefaultPath, listFiles, searchFiles, type FileBrowserItem } from '@/service/fileBrowser';
import styles from './index.module.less';

const { Title, Paragraph } = Typography;
const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

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

function isDirectory(item: FileBrowserItem) {
  return item.isDir || (item as any).dir;
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
    let accumulated = '/';
    for (const segment of segments) {
      accumulated += `${segment}/`;
      paths.push({ title: segment, id: accumulated });
    }
    return paths;
  }, [currentPath, intl]);

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const target = folderPath[index];
      if (!target) return;
      setSearchValue('');
      setIsSearching(false);
      setCurrentPath(target.id);
    },
    [folderPath]
  );

  const handleSearch = useCallback(
    async (keyword: string) => {
      const nextKeyword = keyword.trim();
      if (!nextKeyword) {
        setIsSearching(false);
        fetchList(currentPath);
        return;
      }
      setIsSearching(true);
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

  const handleItemClick = useCallback(
    (item: FileBrowserItem) => {
      clearClickTimer();
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (isDirectory(item)) {
          setSearchValue('');
          setIsSearching(false);
          setCurrentPath(item.path.endsWith('/') ? item.path : `${item.path}/`);
        } else {
          void handlePreview(item);
        }
      }, 220);
    },
    [clearClickTimer, handlePreview]
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
        <InfiniteScrollAntdList
          className={employeeStyles.employeesList}
          dataSource={items}
          hasMore={false}
          loading={false}
          next={() => {}}
          renderEmpty={
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'fileBrowser.empty' })} />
          }
          renderItem={(item: FileBrowserItem) => {
            const dir = isDirectory(item);
            return (
              <List.Item
                key={item.path}
                className={styles.fileItem}
                onClick={() => handleItemClick(item)}
                onDoubleClick={() => handleItemDoubleClick(item)}
              >
                <List.Item.Meta
                  avatar={
                    <span className={styles.fileAvatar}>
                      <AntdIcon type={`icon-${getIconType(item.name, dir)}`} />
                    </span>
                  }
                  title={
                    <Title className={employeeStyles.name}>
                      <span className={employeeStyles.nameRow} title={item.name}>
                        <span className={employeeStyles.nameText}>{item.name}</span>
                      </span>
                    </Title>
                  }
                  description={
                    <Paragraph
                      className={employeeStyles.description}
                      ellipsis={{ tooltip: { title: item.path, placement: 'right' } }}
                    >
                      {item.path}
                    </Paragraph>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Spin>
    </div>
  );
};

export default FileMiniList;
