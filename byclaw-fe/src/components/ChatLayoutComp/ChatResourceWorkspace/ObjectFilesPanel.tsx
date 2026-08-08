import React, { useCallback, useEffect, useState } from 'react';
import { ApartmentOutlined, RightOutlined } from '@ant-design/icons';
import { Descriptions, Empty, List, Spin, Typography, message } from 'antd';
import { useIntl } from '@umijs/max';
import { listProjectObjectFiles } from '@/service/devloop';
import { getOntologyObjectDetail } from '@/service/ontology';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import FilePreviewPanel from './FilePreviewPanel';
import OntologyNodeDrawer from '@/pages/ontologyCenter/OntologyNodeDrawer';
import styles from '@/pages/projectSpace/index.module.less';

interface ObjectFilesPanelProps {
  projectId?: number | string;
  sessionId?: number | string;
  /** 外部资源 Tab 刷新时递增，用于重新读取本体对象列表。 */
  refreshToken?: number;
  onOpenDetail?: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

type ObjectFileItem = {
  key: string;
  name: string;
  code?: string;
  description?: string;
  source?: string;
  raw?: any;
};

const getFileResourceId = (file: any, item: ObjectFileItem) => {
  if (file.resourceId || file.kbResourceId || file.kb_resource_id || item.raw?.resourceId || item.raw?.kbResourceId || item.raw?.kb_resource_id) {
    return file.resourceId || file.kbResourceId || file.kb_resource_id || item.raw?.resourceId || item.raw?.kbResourceId || item.raw?.kb_resource_id;
  }
  try {
    const parseExtra = (value: any) => (typeof value === 'string' ? JSON.parse(value) : value);
    const fileExtra = parseExtra(file.extContent || file.ext_content);
    const objectExtra = parseExtra(item.raw?.extContent || item.raw?.ext_content);
    return fileExtra?.kb_resource_id || fileExtra?.kbResourceId || objectExtra?.kb_resource_id || objectExtra?.kbResourceId;
  } catch {
    return undefined;
  }
};

const getFilePath = (file: any) =>
  file.filePath || file.file_path || file.path || file.relativePath || file.relative_path || file.name;

const getFileUrl = (file: any) => file.fileUrl || file.file_url || file.url || file.downloadUrl || file.download_url;

const OntologyObjectPanel: React.FC<{
  item: ObjectFileItem;
  onClose: () => void;
  onOpenFile?: (file: any) => void;
}> = ({ item, onClose, onOpenFile }) => (
  <OntologyNodeDrawer
    open
    panel
    node={{
      level: 'OBJECT_IN_SCENE',
      objectCode: item.code,
      objectName: item.name,
      systemCode: item.raw?.systemCode,
    }}
    systemCode={item.raw?.systemCode}
    relatedFiles={item.raw?.projectObjectFiles || item.raw?.files || []}
    onRelatedFileClick={onOpenFile}
    showReference={false}
    onClose={onClose}
  />
);

// 保留旧版详情组件作为接口降级兜底；当前对象详情优先复用本体模块的 OntologyNodeDrawer。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ObjectFileDetailPanel: React.FC<{
  item: ObjectFileItem;
  onOpenFile?: (file: any) => void;
}> = ({ item, onOpenFile }) => {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!item.code) return;
    setLoading(true);
    void getOntologyObjectDetail({ objectCode: item.code, systemCode: item.raw?.systemCode })
      .then((response: any) => setDetail(response?.data ?? response ?? null))
      .catch((error) => console.error('Failed to load ontology object detail:', error))
      .finally(() => setLoading(false));
  }, [item.code, item.raw?.systemCode]);
  const files = item.raw?.projectObjectFiles || item.raw?.files || [];
  const fields = detail?.fields || detail?.objectFields || detail?.properties || [];
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={4}>{item.name}</Typography.Title>
      <Spin spinning={loading}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="对象编码">{item.code || '-'}</Descriptions.Item>
          <Descriptions.Item label="对象说明">
            {detail?.objectDesc || detail?.description || item.description || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源">{detail?.source || item.source || '-'}</Descriptions.Item>
        </Descriptions>
        {Array.isArray(fields) && fields.length > 0 && (
          <List
            style={{ marginTop: 16 }}
            header="对象属性"
            dataSource={fields}
            renderItem={(field: any) => (
              <List.Item>{field.propertyName || field.fieldName || field.name || field.code || '-'}</List.Item>
            )}
          />
        )}
      </Spin>
      {Array.isArray(files) && files.length > 0 && (
        <List
          style={{ marginTop: 16 }}
          header="关联文件"
          dataSource={files}
          renderItem={(file: any) => (
            <List.Item
              onClick={() => {
                if (!getFileUrl(file) && (!getFileResourceId(file, item) || !getFilePath(file))) {
                  message.error('文件缺少预览地址或资源路径');
                  return;
                }
                onOpenFile?.(file);
              }}
              style={{ cursor: onOpenFile ? 'pointer' : undefined }}
            >
              <Typography.Text ellipsis={{ tooltip: file.fileName || file.filePath }}>
                {file.fileName || file.filePath || '-'}
              </Typography.Text>
            </List.Item>
          )}
        />
      )}
    </div>
  );
};

