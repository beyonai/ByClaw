import {
  deleteSharedConfig,
  listSharedConfigs,
  saveSharedConfig,
  type SharedConfig,
} from '@/pages/manager/service/SharedSandbox';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';

const errorText = (error: unknown) => (error instanceof Error ? error.message : '共享配置操作失败');

export default function SharedConfigPanel() {
  const [rows, setRows] = useState<SharedConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Partial<SharedConfig>>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<SharedConfig>();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listSharedConfigs());
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (row?: SharedConfig) => {
    const value = row || {
      serviceKey: 'byclaw-sandbox',
      sourceServiceKey: 'byclaw-dsh',
      profileKey: '',
      enabled: false,
      maxOnlineUsers: 1,
      userIdleTimeoutSeconds: 180,
      emptyReleaseDelaySeconds: 300,
    };
    setEditing(value);
    form.setFieldsValue({ ...value, enabled: value.enabled === true || value.enabled === 1 });
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveSharedConfig({ ...editing, ...values, enabled: values.enabled ? 1 : 0 });
      message.success('共享配置已保存');
      setEditing(undefined);
      await load();
    } catch (failure) {
      message.error(errorText(failure));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: SharedConfig) => {
    try {
      await deleteSharedConfig(row);
      await load();
    } catch (failure) {
      message.error(errorText(failure));
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert
        type="info"
        showIcon
        message="每个资源档位独立配置用户容量"
        description="CPU 和内存由服务规格配置管理。人数上限应按实际业务压测结果设置；修改容量仅影响新实例，已有实例继续使用创建时的容量。"
      />
      <Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
          新增共享配置
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      <Table<SharedConfig>
        rowKey={(row) => row.id || `${row.serviceKey}:${row.profileKey}`}
        loading={loading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 950 }}
        columns={[
          { title: 'Service Key', dataIndex: 'serviceKey' },
          { title: '业务 Service Key', dataIndex: 'sourceServiceKey' },
          { title: '资源档位', dataIndex: 'profileKey' },
          {
            title: 'CPU / 内存上限',
            render: (_, row) => `${row.resourceLimits?.cpu || '-'} / ${row.resourceLimits?.memory || '-'}`,
          },
          { title: '人数上限', dataIndex: 'maxOnlineUsers' },
          { title: '心跳超时（秒）', dataIndex: 'userIdleTimeoutSeconds' },
          { title: '空闲释放（秒）', dataIndex: 'emptyReleaseDelaySeconds' },
          {
            title: '状态',
            dataIndex: 'enabled',
            render: (value) => (value === true || value === 1 ? '已启用' : '已关闭'),
          },
          {
            title: '操作',
            fixed: 'right',
            render: (_, row) => (
              <Space>
                <Button type="link" onClick={() => edit(row)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除共享配置？"
                  description="存在使用中的实例时不能删除。"
                  onConfirm={() => remove(row)}
                >
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing?.id ? '编辑共享配置' : '新增共享配置'}
        open={!!editing}
        onOk={save}
        confirmLoading={saving}
        onCancel={() => !saving && setEditing(undefined)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="serviceKey" label="Service Key" rules={[{ required: true, whitespace: true }]}>
            <Input disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item
            name="sourceServiceKey"
            label="业务 Service Key"
            extra="业务启动请求使用此标识。留空时与宿主 Service Key 相同。"
          >
            <Input disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item
            name="profileKey"
            label="资源档位"
            extra="填写服务规格配置中已存在的档位，例如 xs、s、m、l。"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item name="maxOnlineUsers" label="单实例人数上限" rules={[{ required: true }]}>
            <InputNumber min={1} max={10000} precision={0} />
          </Form.Item>
          <Form.Item name="userIdleTimeoutSeconds" label="用户心跳超时（秒）" rules={[{ required: true }]}>
            <InputNumber min={60} max={86400} precision={0} />
          </Form.Item>
          <Form.Item name="emptyReleaseDelaySeconds" label="空实例释放延时（秒）" rules={[{ required: true }]}>
            <InputNumber min={0} max={86400} precision={0} />
          </Form.Item>
          <Form.Item name="enabled" label="启用此档位共享分配" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
