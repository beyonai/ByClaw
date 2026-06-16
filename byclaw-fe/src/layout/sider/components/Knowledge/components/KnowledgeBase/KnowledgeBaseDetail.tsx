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

interface KnowledgeBaseDetailProps {
  editable?: boolean;
  dataset: IKnowledgeBaseItem;
  onGoBack: () => void;
  onSelect?: (item: IKnowledgeCollectionItem, type: IDragType) => void;
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
  const { editable, dataset, onGoBack, onSelect } = props;
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<IKnowledgeDetailTreeItem[]>([]);
  const treeWrap = useRef<HTMLDivElement>(null);
  const treeClickTimerRef = useRef<number | null>(null);
  const virtualHeight = useVirtualHeight(treeWrap);
  const { EventEmitter } = useGlobal();
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
        const pathKey =
          String(item.directoryPath ?? '').trim() ||
          String(item.id !== null && item.id !== undefined ? item.id : `${directoryPath}/${item.name}`);
        return {
          id: String(item.id ?? ''),
          collectionName: item.name,
          datasetId,
          type: item.type,
          fileId: item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : undefined,
          parentId: String(parentId),
          directoryPath: item.directoryPath,

          title: item.name,
          key: pathKey,
          isLeaf: item.type === 'file',
        };
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
      const fileName = String(item.title || item.collectionName || '');
      if (!isPreviewable(fileName)) return;

      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!directoryPath) {
        message.warning('无法解析文件路径');
        return;
      }

      renderPreviewPanel(item, { loading: true });
      try {
        const res: any = await downloadResourceFile({
          resourceId: dataset.resourceId,
          directoryPath,
        });
        const rawBlob = res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
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
          message.warning('无法解析文件路径');
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
      }
    },
    [dataset.resourceId, intl, message, modal, modalAction]
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
                if (item.type === 'file') {
                  menus.unshift({
                    key: 'download',
                    label: intl.formatMessage({ id: 'common.download' }),
                  });
                }
                return (
                  <>
                    {item.title}
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: menus,
                        onClick: ({ key }) => onMenuItemClick(key, item),
                      }}
                    >
                      <EllipsisOutlined className={commonStyles.treeActionIcon} />
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
