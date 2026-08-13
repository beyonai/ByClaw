import { DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, message, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';

import {
  createUserMcpService,
  deleteUserMcpService,
  queryUserMcpServices,
  startConnectorAuthorization,
  updateUserMcpService,
  updateUserMcpServiceEnabled,
  type McpCredentialInput,
  type UserMcpService,
  type UserMcpServicePayload,
  validateUserMcpService,
} from '@/service/connector';

import styles from './index.module.less';

interface UserMcpManagerProps {
  active: boolean;
  connectorId: number;
}

interface FormValues {
  resourceCode: string;
  resourceName: string;
  resourceDesc?: string;
  domainUrl: string;
  transport: 'streamable-http';
  serverPath: string;
  authMode: 'NONE' | 'STATIC_HEADER';
  credentialType?: McpCredentialInput['type'];
  credentialValue?: string;
}

interface McpConfig {
  domainURL: string;
  metaContent?: {
    mcpType?: string;
    mcpServerUrl?: string;
    authProfile?: { mode?: string; credentialType?: string };
  };
}

const parseConfig = (sourceContent: string): McpConfig => JSON.parse(sourceContent);

const connectionIdentity = (values: FormValues) =>
  JSON.stringify({
    domainUrl: values.domainUrl.trim(),
    transport: values.transport,
    serverPath: values.serverPath.trim(),
    authMode: values.authMode,
    credentialType: values.authMode === 'STATIC_HEADER' ? values.credentialType : undefined,
  });

const valuesFromService = (item: UserMcpService): FormValues => {
  const config = parseConfig(item.sourceContent);
  return {
    resourceCode: item.resourceCode,
    resourceName: item.resourceName,
    resourceDesc: item.resourceDesc,
    domainUrl: config.domainURL,
    transport: 'streamable-http',
    serverPath: config.metaContent?.mcpServerUrl || '/mcp',
    authMode: config.metaContent?.authProfile?.mode === 'STATIC_HEADER' ? 'STATIC_HEADER' : 'NONE',
    credentialType: config.metaContent?.authProfile?.credentialType as McpCredentialInput['type'] | undefined,
  };
};

const toPayload = (values: FormValues): UserMcpServicePayload => ({
  resourceCode: values.resourceCode.trim(),
  resourceName: values.resourceName.trim(),
  resourceDesc: values.resourceDesc?.trim(),
  sourceContent: JSON.stringify({
    domainURL: values.domainUrl.trim(),
    metaContent: {
      mcpType: values.transport,
      mcpServerUrl: values.serverPath.trim(),
      authProfile: {
        mode: values.authMode,
        ...(values.authMode === 'STATIC_HEADER' ? { credentialType: values.credentialType } : {}),
      },
    },
    timeoutSeconds: 20,
  }),
  ...(values.authMode === 'STATIC_HEADER' && values.credentialType && values.credentialValue
    ? { credentialInput: { type: values.credentialType, value: values.credentialValue } }
    : {}),
});

const confirmIdentityChange = () =>
  new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '连接信息已变化',
      content: '保存后该 MCP 服务会自动停用，需要重新连接后才能继续使用。是否保存？',
      okText: '保存并停用',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

const requestCredential = (credentialType: McpCredentialInput['type']) =>
  new Promise<McpCredentialInput | undefined>((resolve) => {
    let value = '';
    Modal.confirm({
      title: '输入连接凭证',
      content: <Input.Password autoComplete="new-password" onChange={(event) => (value = event.target.value)} />,
      onOk: () => resolve(value ? { type: credentialType, value } : undefined),
      onCancel: () => resolve(undefined),
    });
  });

const UserMcpManager: React.FC<UserMcpManagerProps> = ({ active, connectorId }) => {
  const [form] = Form.useForm<FormValues>();
  const authMode = Form.useWatch('authMode', form);
  const [items, setItems] = useState<UserMcpService[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserMcpService>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await queryUserMcpServices()) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const openCreate = () => {
    setEditing(undefined);
    form.resetFields();
    form.setFieldsValue({ transport: 'streamable-http', authMode: 'NONE', serverPath: '/mcp' });
    setOpen(true);
  };

  const openEdit = (item: UserMcpService) => {
    setEditing(item);
    form.setFieldsValue(valuesFromService(item));
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const identityChanged = editing
      ? connectionIdentity(valuesFromService(editing)) !== connectionIdentity(values)
      : true;
    if (values.authMode === 'STATIC_HEADER' && identityChanged && !values.credentialValue) {
      form.setFields([{ name: 'credentialValue', errors: ['创建或修改连接信息时必须输入凭证'] }]);
      return;
    }
    if (editing?.enableFlag === 'Y' && identityChanged && !(await confirmIdentityChange())) return;

    const data = toPayload(values);
    setSaving(true);
    try {
      if (!editing || identityChanged) await validateUserMcpService(data);
      if (editing) {
        await updateUserMcpService(editing.resourceId, data);
      } else {
        await createUserMcpService(data);
      }
      message.success(
        editing ? (identityChanged ? 'MCP 服务已更新并停用，请重新连接' : 'MCP 服务信息已更新') : 'MCP 服务已创建'
      );
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const connect = async (item: UserMcpService) => {
    try {
      const config = parseConfig(item.sourceContent);
      let credentialInput: McpCredentialInput | undefined;
      if (config.metaContent?.authProfile?.mode === 'STATIC_HEADER') {
        credentialInput = await requestCredential(
          config.metaContent.authProfile.credentialType as McpCredentialInput['type']
        );
        if (!credentialInput) return;
      }
      const result = await startConnectorAuthorization({ connectorId, resourceId: item.resourceId, credentialInput });
      if (result.status !== 'connected') throw new Error(result.errorMessage || 'MCP 连接失败');
      message.success('MCP 已连接并启用');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'MCP 连接失败');
    }
  };

  const setEnabled = async (item: UserMcpService, enabled: boolean) => {
    try {
      await updateUserMcpServiceEnabled(item.resourceId, enabled);
      message.success(enabled ? 'MCP 已启用' : 'MCP 已停用');
      await load();
    } catch {
      message.error(enabled ? '当前定义无法直接启用，请重新连接' : 'MCP 停用失败');
    }
  };

  const columns = [
    {
      title: '服务',
      dataIndex: 'resourceName',
      render: (_: string, item: UserMcpService) => (
        <span className={styles.serviceName}>
          <strong>{item.resourceName}</strong>
          <small>{item.resourceCode}</small>
        </span>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_: unknown, item: UserMcpService) =>
        item.connected ? (
          <Tag color="success">已连接</Tag>
        ) : item.enableFlag === 'N' ? (
          <Tag>已停用</Tag>
        ) : (
          <Tag>未连接</Tag>
        ),
    },
    {
      title: '版本',
      dataIndex: 'definitionRevision',
      width: 76,
      render: (value: number) => <Tag>v{value}</Tag>,
    },
    {
      title: '操作',
      width: 285,
      render: (_: unknown, item: UserMcpService) => (
        <Space size={4}>
          {item.enableFlag === 'Y' || item.enableFlag === 'N' ? (
            <Switch
              checked={item.enableFlag === 'Y'}
              aria-label={`${item.enableFlag === 'Y' ? '停用' : '启用'}${item.resourceName}`}
              onChange={(checked) => void setEnabled(item, checked)}
            />
          ) : null}
          {!item.connected && (
            <Button type="link" icon={<LinkOutlined />} onClick={() => void connect(item)}>
              {item.credentialState === 'REAUTH_REQUIRED' ? '重新连接' : '连接'}
            </Button>
          )}
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(item)}>
            编辑
          </Button>
          <Popconfirm
            title="删除后连接会立即失效，确认删除？"
            onConfirm={async () => {
              await deleteUserMcpService(item.resourceId);
              await load();
            }}
          >
            <Button type="link" danger aria-label={`删除${item.resourceName}`} icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <section className={styles.manager} aria-label="自定义 MCP 服务管理">
      <div className={styles.header}>
        <div>
          <strong>自定义 MCP 服务</strong>
          <p>可创建多个独立服务；当前支持管理员允许的公网 IP、HTTPS 443 和 Streamable HTTP。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加服务
        </Button>
      </div>
      <Table
        rowKey="resourceId"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="small"
      />
      <Modal
        title={editing ? '编辑 MCP 服务' : '添加 MCP 服务'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        destroyOnHidden
        width={680}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space.Compact block>
            <Form.Item name="resourceName" label="名称" rules={[{ required: true }]} className={styles.halfField}>
              <Input maxLength={300} />
            </Form.Item>
            <Form.Item name="resourceCode" label="编码" rules={[{ required: true }]} className={styles.halfField}>
              <Input maxLength={255} disabled={Boolean(editing)} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="resourceDesc" label="说明">
            <Input.TextArea maxLength={4000} rows={2} />
          </Form.Item>
          <Form.Item name="domainUrl" label="HTTPS 公网 IP" rules={[{ required: true, type: 'url' }]}>
            <Input placeholder="https://8.8.8.8（需管理员加入允许列表）" />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="transport" label="传输协议" rules={[{ required: true }]} className={styles.halfField}>
              <Select options={[{ value: 'streamable-http' }]} />
            </Form.Item>
            <Form.Item name="serverPath" label="服务路径" rules={[{ required: true }]} className={styles.halfField}>
              <Input placeholder="/mcp" />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="authMode" label="认证方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'NONE', label: '无需认证' },
                { value: 'STATIC_HEADER', label: '静态 Header' },
              ]}
            />
          </Form.Item>
          {authMode === 'STATIC_HEADER' && (
            <Space.Compact block>
              <Form.Item
                name="credentialType"
                label="凭证类型"
                rules={[{ required: true }]}
                className={styles.halfField}
              >
                <Select options={['BEARER_TOKEN', 'API_KEY', 'COOKIE'].map((value) => ({ value }))} />
              </Form.Item>
              <Form.Item
                name="credentialValue"
                label={editing ? '连接信息不变时可留空' : '仅用于本次预检'}
                className={styles.halfField}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </Space.Compact>
          )}
        </Form>
      </Modal>
    </section>
  );
};

export default UserMcpManager;
