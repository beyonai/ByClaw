import {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useContext,
  lazy,
  useRef,
  useState,
  Suspense,
} from 'react';

// @ts-ignore
import { getLocale, useIntl } from '@umijs/max';
import { FileSearchOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import { App, Modal, Spin, Tooltip } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import ButtonsWithMore from '@/components/ButtonsWithMore';
import InfiniteScrollTable from '@/components/InfiniteScrollTable';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import useShowModal from '@/hooks/useShowModal';
import useKnowledgeStore from '@/models/useKnowledgeStore';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { downloadResourceFile } from '@/service/file';
import {
  buildDataset,
  deleteFolder,
  getFileBuildStatus,
  moveKnowledgeItems,
  queryDirAndFileByLevel as queryDirAndFileByLevelService,
  removeFile,
  searchDirAndFile,
  type BuildDatasetPayload,
  type KnowledgeItemsMoveResult,
} from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import { getFileIconType } from '@/constants/icon';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import DirectoryEmpty from '../components/DirectoryEmpty';
import BuildResultPanel from './BuildResultPanel';
import MoveModal from '../components/MoveModal';
import RenameModal from '../components/RenameModal';
import { collapseNestedMoveSources, type MoveSource } from './moveUtils';
import styles from './index.module.less';

const PreViewFile = lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

export interface DirectoryManageRef {
  getDirectoryList: (params: Record<string, any>) => void;
  buildSelectedFiles: () => void;
  deleteSelected: () => void;
  moveSelected: () => void;
}

interface IProps {
  searchValue?: string;
  setSearchValue?: React.Dispatch<React.SetStateAction<string>>;
  baseInfo: any;
  canManage?: boolean;
  setShowAddFolder: (show: boolean) => void;
  uploadLoading: boolean;
  setUploadLoading: (loading: boolean) => void;
  folderPath: { id: string; title: string }[];
  setFolderPath: React.Dispatch<React.SetStateAction<IProps['folderPath']>>;
  onBuildSelectionChange?: (count: number) => void;
  onSelectionCountChange?: (count: number) => void;
}

type ActionItem = {
  label: string;
  key: string;
  icon: React.ReactNode;
  disabled?: boolean;
};

type IBuildStatusItem = {
  standDisplayValue?: string;
  standCode?: string;
  standDisplayValueEn?: string;
};

type IFileBuildStatus = {
  status?: string;
  currentStep?: string;
  currentStepStatus?: string | null;
  statusDict?: IBuildStatusItem[];
  stepDict?: IBuildStatusItem[];
};

interface FilePreviewPanelProps {
  data: string | Blob | null;
  fileName: string;
  fileType: string;
  loading: boolean;
  onClose: () => void;
}

function normalizeDirectoryPath(path?: string) {
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function buildFolderPathFromDirectoryPath(directoryPath: string, rootTitle: string) {
  const segments = normalizeDirectoryPath(directoryPath).split('/').filter(Boolean);
  const nextFolderPath = [{ id: '-1', title: rootTitle }];
  let accumulatedPath = '';
  segments.forEach((segment) => {
    accumulatedPath += `/${segment}`;
    nextFolderPath.push({
      id: accumulatedPath,
      title: segment,
    });
  });
  return nextFolderPath;
}

function normalizeDirectoryRows(rows: any[] = []) {
  return rows.map((row) => ({
    ...row,
    collectionName: row.collectionName ?? row.name,
  }));
}

function unwrapDirectoryRows(res: any) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

function getDirectoryRowName(row: any) {
  return String(row?.collectionName ?? row?.name ?? row?.fileName ?? '').trim();
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'jpeg') return 'jpg';
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

function getRawBlob(res: any) {
  return res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
}

function canPreviewRecord(record: any) {
  return record?.type === 'file' && isPreviewable(getDirectoryRowName(record));
}

function isBuildNotStartedRecord(record: any) {
  const normalizedState = `${record?.fileUploadState ?? ''}`;
  return !normalizedState || normalizedState === '1';
}

// function hasRunningBuildTask(record: any) {
//   return `${record?.fileUploadState ?? ''}` === '2';
// }

const FilePreviewPanel = ({ data, fileName, fileType, loading, onClose }: FilePreviewPanelProps) => (
  <div className={styles.previewPanel}>
    <div className={styles.previewHeader}>
      <span className={styles.previewTitle}>{fileName}</span>
      <span className={styles.previewClose} onClick={onClose}>
        <AntdIcon type="icon-a-Closeguanbi1" />
      </span>
    </div>
    <div className={styles.previewBody}>
      <Spin spinning={loading} wrapperClassName={styles.previewSpin}>
        {data && (
          <Suspense fallback={null}>
            <PreViewFile data={data} type={fileType} title={fileName} className={styles.previewContent} />
          </Suspense>
        )}
      </Spin>
    </div>
  </div>
);

function getPathSegments(path?: string) {
  return normalizeDirectoryPath(path).split('/').filter(Boolean);
}

function getParentDirectoryPath(path?: string) {
  const segments = getPathSegments(path);
  segments.pop();
  return segments.length ? `/${segments.join('/')}` : '/';
}

function resolveSearchRowPath(row: any) {
  const name = getDirectoryRowName(row);
  const directoryPath = normalizeDirectoryPath(row?.directoryPath || row?.path || '');
  if (row?.type === 'directory') {
    return directoryPath === '/' && name ? `/${name}` : directoryPath;
  }

  if (!name) {
    return directoryPath;
  }

  const segments = getPathSegments(directoryPath);
  const lastSegment = segments[segments.length - 1];
  if (lastSegment === name) {
    return directoryPath;
  }
  return normalizeDirectoryPath(`${directoryPath}/${name}`);
}

function buildSearchDirectoryRows(rows: any[] = []) {
  type SearchNode = {
    path: string;
    row: any;
    children: SearchNode[];
  };

  const nodeMap = new Map<string, SearchNode>();
  const rootNodes: SearchNode[] = [];

  const appendChild = (parent: SearchNode | null, child: SearchNode) => {
    const siblings = parent ? parent.children : rootNodes;
    if (!siblings.some((item) => item.path === child.path)) {
      siblings.push(child);
    }
  };

  const getOrCreateDirectoryNode = (path: string) => {
    const normalizedPath = normalizeDirectoryPath(path);
    const existed = nodeMap.get(normalizedPath);
    if (existed) {
      return existed;
    }

    const segments = getPathSegments(normalizedPath);
    const name = segments[segments.length - 1] || normalizedPath;
    const node: SearchNode = {
      path: normalizedPath,
      row: {
        name,
        collectionName: name,
        type: 'directory',
        directoryPath: normalizedPath,
        __synthetic: true,
      },
      children: [],
    };
    nodeMap.set(normalizedPath, node);

    const parentPath = getParentDirectoryPath(normalizedPath);
    const parentNode = parentPath === '/' ? null : getOrCreateDirectoryNode(parentPath);
    appendChild(parentNode, node);
    return node;
  };

  normalizeDirectoryRows(rows).forEach((row) => {
    const rowPath = resolveSearchRowPath(row);
    if (!rowPath || rowPath === '/') return;

    const parentPath = getParentDirectoryPath(rowPath);
    const parentNode = parentPath === '/' ? null : getOrCreateDirectoryNode(parentPath);
    const existed = nodeMap.get(rowPath);
    const nextRow = {
      ...row,
      name: getDirectoryRowName(row) || getPathSegments(rowPath).slice(-1)[0],
      collectionName: row.collectionName ?? row.name ?? row.fileName ?? getPathSegments(rowPath).slice(-1)[0],
      directoryPath: rowPath,
    };

    if (existed) {
      existed.row = {
        ...nextRow,
        __synthetic: false,
      };
      appendChild(parentNode, existed);
      return;
    }

    const node: SearchNode = {
      path: rowPath,
      row: nextRow,
      children: [],
    };
    nodeMap.set(rowPath, node);
    appendChild(parentNode, node);
  });

  const flatten = (nodes: SearchNode[], level = 0): any[] => {
    return nodes.flatMap((node) => [
      {
        ...node.row,
        __level: level,
      },
      ...flatten(node.children, level + 1),
    ]);
  };

  return flatten(rootNodes);
}

const DirectoryManage = (props: IProps, ref: ForwardedRef<DirectoryManageRef>) => {
  const {
    searchValue = '',
    setSearchValue,
    baseInfo,
    canManage = false,
    setShowAddFolder,
    uploadLoading,
    setUploadLoading,
    onBuildSelectionChange,
    onSelectionCountChange,
  } = props;

  const { folderPath, setFolderPath } = props;

  const currentFolderId = folderPath[folderPath.length - 1].id;

  const intl = useIntl();
  const locale = getLocale();
  const { message, modal: appModal } = App.useApp();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  // 移动弹窗
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [moveSources, setMoveSources] = useState<MoveSource[]>([]);
  const [moving, setMoving] = useState(false);
  const moveSourceDirectoryPaths = useMemo(
    () => moveSources.filter((source) => source.isDirectory).map((source) => source.path),
    [moveSources]
  );
  const [buildingFileIds, setBuildingFileIds] = useState<string[]>([]);
  const [fileBuildStatusMap, setFileBuildStatusMap] = useState<Record<string, IFileBuildStatus>>({});
  const [queryingBuildStatusIds, setQueryingBuildStatusIds] = useState<string[]>([]);
  const [pollingFileIds, setPollingFileIds] = useState<string[]>([]);
  const [visibleFileIds, setVisibleFileIds] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const fileRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const queryingFileIdsRef = useRef<Set<string>>(new Set());
  const queriedFileIdsRef = useRef<Set<string>>(new Set());
  const postBuildPollingIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const [modalState, modalAction] = useShowModal();

  const {
    queryDirAndFileByLevel,
    directoryList,
    directoryLoading,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getCatalogTree,
    setState,
  } = useKnowledgeStore();

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 列表查询用：当前目录路径（不含文件名），根为 "/" */
  const getListDirectoryPath = useCallback(() => {
    const segments = folderPath
      .slice(1)
      .map((seg) => String(seg.title ?? '').trim())
      .filter(Boolean);
    if (segments.length === 0) return '/';
    return `/${segments.join('/')}`;
  }, [folderPath]);

  const getDirectoryList = useCallback(
    async (_params?: Record<string, any>) => {
      const rid = baseInfo?.resourceId;
      if (rid === null || rid === undefined || rid === '') return;
      const keyword = String(_params?.name ?? searchValue).trim();
      if (keyword) {
        setSearchLoading(true);
        try {
          const res = await searchDirAndFile({
            resourceId: Number(rid),
            directoryPath: '/',
            keyword,
          });
          setState({
            directoryList: buildSearchDirectoryRows(unwrapDirectoryRows(res)),
          });
        } catch (error) {
          console.error(error);
          setState({
            directoryList: [],
          });
        } finally {
          setSearchLoading(false);
        }
        return;
      }
      try {
        await queryDirAndFileByLevel({
          resourceId: Number(rid),
          directoryPath: getListDirectoryPath(),
        });
      } catch (error: any) {
        const errorMessage = typeof error === 'string' ? error : error?.message || error?.msg;
        if (errorMessage) {
          appModal.error({
            title: '查询知识库目录失败',
            content: <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{errorMessage}</div>,
          });
        }
        setState({
          directoryList: [],
        });
      }
    },
    [appModal, baseInfo?.resourceId, getListDirectoryPath, queryDirAndFileByLevel, searchValue, setState]
  );

  useEffect(() => {
    if (baseInfo?.resourceId === null || baseInfo?.resourceId === undefined || baseInfo?.resourceId === '') return;
    queryingFileIdsRef.current.clear();
    queriedFileIdsRef.current.clear();
    postBuildPollingIdsRef.current.clear();
    setFileBuildStatusMap({});
    setQueryingBuildStatusIds([]);
    setPollingFileIds([]);
    setVisibleFileIds([]);
    setState({
      directoryList: [],
    });
    const timer = window.setTimeout(
      () => {
        getDirectoryList();
      },
      searchValue.trim() ? 300 : 0
    );
    return () => window.clearTimeout(timer);
  }, [baseInfo?.resourceId, currentFolderId, getDirectoryList, searchValue, setState]);

  useEffect(() => {
    return () => {
      setState({
        directoryList: [],
      });
    };
  }, [setState]);

  const displayDirectoryList = useMemo(() => {
    return directoryList;
  }, [directoryList]);

  /** 构建 / 查询构建状态 共用的完整文件路径 */
  const getBuildDirectoryPath = useCallback(
    (record: any) => {
      const fromRow = String(record?.directoryPath ?? '').trim();
      if (fromRow) {
        return fromRow.startsWith('/') ? fromRow : `/${fromRow}`;
      }
      const fileName = String(record?.name ?? record?.collectionName ?? '').trim();
      if (!fileName) return '';
      const segments = folderPath
        .slice(1)
        .map((seg) => String(seg.title ?? '').trim())
        .filter(Boolean);
      return `/${[...segments, fileName].join('/')}`;
    },
    [folderPath]
  );

  /** 列表接口可能不返回文件 id，构建与状态轮询用 id 或 directoryPath 区分行 */
  const getFileRowKey = useCallback(
    (record: any): string => {
      const p = String(getBuildDirectoryPath(record) || '').trim();
      if (record?.type === 'file') {
        const fileVersion =
          record?.fileId ??
          record?.createTime ??
          record?.updateTime ??
          record?.gmtModified ??
          record?.modifyTime ??
          record?.fileSize ??
          record?.size;

        if (p && fileVersion !== null && fileVersion !== undefined && `${fileVersion}` !== '') {
          return `path:${p}|file:${fileVersion}`;
        }
      }

      const id = record?.fileId ?? record?.id;
      if (id !== null && id !== undefined && `${id}` !== '') {
        return `id:${id}`;
      }

      return p ? `path:${p}` : '';
    },
    [getBuildDirectoryPath]
  );

  const fileRecords = useMemo(
    () =>
      displayDirectoryList.filter((item: any) => {
        if (item?.type !== 'file') return false;
        return Boolean(getFileRowKey(item));
      }),
    [displayDirectoryList, getFileRowKey]
  );

  const buildableFileRecords = useMemo(
    () => fileRecords.filter((record: any) => !buildingFileIds.includes(getFileRowKey(record))),
    [buildingFileIds, fileRecords, getFileRowKey]
  );

  const selectedRecords = useMemo(
    () => displayDirectoryList.filter((record: any) => selectedRowKeys.includes(getFileRowKey(record))),
    [displayDirectoryList, getFileRowKey, selectedRowKeys]
  );

  const selectedBuildFileRecords = useMemo(
    () => buildableFileRecords.filter((record: any) => selectedRowKeys.includes(getFileRowKey(record))),
    [buildableFileRecords, getFileRowKey, selectedRowKeys]
  );

  // 列表变化后剔除已不存在的选中行（目录 + 文件通用，不再局限于可构建文件）
  useEffect(() => {
    const allRowKeys = displayDirectoryList.map((record: any) => getFileRowKey(record));
    setSelectedRowKeys((prev) => prev.filter((key) => allRowKeys.includes(`${key}`)));
  }, [displayDirectoryList, getFileRowKey]);

  useEffect(() => {
    onBuildSelectionChange?.(selectedBuildFileRecords.length);
  }, [onBuildSelectionChange, selectedBuildFileRecords.length]);

  useEffect(() => {
    onSelectionCountChange?.(selectedRecords.length);
  }, [onSelectionCountChange, selectedRecords.length]);

  const pollingFileIdsKey = useMemo(() => pollingFileIds.map((item) => `${item}`).join(','), [pollingFileIds]);

  const isTerminalBuildStatus = useCallback((status?: string) => {
    const normalizedStatus = `${status || ''}`;
    return (
      !normalizedStatus ||
      normalizedStatus === 'complete' ||
      normalizedStatus === 'failed' ||
      normalizedStatus === 'unsupported'
    );
  }, []);

  const isFailedBuildStatus = useCallback((statusInfo?: Partial<IFileBuildStatus> | null) => {
    const status = `${statusInfo?.status || ''}`;
    const currentStepStatus = `${statusInfo?.currentStepStatus || ''}`;
    return status === 'failed' || currentStepStatus === 'failed';
  }, []);

  const collectVisibleFileIds = useCallback(() => {
    if (typeof window === 'undefined') return;

    const nextVisibleIds = fileRecords
      .map((record: any) => {
        const rowKey = getFileRowKey(record);
        const element = fileRefs.current[rowKey];
        if (!rowKey || !element) return '';

        const rect = element.getBoundingClientRect();
        const isVisible =
          rect.bottom >= -100 &&
          rect.top <= window.innerHeight + 100 &&
          rect.right >= 0 &&
          rect.left <= window.innerWidth;
        return isVisible ? rowKey : '';
      })
      .filter(Boolean);

    if (nextVisibleIds.length === 0) return;

    setVisibleFileIds((prev) => [...new Set([...prev, ...nextVisibleIds])]);
  }, [fileRecords, getFileRowKey]);

  const getBuildStatusLabel = useCallback(
    (dict: IBuildStatusItem[] = [], code?: string) => {
      if (!code) return '';
      const matched = dict.find((item) => `${item?.standCode}` === `${code}`);
      if (!matched) return '';
      return locale.includes('en')
        ? matched?.standDisplayValueEn || matched?.standDisplayValue || code
        : matched?.standDisplayValue || matched?.standDisplayValueEn || code;
    },
    [locale]
  );

  const getBuildProgressText = useCallback(
    (record: any) => {
      if (record?.type === 'directory') return '-';
      const rowKey = getFileRowKey(record);
      if (queryingBuildStatusIds.includes(rowKey)) return <Spin size="small" />;

      const statusInfo = rowKey ? fileBuildStatusMap[rowKey] : undefined;
      if (!statusInfo) {
        if (isBuildNotStartedRecord(record) && !buildingFileIds.includes(rowKey) && !pollingFileIds.includes(rowKey)) {
          return '-';
        }
        return '-';
      }

      const { status, currentStep, statusDict = [], stepDict = [] } = statusInfo;

      if (`${status}` === 'running') {
        return getBuildStatusLabel(stepDict, currentStep) || getBuildStatusLabel(statusDict, status) || '-';
      }

      return (
        getBuildStatusLabel(statusDict, status) ||
        getBuildStatusLabel(stepDict, currentStep) ||
        getBuildStatusLabel(statusDict, currentStep) ||
        '-'
      );
    },
    [buildingFileIds, fileBuildStatusMap, getBuildStatusLabel, getFileRowKey, pollingFileIds, queryingBuildStatusIds]
  );

  useEffect(() => {
    const rid = baseInfo?.resourceId;
    if (visibleFileIds.length === 0 || rid === null || rid === undefined || rid === '') {
      return undefined;
    }

    let cancelled = false;

    const fetchInitialStatuses = async () => {
      const visibleRecords = fileRecords.filter((record: any) => {
        const rowKey = getFileRowKey(record);
        return (
          visibleFileIds.includes(rowKey) &&
          !queryingFileIdsRef.current.has(rowKey) &&
          !queriedFileIdsRef.current.has(rowKey)
        );
      });

      const recordsToQuery = visibleRecords.map((record: any) => getFileRowKey(record)).filter(Boolean);
      if (recordsToQuery.length === 0) return;

      recordsToQuery.forEach((id) => queryingFileIdsRef.current.add(id));
      setQueryingBuildStatusIds((prev) => [...new Set([...prev, ...recordsToQuery])]);

      const results = await Promise.all(
        visibleRecords.map(async (record: any) => {
          const rowKey = getFileRowKey(record);
          const directoryPath = getBuildDirectoryPath(record);
          if (!directoryPath || !rowKey) {
            return { rowKey: '', data: null };
          }
          try {
            const res = await getFileBuildStatus({ resourceId: rid, directoryPath });
            return {
              rowKey,
              data: res || null,
            };
          } catch (error) {
            return {
              rowKey,
              data: null,
            };
          }
        })
      );

      recordsToQuery.forEach((id) => queryingFileIdsRef.current.delete(id));
      recordsToQuery.forEach((id) => queriedFileIdsRef.current.add(id));
      if (mountedRef.current) {
        setQueryingBuildStatusIds((prev) => prev.filter((id) => !recordsToQuery.includes(id)));
      }

      if (cancelled) return;

      setFileBuildStatusMap((prev) => {
        const nextStatusMap = { ...prev };
        const nextPollingIds: string[] = [];

        results.forEach(({ rowKey, data }) => {
          if (!rowKey || !data) return;
          nextStatusMap[rowKey] = data;

          if (!isTerminalBuildStatus(data?.status)) {
            nextPollingIds.push(rowKey);
          }
        });

        setPollingFileIds((prevPolling) => [...new Set([...prevPolling, ...nextPollingIds])]);

        return nextStatusMap;
      });
    };

    void fetchInitialStatuses();

    return () => {
      cancelled = true;
    };
  }, [baseInfo?.resourceId, visibleFileIds, fileRecords, getBuildDirectoryPath, getFileRowKey, isTerminalBuildStatus]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const frameId = window.requestAnimationFrame(collectVisibleFileIds);

    fileRecords.forEach((record: any) => {
      const rowKey = getFileRowKey(record);
      const element = fileRefs.current[rowKey];
      if (!element) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setVisibleFileIds((prev) => {
                if (prev.includes(rowKey)) return prev;
                return [...prev, rowKey];
              });
            }
          });
        },
        {
          rootMargin: '0px 0px 100px 0px',
        }
      );

      observer.observe(element);
      observers.push(observer);
    });

    window.addEventListener('resize', collectVisibleFileIds);

    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', collectVisibleFileIds);
    };
  }, [collectVisibleFileIds, fileRecords, getFileRowKey]);

  useEffect(() => {
    if (pollingFileIds.length === 0) return undefined;

    const rid = baseInfo?.resourceId;
    if (rid === null || rid === undefined || rid === '') return undefined;

    let cancelled = false;
    let isPolling = false;

    const pollStatuses = async () => {
      if (isPolling) return;
      isPolling = true;

      const results = await Promise.all(
        pollingFileIds.map(async (rowKey) => {
          const record = displayDirectoryList.find(
            (item: any) => item?.type === 'file' && getFileRowKey(item) === rowKey
          );
          if (!record) {
            return { rowKey, data: null, missingRecord: true as const, error: false as const };
          }
          const directoryPath = getBuildDirectoryPath(record);
          if (!directoryPath) {
            return { rowKey, data: null, missingRecord: true as const, error: false as const };
          }
          try {
            const res = await getFileBuildStatus({ resourceId: rid, directoryPath });
            return {
              rowKey,
              data: res || null,
              missingRecord: false as const,
              error: false as const,
            };
          } catch (error) {
            return {
              rowKey,
              data: null,
              missingRecord: false as const,
              error: true as const,
            };
          }
        })
      );

      if (cancelled) return;

      setFileBuildStatusMap((prev) => {
        const next = { ...prev };
        results.forEach(({ rowKey, data }) => {
          if (data && rowKey) {
            next[rowKey] = data;
          }
        });
        return next;
      });

      const nextPollingIds = pollingFileIds.filter((rowKey) => {
        const row = results.find((item) => item.rowKey === rowKey);
        if (row?.missingRecord) {
          postBuildPollingIdsRef.current.delete(rowKey);
          return false;
        }
        if (row?.error) {
          postBuildPollingIdsRef.current.delete(rowKey);
          return false;
        }
        if (!row?.data) return false;

        if (isFailedBuildStatus(row.data)) {
          postBuildPollingIdsRef.current.delete(rowKey);
          return false;
        }
        const status = `${row?.data?.status || ''}`;
        if (isTerminalBuildStatus(status)) {
          postBuildPollingIdsRef.current.delete(rowKey);
          return false;
        }
        return true;
      });

      setPollingFileIds(() => nextPollingIds);

      isPolling = false;
    };

    void pollStatuses();
    const timer = window.setInterval(() => {
      void pollStatuses();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    baseInfo?.resourceId,
    displayDirectoryList,
    getBuildDirectoryPath,
    pollingFileIdsKey,
    getFileRowKey,
    isTerminalBuildStatus,
  ]);

  const submitBuildTasks = useCallback(
    (records: any[]) => {
      const rid = baseInfo?.resourceId;
      if (rid === null || rid === undefined || rid === '') {
        message.error(intl.formatMessage({ id: 'directoryManage.missingKnowledgeBaseInfo' }));
        return;
      }

      const taskMap = new Map<
        string,
        {
          rowKey: string;
          payload: BuildDatasetPayload;
        }
      >();

      records.forEach((record) => {
        const directoryPath = getBuildDirectoryPath(record);
        const rowKey = getFileRowKey(record);
        if (!directoryPath || !rowKey || buildingFileIds.includes(rowKey)) return;
        taskMap.set(rowKey, {
          rowKey,
          payload: {
            directoryPath,
            resourceId: String(rid),
          },
        });
      });

      const tasks = Array.from(taskMap.values());
      if (tasks.length === 0) {
        message.warning(intl.formatMessage({ id: 'directoryManage.noBuildableFiles' }));
        return;
      }

      const taskKeys = tasks.map((task) => task.rowKey);
      setBuildingFileIds((prev) => [...new Set([...prev, ...taskKeys])]);
      message.info(
        intl.formatMessage(
          { id: tasks.length > 1 ? 'directoryManage.batchBuildSubmitted' : 'directoryManage.buildSubmitted' },
          { count: tasks.length }
        )
      );

      window.setTimeout(() => {
        void Promise.allSettled(tasks.map((task) => buildDataset(task.payload)))
          .then((results) => {
            const successKeys = tasks
              .filter((_, index) => results[index].status === 'fulfilled')
              .map((task) => task.rowKey);
            const failedResult = results.find(
              (result): result is PromiseRejectedResult => result.status === 'rejected'
            );

            successKeys.forEach((rowKey) => {
              queriedFileIdsRef.current.delete(rowKey);
              postBuildPollingIdsRef.current.add(rowKey);
            });

            if (successKeys.length > 0) {
              setPollingFileIds((prev) => [...new Set([...prev, ...successKeys])]);
            }

            if (failedResult) {
              const error = failedResult.reason;
              const errorMessage =
                error?.response?.data?.msg ||
                error?.msg ||
                error?.message ||
                intl.formatMessage({ id: 'directoryManage.buildFailed' });
              message.error(errorMessage);
            }
          })
          .finally(() => {
            setBuildingFileIds((prev) => prev.filter((key) => !taskKeys.includes(key)));
          });
      }, 0);
    },
    [baseInfo?.resourceId, buildingFileIds, getBuildDirectoryPath, getDirectoryList, getFileRowKey, intl, message]
  );

  const submitBuildTask = useCallback(
    (record: any) => {
      const directoryPath = getBuildDirectoryPath(record);
      const rowKey = getFileRowKey(record);
      if (!directoryPath || !rowKey) {
        message.error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }

      submitBuildTasks([record]);
    },
    [getBuildDirectoryPath, getFileRowKey, intl, message, submitBuildTasks]
  );

  const handleBatchBuild = useCallback(() => {
    if (selectedBuildFileRecords.length === 0) {
      message.warning(intl.formatMessage({ id: 'directoryManage.selectFilesToBuild' }));
      return;
    }

    Modal.confirm({
      title: intl.formatMessage({ id: 'directoryManage.batchBuildFiles' }),
      content: intl.formatMessage(
        { id: 'directoryManage.batchBuildConfirm' },
        { count: selectedBuildFileRecords.length }
      ),
      onOk: () => {
        submitBuildTasks(selectedBuildFileRecords);
      },
    });
  }, [intl, message, selectedBuildFileRecords, submitBuildTasks]);

  const deleteSelected = useCallback(() => {
    if (selectedRecords.length === 0) {
      message.warning(intl.formatMessage({ id: 'directoryManage.selectItemsToDelete' }));
      return;
    }
    const rid = baseInfo?.resourceId;
    if (rid === null || rid === undefined || rid === '') {
      message.error(intl.formatMessage({ id: 'directoryManage.missingKnowledgeBaseInfo' }));
      return;
    }
    // 若同时选中父目录与其子项，子项会被父目录递归删除，这里先剔除被包含的子项，避免重复删除报错。
    const selectedDirPaths = selectedRecords
      .filter((record: any) => record?.type === 'directory')
      .map((record: any) => normalizeDirectoryPath(getBuildDirectoryPath(record)));
    const isUnderSelectedDir = (path: string) =>
      selectedDirPaths.some((dir) => dir !== path && (path === dir || path.startsWith(`${dir}/`)));
    const targets = selectedRecords.filter(
      (record: any) => !isUnderSelectedDir(normalizeDirectoryPath(getBuildDirectoryPath(record)))
    );

    Modal.confirm({
      title: intl.formatMessage({ id: 'common.deleteTips' }),
      content: intl.formatMessage({ id: 'directoryManage.batchDeleteConfirm' }, { count: selectedRecords.length }),
      onOk: async () => {
        const results = await Promise.allSettled(
          targets.map((record: any) => {
            const directoryPath = getBuildDirectoryPath(record);
            if (record?.type === 'directory') {
              return deleteFolder({ resourceId: Number(rid), directoryPath });
            }
            return removeFile({ directoryPath, resourceId: String(rid) });
          })
        );
        let success = 0;
        let failed = 0;
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.success !== false) success += 1;
          else failed += 1;
        });
        const notify = failed ? message.warning : message.success;
        notify(intl.formatMessage({ id: 'directoryManage.batchDeleteResult' }, { success, failed }));
        setSelectedRowKeys([]);
        getDirectoryList({ pageIndex: 1 });
      },
    });
  }, [baseInfo?.resourceId, getBuildDirectoryPath, getDirectoryList, intl, message, selectedRecords]);

  const openMoveModal = useCallback(
    (records: any[]) => {
      const sources = collapseNestedMoveSources(
        records.map((record) => ({
          path: getBuildDirectoryPath(record),
          isDirectory: record?.type === 'directory',
        }))
      );
      if (sources.length === 0) {
        message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }
      setMoveSources(sources);
      setMoveModalVisible(true);
    },
    [getBuildDirectoryPath, intl, message]
  );

  const moveSelected = useCallback(() => {
    if (selectedRecords.length === 0) {
      message.warning(intl.formatMessage({ id: 'directoryManage.selectItemsToMove' }));
      return;
    }
    openMoveModal(selectedRecords);
  }, [intl, message, openMoveModal, selectedRecords]);

  const handleMoveConfirm = useCallback(
    async (targetDirectoryPath: string) => {
      const rid = baseInfo?.resourceId;
      if (rid === null || rid === undefined || rid === '' || moveSources.length === 0) {
        message.error(intl.formatMessage({ id: 'directoryManage.missingKnowledgeBaseInfo' }));
        return;
      }

      setMoving(true);
      try {
        const result: KnowledgeItemsMoveResult = await moveKnowledgeItems({
          resourceId: Number(rid),
          sourcePath: moveSources.map((source) => source.path),
          targetDirectoryPath,
          overwrite: false,
        });
        const data = Array.isArray(result?.data) ? result.data : [];
        const succeeded = Number(result?.summary?.succeeded ?? data.filter((item) => item.success).length);
        const failed = Number(result?.summary?.failed ?? data.filter((item) => !item.success).length);
        const total = Number(result?.summary?.total ?? succeeded + failed);
        const failureItems = data.filter((item) => !item.success);

        if (total === 0) {
          throw new Error(intl.formatMessage({ id: 'directoryManage.moveFailed' }));
        }

        if (succeeded > 0) {
          setMoveModalVisible(false);
          setMoveSources([]);
          setSelectedRowKeys([]);
          await getDirectoryList({ pageIndex: 1 });
        }

        if (failed > 0) {
          appModal.warning({
            title: intl.formatMessage({
              id: succeeded > 0 ? 'directoryManage.movePartialTitle' : 'directoryManage.moveFailed',
            }),
            content: (
              <div>
                <div>{intl.formatMessage({ id: 'directoryManage.moveResult' }, { success: succeeded, failed })}</div>
                {failureItems.length > 0 && (
                  <div style={{ maxHeight: 240, marginTop: 12, overflow: 'auto' }}>
                    {failureItems.map((item) => (
                      <div key={item.sourcePath} style={{ marginBottom: 8, wordBreak: 'break-word' }}>
                        {item.sourcePath}: {item.error || intl.formatMessage({ id: 'directoryManage.moveFailed' })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          });
        } else {
          message.success(intl.formatMessage({ id: 'directoryManage.moveSuccess' }, { count: total }));
        }
      } catch (error: any) {
        const errorMessage = typeof error === 'string' ? error : error?.message || error?.msg;
        message.error(errorMessage || intl.formatMessage({ id: 'directoryManage.moveFailed' }));
      } finally {
        setMoving(false);
      }
    },
    [appModal, baseInfo?.resourceId, getDirectoryList, intl, message, moveSources]
  );

  useImperativeHandle(
    ref,
    () => ({
      getDirectoryList,
      buildSelectedFiles: handleBatchBuild,
      deleteSelected,
      moveSelected,
    }),
    [getDirectoryList, handleBatchBuild, deleteSelected, moveSelected]
  );

  const renderPreviewPanel = useCallback(
    (record: any, options: { data?: string | Blob | null; fileType?: string; loading: boolean }) => {
      const fileName = getDirectoryRowName(record);
      setDetailPanel?.(
        <FilePreviewPanel
          data={options.data ?? null}
          fileName={fileName}
          fileType={options.fileType || getFileType(fileName)}
          loading={options.loading}
          onClose={() => clearDetailPanel?.()}
        />,
        { overlay: true }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const handlePreviewFile = useCallback(
    async (record: any) => {
      if (!canPreviewRecord(record)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }

      const directoryPath = getBuildDirectoryPath(record);
      const rid = baseInfo?.resourceId;
      if (!directoryPath || rid === null || rid === undefined || rid === '') {
        message.error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }

      const fileName = getDirectoryRowName(record);
      renderPreviewPanel(record, { loading: true });
      try {
        const res: any = await downloadResourceFile({
          resourceId: rid,
          directoryPath,
        });
        const rawBlob = getRawBlob(res);
        const mimeType = getMimeType(fileName);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        renderPreviewPanel(record, { data: blob, loading: false });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
        clearDetailPanel?.();
      }
    },
    [baseInfo?.resourceId, clearDetailPanel, getBuildDirectoryPath, intl, message, renderPreviewPanel]
  );

  const handleBuildResult = useCallback(
    (record: any) => {
      const filePath = getBuildDirectoryPath(record);
      const rid = baseInfo?.resourceId;
      if (!filePath || rid === null || rid === undefined || rid === '') {
        message.error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }
      setDetailPanel?.(
        <BuildResultPanel
          resourceId={rid}
          filePath={filePath}
          fileName={getDirectoryRowName(record)}
          onClose={() => clearDetailPanel?.()}
        />,
        { overlay: true }
      );
    },
    [baseInfo?.resourceId, clearDetailPanel, getBuildDirectoryPath, intl, message, setDetailPanel]
  );

  const checkDirectoryHasChildren = useCallback(async (resourceId: number, directoryPath: string) => {
    const res = await queryDirAndFileByLevelService({
      resourceId,
      directoryPath,
    });
    return Array.isArray(res) && res.length > 0;
  }, []);

  const handleAction = (key: string, record: any) => {
    switch (key) {
      case 'top':
        break;
      case 'move':
        openMoveModal([record]);
        break;
      case 'rename':
        modalAction.handleShow('edit', record);
        break;
      case 'preview':
        void handlePreviewFile(record);
        break;
      case 'buildResult': {
        const rowKey = getFileRowKey(record);
        const status = fileBuildStatusMap[rowKey]?.status;
        if (!status || status === 'running' || buildingFileIds.includes(rowKey)) {
          message.info(intl.formatMessage({ id: 'buildResult.notReady' }));
          break;
        }
        handleBuildResult(record);
        break;
      }
      case 'download': {
        const directoryPath = getBuildDirectoryPath(record);
        const rid = baseInfo?.resourceId;
        if (!directoryPath || rid === null || rid === undefined || rid === '') {
          message.error(intl.formatMessage({ id: 'directoryManage.downloadMissingParams' }));
          break;
        }
        void downloadResourceFile({
          resourceId: rid,
          directoryPath,
        }).then((res) => {
          downloadFile(res);
        });
        break;
      }
      case 'build':
        if (buildingFileIds.includes(getFileRowKey(record))) return;
        Modal.confirm({
          title: intl.formatMessage({ id: 'directoryManage.buildFile' }),
          content: intl.formatMessage(
            { id: 'directoryManage.buildConfirm' },
            { fileName: record?.collectionName ?? record?.name }
          ),
          onOk: () => {
            submitBuildTask(record);
          },
        });
        break;
      case 'delete':
        Modal.confirm({
          title: intl.formatMessage({ id: 'common.deleteTips' }),
          content: intl.formatMessage(
            { id: 'common.deleteConfirm2' },
            { content: record?.collectionName ?? record?.name }
          ),
          onOk: async () => {
            let promise: Promise<any>;
            if (record?.type === 'directory') {
              const directoryPath = getBuildDirectoryPath(record);
              const rid = baseInfo?.resourceId;
              if (!directoryPath || rid === null || rid === undefined || rid === '') {
                message.error(intl.formatMessage({ id: 'directoryManage.deleteFolderMissingParams' }));
                return Promise.reject(new Error('invalid delete folder params'));
              }
              const hasChildren = await checkDirectoryHasChildren(Number(rid), directoryPath);
              if (hasChildren) {
                message.warning(intl.formatMessage({ id: 'directoryManage.deleteFolderNotEmpty' }));
                return;
              }
              promise = deleteFolder({ resourceId: Number(rid), directoryPath });
            } else {
              const filePath = getBuildDirectoryPath(record);
              const rid = baseInfo?.resourceId;
              if (!filePath || rid === null || rid === undefined || rid === '') {
                message.error(intl.formatMessage({ id: 'directoryManage.deleteFileMissingParams' }));
                return Promise.reject(new Error('invalid remove file params'));
              }
              promise = removeFile({
                directoryPath: filePath,
                resourceId: String(rid),
              });
            }
            return promise
              .then((res) => {
                // 检查接口返回的 success 字段
                if (res?.success === false) {
                  const errorMessage = res?.msg || intl.formatMessage({ id: 'common.deleteFailed' });
                  message.error(errorMessage);
                  return;
                }
                message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
                const deletedPath = getBuildDirectoryPath(record);
                const deletedRowKey = getFileRowKey(record);
                if (deletedRowKey) {
                  queriedFileIdsRef.current.delete(deletedRowKey);
                  queryingFileIdsRef.current.delete(deletedRowKey);
                  postBuildPollingIdsRef.current.delete(deletedRowKey);
                  setFileBuildStatusMap((prev) => {
                    const next = { ...prev };
                    delete next[deletedRowKey];
                    return next;
                  });
                  setQueryingBuildStatusIds((prev) => prev.filter((id) => id !== deletedRowKey));
                  setPollingFileIds((prev) => prev.filter((id) => id !== deletedRowKey));
                  setVisibleFileIds((prev) => prev.filter((id) => id !== deletedRowKey));
                }
                setState({
                  directoryList: directoryList.filter((item) => {
                    return getBuildDirectoryPath(item) !== deletedPath;
                  }),
                });
              })
              .catch((error) => {
                // 处理网络错误或其他错误
                const errorMessage =
                  error?.response?.data?.msg ||
                  error?.msg ||
                  error?.message ||
                  error ||
                  intl.formatMessage({ id: 'common.deleteFailed' });
                message.error(errorMessage);
              });
          },
        });
        break;
      default:
        break;
    }
  };

  const getActions = useCallback(
    (record: any) => {
      if (record?.__synthetic) {
        return [];
      }

      let actionList: ActionItem[] = [];

      if (canManage) {
        actionList.push({
          label: intl.formatMessage({ id: 'directoryManage.move' }),
          key: 'move',
          icon: (
            <Tooltip title={intl.formatMessage({ id: 'directoryManage.move' })}>
              <span className="iconfont icon-a-Dragtuozhuai" />
            </Tooltip>
          ),
        });
        actionList.push({
          label: intl.formatMessage({ id: 'common.delete' }),
          key: 'delete',
          icon: (
            <Tooltip title={intl.formatMessage({ id: 'directoryManage.deleteFile' })}>
              <span className="iconfont icon-a-Deleteshanchu" />
            </Tooltip>
          ),
        });
      }

      if (record?.type === 'directory' && canManage) {
        // 目录显示重命名按钮
        actionList.unshift({
          label: intl.formatMessage({ id: 'directoryManage.rename' }),
          key: 'rename',
          icon: <span className="iconfont icon-a-Editbianji" />,
        });
      } else {
        const isBuilding = buildingFileIds.includes(getFileRowKey(record));
        const buildStatus = fileBuildStatusMap[getFileRowKey(record)]?.status;
        const buildResultDisabled = !buildStatus || buildStatus === 'running' || isBuilding;
        const fileActions: ActionItem[] = [];

        if (canManage) {
          fileActions.push({
            label: intl.formatMessage({ id: 'directoryManage.build' }),
            key: 'build',
            disabled: isBuilding,
            icon: (
              <Tooltip title={intl.formatMessage({ id: 'directoryManage.buildFile' })}>
                {isBuilding ? <Spin size="small" /> : <span className="iconfont icon-goujian" />}
              </Tooltip>
            ),
          });
        }

        fileActions.push({
          label: intl.formatMessage({ id: 'buildResult.action' }),
          key: 'buildResult',
          disabled: buildResultDisabled,
          icon: (
            <Tooltip
              title={intl.formatMessage({
                id: buildResultDisabled ? 'buildResult.notReady' : 'buildResult.action',
              })}
            >
              <FileSearchOutlined />
            </Tooltip>
          ),
        });

        if (canPreviewRecord(record)) {
          fileActions.push({
            label: intl.formatMessage({ id: 'fileBrowser.action.preview' }),
            key: 'preview',
            icon: (
              <Tooltip title={intl.formatMessage({ id: 'fileBrowser.action.preview' })}>
                <span className="iconfont icon-a-Preview-openyulan-dakai" />
              </Tooltip>
            ),
          });
        }

        fileActions.push({
          label: intl.formatMessage({ id: 'common.download' }),
          key: 'download',
          icon: (
            <Tooltip title={intl.formatMessage({ id: 'directoryManage.downloadFile' })}>
              <span className="iconfont icon-a-Downloadxiazai" />
            </Tooltip>
          ),
        });

        actionList = [...fileActions, ...actionList];
      }

      return actionList;
    },
    [buildingFileIds, canManage, fileBuildStatusMap, getFileRowKey, intl]
  );

  const getFileRowRef = useCallback(
    (rowKey: string) => (el: HTMLDivElement | null) => {
      if (el) {
        fileRefs.current[rowKey] = el as HTMLTableRowElement;
      }
    },
    []
  );

  const columns = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'directoryManage.fileName' }),
        dataIndex: 'name',
        // width: '40%',
        align: 'center',
        render: (v: string, record: any) => {
          const iconType = getFileIconType(v, { isDirectory: record.type === 'directory' });
          let onClick: React.DOMAttributes<HTMLDivElement>['onClick'];
          let style: React.CSSProperties = {};
          if (record.type === 'directory') {
            style = { cursor: 'pointer' };
            onClick = () => {
              if (searchValue.trim()) {
                const directoryPath = getBuildDirectoryPath(record);
                setFolderPath(buildFolderPathFromDirectoryPath(directoryPath, folderPath[0].title));
                setSearchValue?.('');
                return;
              }
              setFolderPath((prev) => {
                const directoryPath = normalizeDirectoryPath(getBuildDirectoryPath(record));
                return [
                  ...prev,
                  {
                    id: directoryPath,
                    title: record.collectionName ?? record.name,
                  },
                ];
              });
            };
          }

          const isFile = record.type === 'file';
          const rowKey = isFile ? getFileRowKey(record) : '';
          if (isFile) {
            style = { cursor: canPreviewRecord(record) ? 'pointer' : 'default' };
            onClick = () => {
              void handlePreviewFile(record);
            };
          }

          return (
            <div
              onClick={onClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                paddingLeft: Number(record?.__level || 0) * 28,
                ...style,
              }}
              title={v}
              ref={isFile ? getFileRowRef(rowKey) : undefined}
            >
              <AntdIcon type={`icon-${iconType}`} className={styles.fileNameIcon} />
              <div className={classNames('textEllipsis', styles.fileNameText)} style={{ cursor: style.cursor }}>
                {v}
              </div>
            </div>
          );
        },
      },

      // {
      //   title: intl.formatMessage({ id: 'directoryManage.fileStatus' }),
      //   dataIndex: 'fileUploadState',
      //   align: 'center',
      //   render: (v: string) => {
      //     let text = '';
      //     switch (`${v}`) {
      //       case '-1':
      //         text = intl.formatMessage({ id: 'common.failed' });
      //         break;
      //       case '1':
      //         text = intl.formatMessage({ id: 'common.notStarted' });
      //         break;
      //       case '2':
      //         text = intl.formatMessage({ id: 'common.processing' });
      //         break;
      //       case '3':
      //         text = intl.formatMessage({ id: 'common.completed' });
      //         break;
      //       case '41':
      //         text = intl.formatMessage({ id: 'common.saved' });
      //         break;
      //       default:
      //         break;
      //     }
      //     return text;
      //   },
      // },

      // {
      //   title: '文件大小',
      //   dataIndex: 'size',
      //   align: 'center',
      //   render: (v: string) => {
      //     return v ? `${(v / 1024).toFixed(2)}KB` : '';
      //   },
      // },

      // 暂不展示创建人、创建时间
      // {
      //   title: intl.formatMessage({ id: 'directoryManage.creator' }),
      //   dataIndex: 'createStaffName',
      //   align: 'center',
      // },
      // {
      //   title: intl.formatMessage({ id: 'baseListModal.createTime' }),
      //   dataIndex: 'createTime',
      //   align: 'center',
      //   width: 200,
      // },

      {
        title: intl.formatMessage({ id: 'directoryManage.buildProgress' }),
        dataIndex: 'buildProgress',
        align: 'center',
        width: 150,
        render: (_: number, record: any) => {
          return getBuildProgressText(record);
        },
      },
      {
        title: intl.formatMessage({ id: 'common.operation' }),
        dataIndex: 'title',
        width: 150,
        render: (v: string, record: any) => {
          const actions = getActions(record);
          if (!actions.length) {
            return null;
          }
          return (
            <div className={styles.operationActions}>
              <ButtonsWithMore actions={actions} maximun={4} handleAction={(key) => handleAction(key, record)} />
            </div>
          );
        },
      },
    ],
    [
      folderPath,
      getActions,
      getBuildDirectoryPath,
      getBuildProgressText,
      getFileRowRef,
      handleAction,
      handlePreviewFile,
      intl,
      searchValue,
      setSearchValue,
    ]
  );

  const rowSelection = useMemo(() => {
    if (!canManage) return undefined;
    return {
      type: 'checkbox' as const,
      selectedRowKeys,
      onChange: (keys: React.Key[]) => {
        setSelectedRowKeys(keys);
      },
      // 目录与文件都可勾选（用于批量移动/删除）；仅搜索态下的合成父目录节点不可选。
      getCheckboxProps: (record: any) => ({
        disabled: Boolean(record?.__synthetic),
      }),
    };
  }, [canManage, selectedRowKeys]);

  const handleBreadcrumbClick = (index: number) => {
    setFolderPath(folderPath.slice(0, index + 1));
  };

  return (
    <div className={classNames(styles.directoryManageContainer, 'full-width full-height')}>
      <div className={styles.header}>
        <KnowledgeBreadcrumb folderPath={folderPath} handleBreadcrumbClick={handleBreadcrumbClick} />
      </div>
      <div className={styles.content}>
        <InfiniteScrollTable
          next={() => {}}
          hasMore={false}
          dataSource={displayDirectoryList}
          columns={columns}
          rowKey={getFileRowKey}
          rowSelection={rowSelection}
          emptyLocale={{
            emptyText: (
              <DirectoryEmpty
                baseInfo={baseInfo}
                canManage={canManage}
                setShowAddFolder={setShowAddFolder}
                uploadLoading={uploadLoading}
                setUploadLoading={setUploadLoading}
                reload={() => {
                  getDirectoryList({ pageIndex: 1 });
                }}
                directoryPath={getListDirectoryPath()}
              />
            ),
          }}
          endMessage={null}
          scrollDivId="directoryTable"
          loading={directoryLoading || searchLoading}
        />
      </div>
      {moveModalVisible && (
        <MoveModal
          visible={moveModalVisible}
          resourceId={Number(baseInfo?.resourceId)}
          sourceDirectoryPaths={moveSourceDirectoryPaths}
          loading={moving}
          onCancel={() => {
            if (moving) return;
            setMoveModalVisible(false);
            setMoveSources([]);
          }}
          onOk={(targetDirectoryPath) => {
            void handleMoveConfirm(targetDirectoryPath);
          }}
        />
      )}
      <RenameModal
        {...modalState}
        onCancel={modalAction.onCancel}
        resourceId={baseInfo?.resourceId}
        onRenameSuccess={getDirectoryList}
      />
    </div>
  );
};

export default forwardRef(DirectoryManage);
