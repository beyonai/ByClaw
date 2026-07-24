import React, { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { Drawer } from 'antd';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import { DragType } from '@/components/QueryInput/withDrag';
import type { FileBrowserItem } from '@/service/fileBrowser';
import { listFiles } from '@/service/fileBrowser';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import {
  canPreviewFile,
  ensureDirectoryPath,
  getSessionFilePath,
  isDirectory,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
  sortFileBrowserItems,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import useGlobal from '@/hooks/useGlobal';
import ProjectSessionFilePreviewDrawer from './ProjectSessionFilePreviewDrawer';

type ProjectSessionResultDrawerProps = {
  open: boolean;
  resourceId?: string;
  sessionId?: string;
  sessionName?: string;
  onClose: () => void;
};

const ProjectSessionResultDrawer: React.FC<ProjectSessionResultDrawerProps> = ({
  open,
  resourceId = '',
  sessionId = '',
  sessionName,
  onClose,
}) => {
  const { EventEmitter } = useGlobal();
  const [files, setFiles] = useState<FileBrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [previewFile, setPreviewFile] = useState<FileBrowserItem>();
  const clickTimerRef = useRef<number | null>(null);

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const loadSessionFiles = useCallback(async () => {
    if (!resourceId || !sessionId) {
      setFiles([]);
      return;
    }

    setLoading(true);
    try {
      // 与项目资源 Tab 的“会话空间-当前会话”使用同一路径和文件查询接口。
      const response = await listFiles({ resourceId, path: getSessionFilePath(sessionId) });
      setFiles(sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(response)));
    } catch (error) {
      console.error('Failed to load project session result files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [resourceId, sessionId]);

  useEffect(() => {
    setPreviewFile(undefined);
    if (!open) {
      return;
    }
    setExpandedKeys([]);
    setChildrenByPath({});
    void loadSessionFiles();
  }, [loadSessionFiles, open]);

  useEffect(() => clearClickTimer, [clearClickTimer]);

  const handleLoadData = useCallback(
    async (node: FileTreeItem) => {
      if (!resourceId || !isDirectory(node)) return;
      const directoryPath = ensureDirectoryPath(normalizeFileBrowserPath(node.path));
      if (childrenByPath[directoryPath]) return;

      try {
        const response = await listFiles({ resourceId, path: directoryPath });
        setChildrenByPath((prev) => ({
          ...prev,
          [directoryPath]: sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(response)),
        }));
      } catch (error) {
        console.error('Failed to load project session result directory:', error);
        setChildrenByPath((prev) => ({ ...prev, [directoryPath]: [] }));
      }
    },
    [childrenByPath, resourceId]
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      clearClickTimer();
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (!isDirectory(node) && canPreviewFile(node)) {
          // 成果文件在嵌套右侧抽屉中预览，避免全局预览层被成果抽屉遮挡。
          setPreviewFile(node);
        }
      }, 220);
    },
    [clearClickTimer]
  );

  const handleNodeDoubleClick = useCallback(
    (node: FileTreeItem) => {
      if (!resourceId) return;
      clearClickTimer();
      // 成果抽屉延续资源 Tab 的双击行为，可把文件或文件夹引用插入聊天输入框。
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(node, resourceId),
        type: isDirectory(node) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, clearClickTimer, resourceId]
  );

  const handleClose = () => {
    clearClickTimer();
    setPreviewFile(undefined);
    onClose();
  };

  return (
    <Drawer
      title="任务成果"
      open={open}
      onClose={handleClose}
      width={480}
      destroyOnClose
      // 抽屉主体固定高度并保留左右间距，文件树在剩余区域内滚动，避免内容变多时压缩展示区域。
      styles={{ body: { padding: '0 16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
    >
      <FileSpaceBlock
        title={sessionName || '当前会话'}
        loading={loading}
        items={files}
        currentPath={getSessionFilePath(sessionId)}
        emptyText={resourceId ? '当前会话暂无成果文件' : '未关联文件空间'}
        fillContainer
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
        showActions={false}
        onExpand={setExpandedKeys}
        onLoadData={handleLoadData}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        getActionItems={() => []}
        onAction={() => undefined}
      />
      <ProjectSessionFilePreviewDrawer
        open={!!previewFile}
        resourceId={resourceId}
        file={previewFile}
        onClose={() => setPreviewFile(undefined)}
      />
    </Drawer>
  );
};

export default ProjectSessionResultDrawer;
