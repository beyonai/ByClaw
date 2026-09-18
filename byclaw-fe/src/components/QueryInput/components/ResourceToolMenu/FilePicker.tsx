import { useEffect, useRef, useState, type Key } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import {
  DISPLAY_FILE_PATH_PREFIX,
  SHARED_FILE_PATH,
} from '@/layout/sider/components/FileSiderPanel/constants';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import {
  ensureDirectoryPath,
  isDirectory,
  normalizeReferenceItem,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import { listFiles, type FileBrowserItem } from '@/service/fileBrowser';
import { ResourceType } from '../../RichInput/utils/constants';
import styles from './FilePicker.module.less';

// 加号菜单中的文件引用与右侧“本地共享”Tab保持同一目录范围，避免误把共享目录外的文件暴露到引用入口。
const LOCAL_SHARED_FILE_PATH = `${DISPLAY_FILE_PATH_PREFIX}${SHARED_FILE_PATH}`;

interface Props {
  onSelect: (item: any, type: any) => void;
}

const FilePicker: React.FC<Props> = ({ onSelect }) => {
  const intl = useIntl();
  const { resourceId } = useActiveSiderAgent();
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    setItems([]);
    setChildrenByPath({});
    setExpandedKeys([]);
    setLoadedKeys([]);
    setFailed(false);
    setLoading(!!resourceId);
    if (resourceId) {
      listFiles({ resourceId, path: LOCAL_SHARED_FILE_PATH })
        .then((response) => {
          if (generation.current === requestGeneration) setItems(unwrapListResponse<FileBrowserItem>(response));
        })
        .catch(() => {
          if (generation.current === requestGeneration) setFailed(true);
        })
        .finally(() => {
          if (generation.current === requestGeneration) setLoading(false);
        });
    }
    return () => {
      generation.current++;
    };
  }, [resourceId, refreshKey]);

  const quoteFile = (item: FileBrowserItem) => {
    if (!resourceId) return;
    onSelect(
      normalizeReferenceItem(item, resourceId),
      isDirectory(item) ? ResourceType.commonFolder : ResourceType.commonFile
    );
  };

  return (
    <FileSpaceBlock
      title={intl.formatMessage({ id: 'chatResource.localSharedFile' })}
      fillContainer
      items={items}
      currentPath={LOCAL_SHARED_FILE_PATH}
      loading={loading}
      emptyText={intl.formatMessage({ id: failed ? 'fileBrowser.error.loadFailed' : 'common.noData' })}
      childrenByPath={childrenByPath}
      expandedKeys={expandedKeys}
      loadedKeys={loadedKeys}
      showActions
      onRefresh={() => setRefreshKey((current) => current + 1)}
      onExpand={setExpandedKeys}
      onLoadData={async (node) => {
        if (!resourceId || !isDirectory(node)) return;
        const path = ensureDirectoryPath(node.path);
        if (childrenByPath[path]) return;
        const requestGeneration = generation.current;
        try {
          const response = await listFiles({ resourceId, path });
          if (generation.current !== requestGeneration) return;
          setChildrenByPath((current) => ({ ...current, [path]: unwrapListResponse<FileBrowserItem>(response) }));
          setLoadedKeys((current) => (current.includes(path) ? current : [...current, path]));
        } catch (error) {
          if (generation.current === requestGeneration) {
            message.error(intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
          }
          // 保留未加载状态，允许收起后再次展开重试。
          throw error;
        }
      }}
      onNodeDoubleClick={quoteFile}
      getActionItems={() => [
        {
          key: 'quote',
          label: <span className={styles.quoteAction}>{intl.formatMessage({ id: 'common.quote' })}</span>,
        },
      ]}
      onAction={(key, item) => {
        if (key === 'quote') {
          quoteFile(item);
        }
      }}
    />
  );
};

export default FilePicker;
