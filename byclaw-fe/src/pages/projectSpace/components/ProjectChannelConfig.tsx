import { Button, Empty, Form, Input, List, Modal, Select, Spin, Switch, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
  createScanSource,
  deleteScanSource,
  listScanSources,
  toggleScanSource,
  triggerScan,
  updateScanSource,
} from '@/service/devloop';

interface Props {
  open: boolean;
  projectId?: string | number;
  canManage?: boolean;
  onClose: () => void;
}

// 新版大详情复用旧版渠道列表接口，先保证研发项目可以从需求页进入渠道配置查看入口。
const ProjectChannelConfig: React.FC<Props> = ({ open, projectId, canManage = false, onClose }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);
  const [editingSource, setEditingSource] = useState<any | null>(null);
  const [form] = Form.useForm();
  const normalizeRows = (response: any) => {
    const data = response?.data ?? response;
    if (Array.isArray(data)) return data;
    return data?.list || data?.rows || data?.records || [];
  };

  useEffect(() => {
    if (!open || !projectId) return;
    setLoading(true);
    void listScanSources({ projectId: Number(projectId), pageNum: 1, pageSize: 100 })
      .then((response: any) => setSources(normalizeRows(response)))
      .catch((error: any) => {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.channel.loadFailed' }));
        setSources([]);
      })
      .finally(() => setLoading(false));
  }, [intl, open, projectId]);

  const reload = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response: any = await listScanSources({ projectId: Number(projectId), pageNum: 1, pageSize: 100 });
      setSources(normalizeRows(response));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.channel.loadFailed' }));
    } finally {
      setLoading(false);
    }
  };

  const openEditor = (source?: any) => {
    setEditingSource(source || {});
    form.setFieldsValue({
      sourceName: source?.sourceName || source?.name || '',
      sourceType: source?.sourceType || 'github_issue',
      cronExpr: source?.cronExpr || source?.cron || '0 */1 * * * ?',
      config: source?.config || '{}',
    });
  };

  const saveSource = async (values: any) => {
    try {
      const payload = {
        sourceName: values.sourceName.trim(),
        sourceType: values.sourceType,
        cronExpr: values.cronExpr?.trim(),
        config: values.config?.trim() || '{}',
      };
      if (editingSource?.sourceId) {
        await updateScanSource({ sourceId: Number(editingSource.sourceId), ...payload });
      } else {
        await createScanSource({ projectId: Number(projectId), ...payload });
      }
      message.success(intl.formatMessage({ id: 'projectSpace.channel.saveSuccess' }));
      setEditingSource(null);
      form.resetFields();
      await reload();
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.channel.saveFailed' }));
    }
  };

  const handleDelete = (source: any) => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'projectSpace.channel.deleteTitle' }),
      content: intl.formatMessage(
        { id: 'projectSpace.channel.deleteContent' },
        { name: source.sourceName || source.name || source.sourceId }
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteScanSource(Number(source.sourceId));
          await reload();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'projectSpace.channel.deleteFailed' }));
        }
      },
    });
  };

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'projectSpace.channel.title' })}
      footer={null}
      width={720}
      onCancel={onClose}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {canManage && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
            <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
              {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
              {intl.formatMessage({ id: 'projectSpace.channel.add' })}
            </Button>
          </div>
        )}
        {sources.length ? (
          <List
            dataSource={sources}
            renderItem={(source: any) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    source.sourceName ||
                    source.name ||
                    intl.formatMessage({ id: 'projectSpace.channel.defaultName' }, { id: source.sourceId || '' })
                  }
                  description={source.sourceDescription || source.description || source.sourceType || '-'}
                />
                {/* 渠道操作组件声明在文件末尾，避免把管理逻辑分散到列表渲染中。 */}
                {/* eslint-disable-next-line @typescript-eslint/no-use-before-define */}
                <SpaceActions
                  source={source}
                  canManage={canManage}
                  onEdit={() => openEditor(source)}
                  onDelete={() => handleDelete(source)}
                  onToggle={async (enabled) => {
                    await toggleScanSource(Number(source.sourceId), enabled ? '1' : '0');
                    await reload();
                  }}
                  onTrigger={async () => {
                    await triggerScan(Number(source.sourceId));
                    message.success(intl.formatMessage({ id: 'projectSpace.channel.triggerSuccess' }));
                  }}
                />
              </List.Item>
            )}
          />
        ) : (
          !loading && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'projectSpace.channel.empty' })}
            />
          )
        )}
      </Spin>
      <Modal
        open={editingSource !== null}
        title={intl.formatMessage({
          id: editingSource?.sourceId ? 'projectSpace.channel.edit' : 'projectSpace.channel.addTitle',
        })}
        onCancel={() => setEditingSource(null)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(values) => void saveSource(values)}>
          <Form.Item
            name="sourceName"
            label={intl.formatMessage({ id: 'projectSpace.channel.name' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'projectSpace.channel.nameRequired' }) }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="sourceType"
            label={intl.formatMessage({ id: 'projectSpace.channel.type' })}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'github_issue', label: 'GitHub Issue' },
                { value: 'dingtalk', label: intl.formatMessage({ id: 'projectSpace.channel.dingtalk' }) },
                { value: 'dingtalk_todo', label: intl.formatMessage({ id: 'projectSpace.channel.dingtalkTodo' }) },
              ]}
            />
          </Form.Item>
          <Form.Item name="cronExpr" label={intl.formatMessage({ id: 'projectSpace.channel.cron' })}>
            <Input placeholder="0 */1 * * * ?" />
          </Form.Item>
          <Form.Item name="config" label={intl.formatMessage({ id: 'projectSpace.channel.config' })}>
            <Input.TextArea rows={5} />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
};

function SpaceActions({
  source,
  canManage,
  onEdit,
  onDelete,
  onToggle,
  onTrigger,
}: {
  source: any;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => Promise<void>;
  onTrigger: () => Promise<void>;
}) {
  const intl = useIntl();
  const enabled = source.enabled === '1' || source.enabled === 1 || source.enabled === true;
  const statusText = intl.formatMessage({
    id: enabled ? 'projectSpace.channel.enabled' : 'projectSpace.channel.disabled',
  });
  if (!canManage) return <Tag color={enabled ? 'success' : 'default'}>{statusText}</Tag>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Tag color={enabled ? 'success' : 'default'}>{statusText}</Tag>
      <Switch size="small" checked={enabled} onChange={(value) => void onToggle(value)} />
      <Button type="text" size="small" icon={<ThunderboltOutlined />} onClick={() => void onTrigger()} />
      <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} />
      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} />
    </div>
  );
}

export default ProjectChannelConfig;