const toList = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const nested =
    value.data || value.records || value.list || value.rows || value.items || value.objectFiles || value.files;
  if (nested !== undefined) return toList(nested);
  return value.objectCode || value.objectName || value.fileName || value.name ? [value] : [];
};

// 接口在不同版本中可能返回对象文件、对象列表或分页包装，统一在这里兼容字段并保持展示层简单。
const normalizeObjectFiles = (response: any): ObjectFileItem[] =>
  toList(response).map((item: any, index) => {
    const code = item.objectCode || item.object_code || item.resourceCode || item.code || item.fileCode;
    const name =
      item.objectName ||
      item.object_name ||
      item.resourceName ||
      item.fileName ||
      item.name ||
      code ||
      `对象${index + 1}`;
    return {
      key: `${code || name}-${index}`,
      name: String(name),
      code: code ? String(code) : undefined,
      description: item.objectDesc || item.object_desc || item.description || item.fileDesc,
      source: item.objectSource || item.object_source || item.kbDirectory || item.kbResourceName || item.source,
      raw: item,
    };
  });

const ObjectFilesPanel: React.FC<ObjectFilesPanelProps> = ({
  projectId,
  sessionId,
  refreshToken = 0,
  onOpenDetail,
}) => {
  const intl = useIntl();
  const [items, setItems] = useState<ObjectFileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadObjects = useCallback(async () => {
    if (!projectId && !sessionId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const response = await listProjectObjectFiles({ projectId, sessionId });
      setItems(normalizeObjectFiles(response));
    } catch (error) {
      // 资源面板允许接口暂不可用，失败时保持空态，不影响会话和项目其它资源展示。
      console.error('Failed to load project ontology object files:', error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    void loadObjects();
  }, [loadObjects, refreshToken]);

  return (
    <Spin spinning={loading} className={styles.resourceCategoryBody}>
      {items.length
        ? items.map((item) => (
          <div
            key={item.key}
            className={styles.resourceSimpleItem}
            role={onOpenDetail ? 'button' : undefined}
            tabIndex={onOpenDetail ? 0 : undefined}
            onClick={() =>
              onOpenDetail?.(<OntologyObjectPanel item={item} onClose={() => undefined} onOpenFile={(file) => onOpenDetail?.(
                <FilePreviewPanel
                  fileName={file.fileName || file.filePath || '文件'}
                  resourceId={getFileResourceId(file, item)}
                  path={getFilePath(file)}
                  fileUrl={getFileUrl(file)}
                />,
                {
                  width: 'half-main-content',
                  tabKey: `ontology-file:${file.id || file.filePath || file.fileName}`,
                  title: file.fileName || file.filePath || '文件预览',
                }
              )} />, {
                width: 'half-main-content',
                tabKey: `ontology-object:${item.key}`,
                title: item.name,
              })
            }
            onKeyDown={(event) => {
              if (onOpenDetail && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onOpenDetail(<OntologyObjectPanel item={item} onClose={() => undefined} />, {
                  width: 'half-main-content',
                  tabKey: `ontology-object:${item.key}`,
                  title: item.name,
                });
              }
            }}
          >
            <span className={`${styles.resourceSimpleIcon} ${styles.resourceRepoIcon}`}>
              <ApartmentOutlined />
            </span>
            <div className={styles.resourceSimpleMain}>
              <Typography.Text strong ellipsis={{ tooltip: item.name }}>
                {item.name}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis>
                {item.description || item.source || item.code || intl.formatMessage({ id: 'chatResource.ontology' })}
              </Typography.Text>
            </div>
            <RightOutlined />
          </div>
        ))
        : !loading && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={intl.formatMessage({ id: 'chatResource.empty' })}
          />
        )}
    </Spin>
  );
};

export default ObjectFilesPanel;
