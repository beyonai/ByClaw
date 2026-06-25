import React, { useEffect, useState } from 'react';

import {
  Button,
  Card,
  Empty,
  Form,
  Input,
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
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import dayjs from 'dayjs';
// @ts-ignore
import { useIntl } from '@umijs/max';

import {
  deletePersonalParam,
  enablePersonalParam,
  queryPersonalParams,
  savePersonalParam,
} from '@/service/personalParam';
import type { PersonalParam } from '@/service/personalParam';
import type { PersonalParamQuery } from '@/service/personalParam';
import styles from './index.module.less';

const { Text } = Typography;

const KEY_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;
const DEFAULT_PAGE_SIZE = 10;

const PersonalParamSettings: React.FC = () => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useState<PersonalParam[]>([]);
  const [total, setTotal] = useState(0);
  const [keywordInput, setKeywordInput] = useState('');
  const [queryState, setQueryState] = useState<PersonalParamQuery>({
    pageNum: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    updateTimeSort: 'descend',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingParam, setEditingParam] = useState<PersonalParam | null>(null);

  const loadParams = async (nextQuery: Partial<PersonalParamQuery> = {}) => {
    const query = {
      ...queryState,
      ...nextQuery,
    };
    setLoading(true);
    try {
      const res = await queryPersonalParams(query);
      setParams(Array.isArray(res?.list) ? res.list : []);
      setTotal(Number(res?.total || 0));
      setQueryState({
        ...query,
        pageNum: Number(res?.pageNum || query.pageNum || 1),
        pageSize: Number(res?.pageSize || query.pageSize || DEFAULT_PAGE_SIZE),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadParams();
  }, []);

  const openCreateModal = () => {
    setEditingParam(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true });
    setModalOpen(true);
  };

  const openEditModal = (record: PersonalParam) => {
    setEditingParam(record);
    form.setFieldsValue({
      key: record.key,
      value: undefined,
      description: record.description,
      enabled: record.enabled ?? record.status === 'NORMAL',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await savePersonalParam({
        ...values,
        paramId: editingParam?.paramId,
      });
      message.success(intl.formatMessage({ id: 'settings.params.saveSuccess' }));
      setModalOpen(false);
      await loadParams({ pageNum: editingParam ? queryState.pageNum : 1 });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: PersonalParam) => {
    if (!record.paramId) return;
    await deletePersonalParam(record.paramId);
    message.success(intl.formatMessage({ id: 'settings.params.deleteSuccess' }));
    const currentPageNum = queryState.pageNum || 1;
    await loadParams({ pageNum: params.length <= 1 && currentPageNum > 1 ? currentPageNum - 1 : currentPageNum });
  };

  const handleEnable = async (record: PersonalParam, enabled: boolean) => {
    if (!record.paramId) return;
    await enablePersonalParam(record.paramId, enabled);
    message.success(
      intl.formatMessage({ id: enabled ? 'settings.params.enableSuccess' : 'settings.params.disableSuccess' })
    );
    await loadParams();
  };

  const handleSearch = (value: string) => {
    const keyword = value.trim();
    setKeywordInput(keyword);
    loadParams({ keyword, pageNum: 1 });
  };

  const handleKeywordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setKeywordInput(value);
    if (!value) {
      loadParams({ keyword: undefined, pageNum: 1 });
    }
  };

  const handleStatusChange = (status?: string) => {
    loadParams({ status, pageNum: 1 });
  };

  const handleTableChange = (
    pagination: TablePaginationConfig,
    _filters: Record<string, React.Key[] | null>,
    sorter: SorterResult<PersonalParam> | SorterResult<PersonalParam>[]
  ) => {
    const sorterInfo = Array.isArray(sorter) ? sorter[0] : sorter;
    loadParams({
      pageNum: pagination.current || 1,
      pageSize: pagination.pageSize || queryState.pageSize || DEFAULT_PAGE_SIZE,
      updateTimeSort: sorterInfo?.order === 'ascend' ? 'ascend' : 'descend',
    });
  };

  const renderValueExtra = () => {
    if (!editingParam?.hasValue) {
      return intl.formatMessage({ id: 'settings.params.valueTip' });
    }
    return (
      <div className={styles.valueExtra}>
        <div>
          <Tag color="green">{intl.formatMessage({ id: 'settings.params.configured' })}</Tag>
          <Text type="secondary">
            {intl.formatMessage(
              { id: 'settings.params.valueMaskedTip' },
              {
                value: editingParam.valueLast4
                  ? `****${editingParam.valueLast4}`
                  : intl.formatMessage({ id: 'settings.params.valueHidden' }),
              }
            )}
          </Text>
        </div>
        <Text type="secondary">{intl.formatMessage({ id: 'settings.params.valueKeepTip' })}</Text>
      </div>
    );
  };

  const columns: ColumnsType<PersonalParam> = [
    {
      title: intl.formatMessage({ id: 'settings.params.key' }),
      dataIndex: 'key',
      width: 220,
      render: (key) => (
        <Text strong ellipsis className={styles.keyCell}>
          {key || '-'}
        </Text>
      ),
    },
    {
      title: intl.formatMessage({ id: 'settings.params.description' }),
      dataIndex: 'description',
      render: (description) => description || '-',
    },
    {
      title: intl.formatMessage({ id: 'settings.params.status' }),
      dataIndex: 'status',
      width: 120,
      render: (_, record) =>
        record.enabled ?? record.status === 'NORMAL' ? (
          <Tag color="green">{intl.formatMessage({ id: 'settings.params.enabled' })}</Tag>
        ) : (
          <Tag>{intl.formatMessage({ id: 'settings.params.disabled' })}</Tag>
        ),
    },
    {
      title: intl.formatMessage({ id: 'settings.params.valueStatus' }),
      dataIndex: 'hasValue',
      width: 150,
      render: (_, record) =>
        record.hasValue ? (
          <Tag color="green">
            {intl.formatMessage({ id: 'settings.params.configured' })}
            {record.valueLast4 ? ` ****${record.valueLast4}` : ''}
          </Tag>
        ) : (
          <Tag>{intl.formatMessage({ id: 'settings.params.notConfigured' })}</Tag>
        ),
    },
    {
      title: intl.formatMessage({ id: 'settings.params.updateTime' }),
      dataIndex: 'updateTime',
      width: 160,
      sorter: true,
      sortOrder: queryState.updateTimeSort,
      render: (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: intl.formatMessage({ id: 'common.operation' }),
      key: 'action',
      width: 210,
      render: (_, record) => {
        const enabled = record.enabled ?? record.status === 'NORMAL';
        return (
          <Space>
            <Button type="link" size="small" onClick={() => handleEnable(record, !enabled)}>
              {intl.formatMessage({ id: enabled ? 'settings.params.disable' : 'settings.params.enable' })}
            </Button>
            <Button type="link" size="small" onClick={() => openEditModal(record)}>
              {intl.formatMessage({ id: 'common.edit' })}
            </Button>
            <Popconfirm
              title={intl.formatMessage({ id: 'settings.params.confirmDelete' })}
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" size="small" danger>
                {intl.formatMessage({ id: 'common.delete' })}
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className={styles.paramSettings}>
      <div className={styles.header}>
        <div>
          <p>{intl.formatMessage({ id: 'settings.params.descriptionText' })}</p>
        </div>
        <Button type="primary" onClick={openCreateModal}>
          {intl.formatMessage({ id: 'settings.params.add' })}
        </Button>
      </div>

      <Card className={styles.tableCard}>
        <div className={styles.toolbar}>
          <Input.Search
            allowClear
            value={keywordInput}
            className={styles.keywordSearch}
            placeholder={intl.formatMessage({ id: 'settings.params.keywordPlaceholder' })}
            onChange={handleKeywordChange}
            onSearch={handleSearch}
          />
          <Select
            allowClear
            value={queryState.status}
            className={styles.statusFilter}
            placeholder={intl.formatMessage({ id: 'settings.params.statusFilter' })}
            onChange={handleStatusChange}
            options={[
              { label: intl.formatMessage({ id: 'settings.params.enabled' }), value: 'NORMAL' },
              { label: intl.formatMessage({ id: 'settings.params.disabled' }), value: 'DISABLED' },
            ]}
          />
        </div>
        <Table
          rowKey="paramId"
          loading={loading}
          columns={columns}
          dataSource={params}
          pagination={{
            current: queryState.pageNum || 1,
            pageSize: queryState.pageSize || DEFAULT_PAGE_SIZE,
            total,
            showSizeChanger: true,
            showTotal: (count) => intl.formatMessage({ id: 'settings.params.paginationTotal' }, { total: count }),
          }}
          onChange={handleTableChange}
          locale={{ emptyText: <Empty description={intl.formatMessage({ id: 'settings.params.empty' })} /> }}
        />
      </Card>

      <Modal
        title={
          editingParam
            ? intl.formatMessage({ id: 'settings.params.edit' })
            : intl.formatMessage({ id: 'settings.params.add' })
        }
        open={modalOpen}
        confirmLoading={saving}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div className={styles.formGrid}>
            <Form.Item
              label={intl.formatMessage({ id: 'settings.params.key' })}
              name="key"
              normalize={(value) => (typeof value === 'string' ? value.trim().toUpperCase() : value)}
              rules={[
                { required: true, message: intl.formatMessage({ id: 'settings.params.keyRequired' }) },
                {
                  pattern: KEY_PATTERN,
                  message: intl.formatMessage({ id: 'settings.params.keyInvalid' }),
                },
              ]}
            >
              <Input disabled={!!editingParam} placeholder="API_TOKEN" maxLength={128} />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'settings.params.enabled' })}
              name="enabled"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </div>

          <Form.Item
            label={intl.formatMessage({ id: 'settings.params.value' })}
            name="value"
            extra={renderValueExtra()}
            rules={[
              {
                required: !editingParam?.hasValue,
                message: intl.formatMessage({ id: 'settings.params.valueRequired' }),
              },
            ]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={
                editingParam?.hasValue ? intl.formatMessage({ id: 'settings.params.valueEditPlaceholder' }) : undefined
              }
            />
          </Form.Item>

          <Form.Item label={intl.formatMessage({ id: 'settings.params.description' })} name="description">
            <Input.TextArea
              rows={3}
              maxLength={512}
              showCount
              placeholder={intl.formatMessage({ id: 'settings.params.descriptionPlaceholder' })}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PersonalParamSettings;
