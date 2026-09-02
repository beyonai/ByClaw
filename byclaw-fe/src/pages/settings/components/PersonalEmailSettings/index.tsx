import React, { useEffect, useMemo, useState } from 'react';

import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
// @ts-ignore
import { useIntl } from '@umijs/max';

import {
  deletePersonalEmailAccount,
  PersonalEmailAccount,
  queryPersonalEmailAccounts,
  savePersonalEmailAccount,
  setDefaultPersonalEmailAccount,
} from '@/service/personalEmail';
import styles from './index.module.less';

const { Text } = Typography;

const EMAIL_TEMPLATES = [
  {
    label: 'QQ邮箱',
    value: 'qq',
    name: 'QQ邮箱',
    imap: { host: 'imap.qq.com', port: 993, encryption: 'tls' },
    smtp: { host: 'smtp.qq.com', port: 465, encryption: 'tls' },
  },
  {
    label: 'Gmail',
    value: 'gmail',
    name: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, encryption: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 587, encryption: 'starttls' },
  },
];

const encryptionOptions = [
  { label: 'TLS', value: 'tls' },
  { label: 'STARTTLS', value: 'starttls' },
  { label: 'SSL', value: 'ssl' },
  { label: 'None', value: 'none' },
];

const PersonalEmailSettings: React.FC = () => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<PersonalEmailAccount[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PersonalEmailAccount | null>(null);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const res = await queryPersonalEmailAccounts();
      setAccounts(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!modalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  const openCreateModal = () => {
    setEditingAccount(null);
    form.resetFields();
    form.setFieldsValue({
      default: accounts.length === 0,
      imap: { encryption: 'tls' },
      smtp: { encryption: 'tls' },
    });
    setModalOpen(true);
  };

  const openEditModal = (record: PersonalEmailAccount) => {
    setEditingAccount(record);
    form.setFieldsValue({
      ...record,
      displayName: record.displayName || record.display_name,
      authCode: undefined,
    });
    setModalOpen(true);
  };

  const handleTemplateChange = (value: string) => {
    const template = EMAIL_TEMPLATES.find((item) => item.value === value);
    if (!template) return;
    form.setFieldsValue({
      name: form.getFieldValue('name') || template.name,
      imap: template.imap,
      smtp: template.smtp,
    });
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await savePersonalEmailAccount({
        ...values,
        accountId: editingAccount?.accountId,
      });
      message.success(intl.formatMessage({ id: 'settings.email.saveSuccess' }));
      setModalOpen(false);
      await loadAccounts();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: PersonalEmailAccount) => {
    if (!record.accountId) return;
    await deletePersonalEmailAccount(record.accountId);
    message.success(intl.formatMessage({ id: 'settings.email.deleteSuccess' }));
    await loadAccounts();
  };

  const handleSetDefault = async (record: PersonalEmailAccount) => {
    if (!record.accountId) return;
    await setDefaultPersonalEmailAccount(record.accountId);
    message.success(intl.formatMessage({ id: 'settings.email.defaultSuccess' }));
    await loadAccounts();
  };

  const columns: ColumnsType<PersonalEmailAccount> = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'settings.email.address' }),
        dataIndex: 'email',
        width: 240,
        render: (email) => <Text strong>{email || '-'}</Text>,
      },
      {
        title: intl.formatMessage({ id: 'settings.email.account' }),
        dataIndex: 'name',
        width: 180,
        render: (_, record) => (
          <div className={styles.accountCell}>
            <Space>
              <Text strong>{record.name}</Text>
              {record.default && <Tag color="blue">{intl.formatMessage({ id: 'settings.email.default' })}</Tag>}
            </Space>
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'settings.email.displayName' }),
        dataIndex: 'displayName',
        width: 140,
        render: (_, record) => record.displayName || record.display_name || '-',
      },
      {
        title: 'IMAP',
        dataIndex: 'imap',
        width: 240,
        render: (imap) => `${imap?.host || '-'}:${imap?.port || '-'} / ${imap?.encryption || '-'}`,
      },
      {
        title: 'SMTP',
        dataIndex: 'smtp',
        width: 240,
        render: (smtp) => `${smtp?.host || '-'}:${smtp?.port || '-'} / ${smtp?.encryption || '-'}`,
      },
      {
        title: intl.formatMessage({ id: 'settings.email.authCode' }),
        dataIndex: 'hasAuthCode',
        width: 120,
        render: (_, record) =>
          record.hasAuthCode ? (
            <Tag color="green">
              {intl.formatMessage({ id: 'settings.email.configured' })}
              {record.authCodeLast4 ? ` ****${record.authCodeLast4}` : ''}
            </Tag>
          ) : (
            <Tag>{intl.formatMessage({ id: 'settings.email.notConfigured' })}</Tag>
          ),
      },
      {
        title: intl.formatMessage({ id: 'settings.email.updateTime' }),
        dataIndex: 'updateTime',
        width: 120,
        render: (value) => (value ? dayjs(value).format('YYYY-MM-DD') : '-'),
      },
      {
        title: intl.formatMessage({ id: 'common.operation' }),
        key: 'action',
        width: 190,
        fixed: 'right',
        render: (_, record) => (
          <Space>
            {!record.default && (
              <Button type="link" size="small" onClick={() => handleSetDefault(record)}>
                {intl.formatMessage({ id: 'settings.email.setDefault' })}
              </Button>
            )}
            <Button type="link" size="small" onClick={() => openEditModal(record)}>
              {intl.formatMessage({ id: 'common.edit' })}
            </Button>
            <Popconfirm
              title={intl.formatMessage({ id: 'settings.email.confirmDelete' })}
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" size="small" danger>
                {intl.formatMessage({ id: 'common.delete' })}
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [intl]
  );

  return (
    <div className={styles.emailSettings}>
      <div className={styles.header}>
        <div>
          <p>{intl.formatMessage({ id: 'settings.email.description' })}</p>
        </div>
        <Button type="primary" onClick={openCreateModal}>
          {intl.formatMessage({ id: 'settings.email.addAccount' })}
        </Button>
      </div>

      <Card className={styles.tableCard}>
        <Table
          rowKey="accountId"
          loading={loading}
          columns={columns}
          dataSource={accounts}
          pagination={false}
          scroll={{ x: 1470 }}
          locale={{ emptyText: <Empty description={intl.formatMessage({ id: 'settings.email.empty' })} /> }}
        />
      </Card>

      <Modal
        title={
          editingAccount
            ? intl.formatMessage({ id: 'settings.email.editAccount' })
            : intl.formatMessage({ id: 'settings.email.addAccount' })
        }
        open={modalOpen}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={720}
        className={styles.emailModal}
        wrapClassName={styles.emailModalWrap}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label={intl.formatMessage({ id: 'settings.email.quickTemplate' })}>
            <Select
              allowClear
              options={EMAIL_TEMPLATES}
              onChange={handleTemplateChange}
              placeholder={intl.formatMessage({ id: 'settings.email.quickTemplatePlaceholder' })}
            />
          </Form.Item>
          <div className={styles.formGrid}>
            <Form.Item
              label={intl.formatMessage({ id: 'settings.email.accountName' })}
              name="name"
              rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.accountNameRequired' }) }]}
            >
              <Input placeholder="QQ邮箱" />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'settings.email.address' })}
              name="email"
              rules={[
                { required: true, message: intl.formatMessage({ id: 'settings.email.addressRequired' }) },
                { type: 'email', message: intl.formatMessage({ id: 'settings.email.addressInvalid' }) },
              ]}
            >
              <Input placeholder="name@example.com" />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'settings.email.displayName' })} name="displayName">
              <Input placeholder="Sangjie" />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'settings.email.default' })}
              name="default"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </div>

          <div className={styles.serverSection}>
            <h3>IMAP</h3>
            <div className={styles.serverGrid}>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.host' })}
                name={['imap', 'host']}
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.hostRequired' }) }]}
              >
                <Input placeholder="imap.qq.com" />
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.port' })}
                name={['imap', 'port']}
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.portRequired' }) }]}
              >
                <InputNumber min={1} max={65535} />
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.encryption' })}
                name={['imap', 'encryption']}
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.encryptionRequired' }) }]}
              >
                <Select options={encryptionOptions} />
              </Form.Item>
            </div>
          </div>

          <div className={styles.serverSection}>
            <h3>SMTP</h3>
            <div className={styles.serverGrid}>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.host' })}
                name={['smtp', 'host']}
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.hostRequired' }) }]}
              >
                <Input placeholder="smtp.qq.com" />
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.port' })}
                name={['smtp', 'port']}
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.portRequired' }) }]}
              >
                <InputNumber min={1} max={65535} />
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: 'settings.email.encryption' })}
                name={['smtp', 'encryption']}
                rules={[{ required: true, message: intl.formatMessage({ id: 'settings.email.encryptionRequired' }) }]}
              >
                <Select options={encryptionOptions} />
              </Form.Item>
            </div>
          </div>

          <Form.Item
            label={intl.formatMessage({ id: 'settings.email.authCode' })}
            name="authCode"
            extra={
              editingAccount?.hasAuthCode
                ? intl.formatMessage({ id: 'settings.email.authCodeKeepTip' })
                : intl.formatMessage({ id: 'settings.email.authCodeTip' })
            }
            rules={[
              {
                required: !editingAccount?.hasAuthCode,
                message: intl.formatMessage({ id: 'settings.email.authCodeRequired' }),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PersonalEmailSettings;
