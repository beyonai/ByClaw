import React, { useContext, useEffect, useState, useRef } from 'react';
import { Tree, ConfigProvider, Spin, message, Empty, Modal } from 'antd';
import type { TreeDataNode, TreeProps } from 'antd';
import { EyeOutlined, DownloadOutlined, DeleteOutlined, FolderAddOutlined, PlusOutlined } from '@ant-design/icons';
import cn from 'classnames';
import { useIntl } from '@umijs/max';
import { KeepAlive } from '@/components/KeepAlive';
import AntdIcon from '@/components/AntdIcon';
import { deleteFiles, deleteCatalog, getCatalogsByTaskId, getWorkSpaceFile } from '@/service/workSpace';
import { InputFilter } from './InputFilter';
import { FilePreview } from './FilePreview';
import { AchievementContext } from './AchievementContext';
import { useUploadFileModal } from './UploadFileModal';
import useGlobal from '@/hooks/useGlobal';
import { LayoutMode } from '@/constants/system';

import styles from './file.view.module.less';

type FileInfo = {
  type?: string;
  name?: string;
  path?: string;
  fileUrl?: string;
  content?: string;
};

type FileItem = TreeDataNode & FileInfo & { children?: (TreeDataNode & FileInfo)[] };

const isDev = true;

export default function FileView() {
  const intl = useIntl();
  const { layoutMode } = useGlobal();

  const context = useContext(AchievementContext);
  const [fileInfo, setFileInfo] = useState<FileInfo>();
  const [task] = context.useValue('task');
  const [sessionId] = context.useValue('sessionId');
  const [currentFile, setCurrentFile] = context.useValue('currentFile');
  const [loading, setLoading] = useState<boolean>(false);
  const [treeData, setTreeData] = useState<FileItem[]>([]);
  const [updateAt, setUpdateAt] = useState<number>();
  const [inputValue, setInputValue] = useState<string>('');
  const tmp = useRef<string>('');

  const { holder, show: showUploadModal } = useUploadFileModal();

  const isPreviewMode = layoutMode === LayoutMode.preview;

  const onRefresh = async (param: any = {}) => {
    if (!param.sessionId || !param.taskId) return;

    const folderTask = getCatalogsByTaskId(param.taskId);

    const fileTask = getWorkSpaceFile({
      sessionId: param.sessionId,
      taskId: param.taskId,
      fileName: param.fileName,
      matchMode: 'all', // any/all 默认all
    });

    setLoading(true);
    const [folderTaskRes, fileTaskRes] = await Promise.allSettled([folderTask, fileTask]);
    setLoading(false);

    const folders: FileItem[] = [];

    if (folderTaskRes.status === 'fulfilled') {
      folderTaskRes.value.forEach((it: any) => {
        Object.assign(it, {
          type: 'folder',
          name: it.cataName,
          title: it.cataName,
          key: it.taskCatalogId,
        });

        const parent = folderTaskRes.value.find((p: any) => p.taskCatalogId === it.pCatalogId);
        if (parent) {
          // 如果父级有路径，说明父级已经加入了文件夹列表，需要继承父级路径
          if (parent.path) {
            it.path = [...parent.path, parent.children?.length ?? 0];
          }
          parent.children = [...(parent.children || []), it];
        } else if (it.pCatalogId === '-1') {
          const buildPath = (_it: any, _path: number[] = []) => {
            _it.path = _path;
            _it.children?.forEach((child: any, i: number) => {
              buildPath(child, [..._it.path, i]);
            });
          };
          // 首次加入需要重建路径，注意顺序，要最后加入，因为要使用folders.length作为路径
          buildPath(it, [folders.length]);

          folders.push(it);
        }
      });
    }

    if (fileTaskRes.status === 'fulfilled') {
      const otherFiles: FileItem[] = [];

      fileTaskRes.value.files.forEach((it: any) => {
        const type = it.fileName.split('.').pop() ?? '';
        const item: FileItem = {
          ...it,
          type: type.toLowerCase(),
          key: it.fileId,
          name: it.fileName,
          title: it.fileName,
        };

        const texts: string[] = (it.tags || '').match(/TC(\d*)_([^,]+)/g) ?? [];
        const libs = texts.reduce<Record<string, string>>((acc, s) => {
          const [, lv = '0', name = ''] = s.match(/TC(\d*)_([^,]+)/) ?? [];
          return { ...acc, [lv]: name };
        }, {});

        const _folders = Array.from(new Set(Object.values(libs)));
        let isAppendedInFolder = false;
        // 有层级
        if (_folders.length) {
          // 按层级排序
          _folders.forEach((it) => {
            // TODO: 需要优化，如果不同层级有相同名称的文件夹需要处理
            const folder = folders.find((x) => x.name === it);
            if (folder) {
              folder.children = [
                ...(folder.children || []),
                {
                  ...item,
                  // 如果_folders有多个的话，同一个文件就会挂到不同的目录下，导致key重复，导致树组件渲染异常
                  key: `${it}-${item.key}`,
                },
              ];
              isAppendedInFolder = true;
            } else if (!isAppendedInFolder) {
              otherFiles.push(item);
            }
          });
        } else {
          // 没有文件夹，直接添加到根目录
          otherFiles.push(item);
        }
      });

      console.log('folders >>>', folders, otherFiles);
      // 没有目录的是不对的，暂时不添加到根目录
      folders.push(...otherFiles);
    }

    setTreeData(folders);
  };

  useEffect(() => {
    onRefresh({ sessionId, taskId: task?.taskId });
  }, [sessionId, task, updateAt]);

  const onPreview = (item: TreeDataNode & FileInfo) => {
    Object.assign(item, { path: item.fileUrl });
    setFileInfo(item);
  };

  const onBack = () => {
    setFileInfo(undefined);
    setCurrentFile(undefined);
  };

  const onUpload = (item: any) => async (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (!task?.taskId || !sessionId || !item.taskCatalogId) return;

    await showUploadModal({
      taskId: task?.taskId,
      sessionId: sessionId.toString(),
      taskCatalogId: item.taskCatalogId,
    });

    setUpdateAt(Date.now());
  };

  const onDownload = (item: TreeDataNode & FileInfo) => {
    const { fileId } = item as any;
    if (!fileId || !item.fileUrl) {
      message.warning(intl.formatMessage({ id: 'workSpace.fileView.fileNotExist' }));
      return;
    }
    setLoading(true);

    let url = item.fileUrl;
    if (url.startsWith('/WaManagerService')) {
      url = `/byaiService${url}`;
    }
    fetch(url)
      .then((res) => {
        res.blob().then((blob) => {
          if (tmp.current) {
            URL.revokeObjectURL(tmp.current);
          }
          tmp.current = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = tmp.current;
          a.download = item.name || '-';
          a.click();
        });
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const onDelete = (item: any) => (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();

    const isFolder = item.type === 'folder';
    const title = isFolder
      ? intl.formatMessage({ id: 'workSpace.fileView.deleteFolder' })
      : intl.formatMessage({ id: 'workSpace.fileView.deleteFile' });
    const content = intl.formatMessage({ id: 'workSpace.fileView.deleteConfirm' }, { name: item.name });

    Modal.confirm({
      title,
      content,
      onOk: async () => {
        let res: any;
        if (isFolder) {
          res = await deleteCatalog({ catalogId: item.catalogId });
        } else {
          res = await deleteFiles({ fileIds: [item.fileId] });
        }

        if (res?.successFileIds?.length) {
          message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
          setUpdateAt(Date.now());
        } else {
          message.error(intl.formatMessage({ id: 'common.deleteFail' }));
        }
      },
    });
  };

  const onAddFolder = (item: any) => (e: React.MouseEvent<HTMLSpanElement>) => {
    console.log(item);
    e.stopPropagation();
  };

  const iconRender: TreeProps['icon'] = (node: any) => {
    if (node.data.type === 'folder') {
      return <AntdIcon type="icon-wenjianjialanse" />;
    }

    if (node.data.type === 'md') {
      return <AntdIcon type="icon-markdown" />;
    }

    if (node.data.type === 'pdf') {
      return <AntdIcon type="icon-PDF" />;
    }

    if (node.data.type.match(/^img|image|jpg|jpeg|png|gif|bmp|webp$/i)) {
      return <AntdIcon type="icon-Image" />;
    }

    if (node.data.type.match(/^word|docx?$/)) {
      return <AntdIcon type="icon-Word" />;
    }

    if (node.data.type.match(/^excel|xlsx?$/)) {
      return <AntdIcon type="icon-Excel" />;
    }

    if (node.data.type.match(/^ppt|pptx?$/)) {
      return <AntdIcon type="icon-PPT" />;
    }

    return <AntdIcon type="icon-jishiben" />;
  };

  const titleRender: TreeProps['titleRender'] = (node: any) => {
    const isRoot = node.pCatalogId === '-1';
    const isParent = node.type === 'folder';
    const canPreview = node.type.match(/^json|md|txt|html|pdf|jpg|jpeg|png|gif|bmp|webp|pptx|xlsx|docx$/i);

    return (
      <div className={cn(styles.treeNode, { [styles.treeNodeParent]: isParent })}>
        <span className={styles.treeNodeTitle}>{typeof node.title === 'function' ? node.title(node) : node.title}</span>
        {!isPreviewMode && (
          <span className={styles.treeNodeActions}>
            {isParent && !isDev && (
              <span className={styles.icon} onClick={onAddFolder(node)}>
                <FolderAddOutlined />
              </span>
            )}
            {isParent && (
              <span className={styles.icon} onClick={onUpload(node)}>
                <PlusOutlined />
              </span>
            )}
            {!isParent && (
              <>
                {canPreview && (
                  <span className={styles.icon} onClick={() => onPreview(node)}>
                    <EyeOutlined />
                  </span>
                )}
                <span className={styles.icon} onClick={() => onDownload(node)}>
                  <DownloadOutlined />
                </span>
              </>
            )}
            {!isRoot && (
              <span className={styles.icon} onClick={onDelete(node)}>
                <DeleteOutlined />
              </span>
            )}
          </span>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (currentFile) {
      setFileInfo(currentFile);
    }
  }, [currentFile]);

  useEffect(() => {
    return () => {
      if (tmp.current) {
        URL.revokeObjectURL(tmp.current);
      }
    };
  }, []);

  return (
    <>
      <KeepAlive active={!fileInfo}>
        <ConfigProvider
          theme={{
            components: {
              Tree: {
                paddingXS: 8,
                indentSize: 10,
                borderRadius: 6,
                directoryNodeSelectedBg: '#E6EBF0A6',
                directoryNodeSelectedColor: '#14161A',
              },
            },
          }}
        >
          <div className={styles.fileViewHeader}>
            <InputFilter
              value={inputValue}
              onChange={setInputValue}
              onSearch={(v) => onRefresh({ sessionId, taskId: task?.taskId, fileName: v })}
            />
          </div>
          <div className={styles.dataSpin}>
            <Spin spinning={loading}>
              <Tree.DirectoryTree
                blockNode
                defaultExpandAll
                showLine={false}
                treeData={treeData}
                className={styles.tree}
                titleRender={titleRender}
                icon={iconRender}
              />
              {!treeData.length && <Empty />}
            </Spin>
          </div>
        </ConfigProvider>
      </KeepAlive>
      {fileInfo && <FilePreview onBack={onBack} fileInfo={fileInfo} />}
      {holder}
    </>
  );
}
