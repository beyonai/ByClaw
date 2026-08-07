import React, { useCallback, useEffect, useState } from 'react';
import { ApartmentOutlined, RightOutlined } from '@ant-design/icons';
import { Descriptions, Empty, List, Spin, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import { listProjectObjectFiles } from '@/service/devloop';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import styles from '@/pages/projectSpace/index.module.less';

interface ObjectFilesPanelProps {
  projectId?: number | string;
  sessionId?: number | string;
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

const ObjectFileDetailPanel: React.FC<{ item: ObjectFileItem }> = ({ item }) => {
  const files = item.raw?.projectObjectFiles || item.raw?.files || [];
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={4}>{item.name}</Typography.Title>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="对象编码">{item.code || '-'}</Descriptions.Item>
        <Descriptions.Item label="对象说明">{item.description || '-'}</Descriptions.Item>
        <Descriptions.Item label="来源">{item.source || '-'}</Descriptions.Item>
      </Descriptions>
      {Array.isArray(files) && files.length > 0 && (
        <List
          style={{ marginTop: 16 }}
          header="关联文件"
          dataSource={files}
          renderItem={(file: any) => (
            <List.Item>
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

const ObjectFilesPanel: React.FC<ObjectFilesPanelProps> = ({ projectId, sessionId, onOpenDetail }) => {
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
  }, [loadObjects]);

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
              onOpenDetail?.(<ObjectFileDetailPanel item={item} />, {
                width: 'half-main-content',
                tabKey: `ontology-object:${item.key}`,
                title: item.name,
              })
            }
            onKeyDown={(event) => {
              if (onOpenDetail && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onOpenDetail(<ObjectFileDetailPanel item={item} />, {
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
