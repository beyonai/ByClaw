import {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

// @ts-ignore
import { getLocale, useIntl } from '@umijs/max';
import classNames from 'classnames';
import { App, Modal, Spin, Tooltip } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import ButtonsWithMore from '@/components/ButtonsWithMore';
import InfiniteScrollTable from '@/components/InfiniteScrollTable';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import useShowModal from '@/hooks/useShowModal';
import useKnowledgeStore from '@/models/useKnowledgeStore';
import { downloadResourceFile } from '@/service/file';
import {
  buildDataset,
  deleteFolder,
  getFileBuildStatus,
  removeFile,
  type BuildDatasetPayload,
} from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import DirectoryEmpty from '../components/DirectoryEmpty';
import MoveModal from '../components/MoveModal';
import RenameModal from '../components/RenameModal';
import styles from './index.module.less';

export interface DirectoryManageRef {
  getDirectoryList: (params: Record<string, any>) => void;
}

interface IProps {
  searchValue?: string;
  baseInfo: any;
  setShowAddFolder: (show: boolean) => void;
  uploadLoading: boolean;
  setUploadLoading: (loading: boolean) => void;
  folderPath: { id: string; title: string }[];
  setFolderPath: React.Dispatch<React.SetStateAction<IProps['folderPath']>>;
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

const DirectoryManage = (props: IProps, ref: ForwardedRef<DirectoryManageRef>) => {
  const { searchValue = '', baseInfo, setShowAddFolder, uploadLoading, setUploadLoading } = props;

  const { folderPath, setFolderPath } = props;

  const currentFolderId = folderPath[folderPath.length - 1].id;

  const intl = useIntl();
  const locale = getLocale();
  const { message } = App.useApp();
  // 移动弹窗
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [curRecord, setCurRecord] = useState<any>({});
  const [buildingFileIds, setBuildingFileIds] = useState<string[]>([]);
  const [fileBuildStatusMap, setFileBuildStatusMap] = useState<Record<string, IFileBuildStatus>>({});
  const [pollingFileIds, setPollingFileIds] = useState<string[]>([]);
  const [visibleFileIds, setVisibleFileIds] = useState<string[]>([]);
  const fileRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const queryingFileIdsRef = useRef<Set<string>>(new Set());

  const [modalState, modalAction] = useShowModal();

  const {
    queryDirAndFileByLevel,
    directoryList,
    directoryLoading,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getCatalogTree,
    setState,
  } = useKnowledgeStore();

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
    (_params?: Record<string, any>) => {
      void _params;
      const rid = baseInfo?.resourceId;
      if (rid === null || rid === undefined || rid === '') return;
      queryDirAndFileByLevel({
        resourceId: Number(rid),
        directoryPath: getListDirectoryPath(),
      });
    },
    [baseInfo?.resourceId, getListDirectoryPath, queryDirAndFileByLevel]
  );

  useEffect(() => {
    if (baseInfo?.resourceId === null || baseInfo?.resourceId === undefined || baseInfo?.resourceId === '') return;
    setState({
      directoryList: [],
    });
    getDirectoryList();
  }, [baseInfo?.resourceId, currentFolderId, getDirectoryList, setState]);

  useEffect(() => {
    return () => {
      setState({
        directoryList: [],
      });
    };
  }, [setState]);

  // 暴露方法给父组件
  useImperativeHandle(
    ref,
    () => ({
      getDirectoryList,
    }),
    [getDirectoryList]
  );

  const displayDirectoryList = useMemo(() => {
    const kw = searchValue.trim().toLowerCase();
    if (!kw) return directoryList;
    return directoryList.filter((item: any) =>
      String(item.collectionName ?? item.name ?? '')
        .toLowerCase()
        .includes(kw)
    );
  }, [directoryList, searchValue]);

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
      const id = record?.id;
      if (id !== null && id !== undefined && `${id}` !== '') {
        return `id:${id}`;
      }
      const p = String(getBuildDirectoryPath(record) || '').trim();
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

  const pollingFileIdsKey = useMemo(() => pollingFileIds.map((item) => `${item}`).join(','), [pollingFileIds]);

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
      const statusInfo = rowKey ? fileBuildStatusMap[rowKey] : undefined;
      if (!statusInfo) return '-';

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
    [fileBuildStatusMap, getBuildStatusLabel, getFileRowKey]
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
        return visibleFileIds.includes(rowKey) && !queryingFileIdsRef.current.has(rowKey);
      });

      const recordsToQuery = visibleRecords.map((record: any) => getFileRowKey(record)).filter(Boolean);
      recordsToQuery.forEach((id) => queryingFileIdsRef.current.add(id));

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

      if (cancelled) return;

      recordsToQuery.forEach((id) => queryingFileIdsRef.current.delete(id));

      setFileBuildStatusMap((prev) => {
        const nextStatusMap = { ...prev };
        const nextPollingIds: string[] = [];

        results.forEach(({ rowKey, data }) => {
          if (!rowKey || !data) return;
          nextStatusMap[rowKey] = data;

          if (`${data?.status || ''}` === 'running') {
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
  }, [baseInfo?.resourceId, visibleFileIds, fileRecords, getBuildDirectoryPath, getFileRowKey]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

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

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [fileRecords, getFileRowKey]);

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
            return { rowKey, data: null, missingRecord: true as const };
          }
          const directoryPath = getBuildDirectoryPath(record);
          if (!directoryPath) {
            return { rowKey, data: null, missingRecord: true as const };
          }
          try {
            const res = await getFileBuildStatus({ resourceId: rid, directoryPath });
            return {
              rowKey,
              data: res || null,
              missingRecord: false as const,
            };
          } catch (error) {
            return {
              rowKey,
              data: null,
              missingRecord: false as const,
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

      setPollingFileIds((prev) =>
        prev.filter((rowKey) => {
          const row = results.find((item) => item.rowKey === rowKey);
          if (row?.missingRecord) return false;
          if (!row?.data) return false;
          const status = `${row?.data?.status || ''}`;
          return status !== 'complete' && status !== 'failed';
        })
      );

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
  }, [baseInfo?.resourceId, displayDirectoryList, getBuildDirectoryPath, pollingFileIdsKey, getFileRowKey]);

  const submitBuildTask = useCallback(
    (record: any) => {
      const directoryPath = getBuildDirectoryPath(record);
      if (!directoryPath) {
        message.error('无法解析文件路径，请稍后重试');
        return;
      }

      const rowKey = getFileRowKey(record);
      if (!rowKey) {
        message.error('无法解析文件路径，请稍后重试');
        return;
      }

      const rid = baseInfo?.resourceId;
      if (rid === null || rid === undefined || rid === '') {
        message.error('缺少文档库信息');
        return;
      }

      const payload: BuildDatasetPayload = {
        directoryPath,
        resourceId: String(rid),
      };

      setBuildingFileIds((prev) => (prev.includes(rowKey) ? prev : [...prev, rowKey]));
      setPollingFileIds((prev) => (prev.includes(rowKey) ? prev : [...prev, rowKey]));
      message.info('已提交构建任务，后台处理中');

      window.setTimeout(() => {
        void buildDataset(payload)
          .then(() => {
            getDirectoryList();
          })
          .catch((error) => {
            const errorMessage = error?.response?.data?.msg || error?.msg || error?.message || '构建失败';
            message.error(errorMessage);
            setPollingFileIds((prev) => prev.filter((k) => k !== rowKey));
            getDirectoryList();
          })
          .finally(() => {
            setBuildingFileIds((prev) => prev.filter((k) => k !== rowKey));
          });
      }, 0);
    },
    [baseInfo?.resourceId, getBuildDirectoryPath, getDirectoryList, getFileRowKey, message]
  );

  const handleAction = (key: string, record: any) => {
    switch (key) {
      case 'top':
        break;
      case 'move':
        setMoveModalVisible(true);
        break;
      case 'rename':
        modalAction.handleShow('edit', record);
        break;
      case 'download': {
        const directoryPath = getBuildDirectoryPath(record);
        const rid = baseInfo?.resourceId;
        if (!directoryPath || rid === null || rid === undefined || rid === '') {
          message.error('无法下载：缺少文件路径或文档库信息');
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
          onOk: () => {
            let promise: Promise<any>;
            if (record?.type === 'directory') {
              const directoryPath = getBuildDirectoryPath(record);
              const rid = baseInfo?.resourceId;
              if (!directoryPath || rid === null || rid === undefined || rid === '') {
                message.error('无法删除：缺少目录路径或文档库信息');
                return Promise.reject(new Error('invalid delete folder params'));
              }
              promise = deleteFolder({ resourceId: Number(rid), directoryPath });
            } else {
              const filePath = getBuildDirectoryPath(record);
              const rid = baseInfo?.resourceId;
              if (!filePath || rid === null || rid === undefined || rid === '') {
                message.error('无法删除：缺少文件路径或文档库信息');
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
      let actionList: ActionItem[] = [
        {
          label: intl.formatMessage({ id: 'common.delete' }),
          key: 'delete',
          icon: (
            <Tooltip title="删除文件">
              <span className="iconfont icon-a-Deleteshanchu" />
            </Tooltip>
          ),
        },
      ];

      if (record?.type === 'directory') {
        // 目录显示重命名按钮
        actionList.unshift({
          label: intl.formatMessage({ id: 'directoryManage.rename' }),
          key: 'rename',
          icon: <span className="iconfont icon-a-Editbianji" />,
        });
      } else {
        const isBuilding = buildingFileIds.includes(getFileRowKey(record));

        actionList.unshift({
          label: intl.formatMessage({ id: 'common.download' }),
          key: 'download',
          icon: (
            <Tooltip title={intl.formatMessage({ id: 'directoryManage.downloadFile' })}>
              <span className="iconfont icon-a-Downloadxiazai" />
            </Tooltip>
          ),
        });
        actionList.unshift({
          label: '构建',
          key: 'build',
          disabled: isBuilding,
          icon: (
            <Tooltip title="构建文件">
              {isBuilding ? <Spin size="small" /> : <span className="iconfont icon-goujian" />}
            </Tooltip>
          ),
        });
      }

      return actionList;
    },
    [buildingFileIds, getFileRowKey, intl]
  );

  const columns = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'directoryManage.fileName' }),
        dataIndex: 'name',
        width: '40%',
        align: 'center',
        render: (v: string, record: any) => {
          let iconType = '';
          if (/\.(doc|docx)$/.test(v)) {
            iconType = 'Word';
          } else if (v?.endsWith('.pdf')) {
            iconType = 'PDF';
          } else if (/\.(xls|xlsx)$/.test(v)) {
            iconType = 'Excel';
          } else if (v?.endsWith('.txt')) {
            iconType = 'jishiben';
          } else if (v?.endsWith('.ppt')) {
            iconType = 'PPT';
          } else if (v?.endsWith('.md')) {
            iconType = 'markdown';
          } else if (/\.(png|jpg|jpeg)$/.test(v)) {
            iconType = 'Image';
          } else if (record.type === 'directory') {
            iconType = 'wenjianjia';
          }
          let onClick: React.DOMAttributes<HTMLDivElement>['onClick'];
          let style: React.CSSProperties = {};
          if (record.type === 'directory') {
            style = { cursor: 'pointer' };
            onClick = () => {
              setFolderPath((prev) => [
                ...prev,
                {
                  id: record.id,
                  title: record.collectionName ?? record.name,
                },
              ]);
            };
          }

          const isFile = record.type === 'file';
          const rowKey = isFile ? getFileRowKey(record) : '';

          return (
            <div
              onClick={onClick}
              style={{ display: 'flex', alignItems: 'center', ...style }}
              title={v}
              ref={
                isFile
                  ? (el) => {
                    if (el) fileRefs.current[rowKey] = el as HTMLTableRowElement;
                  }
                  : undefined
              }
            >
              <AntdIcon type={`icon-${iconType}`} style={{ fontSize: 24, marginRight: 14 }} />
              <div className="textEllipsis">{v}</div>
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
        align: 'center',
        render: (v: string, record: any) => {
          const actions = getActions(record);
          return <ButtonsWithMore actions={actions} maximun={4} handleAction={(key) => handleAction(key, record)} />;
        },
      },
    ],
    [getActions, getBuildProgressText, handleAction, intl]
  );

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
          emptyLocale={{
            emptyText: (
              <DirectoryEmpty
                baseInfo={baseInfo}
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
          loading={directoryLoading}
        />
      </div>
      {moveModalVisible && (
        <MoveModal
          visible={moveModalVisible}
          onCancel={() => setMoveModalVisible(false)}
          onOk={() => {
            setMoveModalVisible(false);
            setTimeout(() => {
              getDirectoryList({ pageIndex: 1 });
            }, 100);
          }}
          onAdd={() => {}}
          baseInfo={baseInfo}
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
