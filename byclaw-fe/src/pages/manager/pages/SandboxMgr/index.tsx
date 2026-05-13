import React, { useState, useEffect, useCallback, useRef } from 'react';
import classNames from 'classnames';
import {
  EyeOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SettingOutlined,
  PlusOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { trim } from 'lodash';
import {
  message,
  Table,
  Button,
  Input,
  Space,
  Popconfirm,
  Select,
  Typography,
  Row,
  Col,
  Switch,
  Tag,
  Drawer,
  Form,
} from 'antd';
import { useIntl, useDispatch } from '@umijs/max';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';

import styles from './index.module.less';

const { Option } = Select;

const formatTimestamp = (value: string | number) => {
  if (!value) return '-';
  const ts = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(ts)) return String(value);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
};

interface SsSandboxRecord {
  id: number;
  resourceId: number;
  userCode: string;
  sandboxType: string;
  endpoint: string;
  chatId: string;
  status: string;
  autoRelease: number;
  lastAccessTime: string;
  createTime: string;
  updateTime: string;
}

interface ServiceSpecItem {
  serviceKey: string;
  specJson: string;
  templateJson?: string;
}

const SandboxMgr = () => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const [pageInfo, setPageInfo] = useState({ pageIndex: 1, pageSize: 20, total: 0, totalPage: 0 });
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('RUNNING');
  const [list, setList] = useState<SsSandboxRecord[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  // 沙箱配置抽屉相关状态
  const [specDrawerOpen, setSpecDrawerOpen] = useState(false);
  const [specList, setSpecList] = useState<ServiceSpecItem[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [specFormVisible, setSpecFormVisible] = useState(false);
  const [editingSpec, setEditingSpec] = useState<ServiceSpecItem | null>(null);
  const [specForm] = Form.useForm();
  const [savingSpec, setSavingSpec] = useState(false);

  const refreshTimer = useRef<NodeJS.Timeout | null>(null);
  const curParam = useRef<{ pageIndex?: number; pageSize?: number; keyword?: string; status?: string }>({});

  const loadData = useCallback(
    (myPageInfo: { pageIndex: number; pageSize: number }, kw?: string, st?: string, silent?: boolean) => {
      const p = {
        pageIndex: myPageInfo.pageIndex,
        pageSize: myPageInfo.pageSize,
        keyword: kw,
        status: st,
      };

      curParam.current = p;
      if (!silent) setManualLoading(true);

      dispatch({
        type: 'sandboxMgr/listSandboxRecords',
        payload: p,
        success: (data: any) => {
          setList(data?.list || []);
          setPageInfo((prev) => ({
            ...prev,
            pageIndex: data?.pageIndex || myPageInfo.pageIndex,
            pageSize: data?.pageSize || myPageInfo.pageSize,
            total: data?.total || 0,
            totalPage: data?.totalPage || 0,
          }));
          if (!silent) setManualLoading(false);
        },
        fail: () => {
          if (!silent) setManualLoading(false);
        },
      });
    },
    [dispatch]
  );

  // Auto refresh (silent)
  useEffect(() => {
    if (autoRefresh) {
      refreshTimer.current = setInterval(() => {
        loadData(
          {
            pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
            pageSize: curParam.current?.pageSize || pageInfo.pageSize,
          },
          curParam.current?.keyword || keyword,
          curParam.current?.status || status,
          true
        );
      }, 10000);
    } else if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }

    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
      }
    };
  }, [autoRefresh, loadData, pageInfo, keyword, status]);

  // Initial load
  useEffect(() => {
    loadData(pageInfo, keyword, status);
  }, []);

  const handleSearch = useCallback(() => {
    loadData({ ...pageInfo, pageIndex: 1 }, keyword, status);
  }, [loadData, pageInfo, keyword, status]);

  const handleStatusChange = useCallback(
    (value: string) => {
      setStatus(value);
      loadData({ ...pageInfo, pageIndex: 1 }, keyword, value);
    },
    [loadData, pageInfo, keyword]
  );

  const handlePaginationChange = useCallback(
    (pageIndex: number, pageSize: number) => {
      setPageInfo((prev) => ({ ...prev, pageIndex, pageSize }));
      loadData({ ...pageInfo, pageIndex, pageSize }, keyword, status);
    },
    [loadData, pageInfo, keyword, status]
  );

  const handleDelete = useCallback(
    (record: SsSandboxRecord) => {
      setRemovingId(record.id);
      dispatch({
        type: 'sandboxMgr/removeSandboxById',
        payload: { id: record.id },
        success: () => {
          message.success(intl.formatMessage({ id: 'sandboxMgr.delete.success' }));
          setRemovingId(null);
          loadData(
            {
              pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
              pageSize: curParam.current?.pageSize || pageInfo.pageSize,
            },
            curParam.current?.keyword || keyword,
            curParam.current?.status || status
          );
        },
        fail: () => {
          setRemovingId(null);
        },
      });
    },
    [dispatch, intl, loadData, pageInfo, keyword, status]
  );

  const handleView = useCallback((endpoint: string) => {
    window.open(endpoint, '_blank');
  }, []);

  const handleAutoReleaseChange = useCallback(
    (record: SsSandboxRecord, checked: boolean) => {
      setUpdatingId(record.id);
      dispatch({
        type: 'sandboxMgr/updateSandbox',
        payload: { id: record.id, autoRelease: checked ? 1 : 0 },
        success: () => {
          message.success(intl.formatMessage({ id: 'sandboxMgr.update.success' }));
          setUpdatingId(null);
          setList((prev) =>
            prev.map((item) => (item.id === record.id ? { ...item, autoRelease: checked ? 1 : 0 } : item))
          );
        },
        fail: () => {
          setUpdatingId(null);
        },
      });
    },
    [dispatch, intl]
  );

  // ==================== 沙箱配置管理相关方法 ====================

  const loadSpecList = useCallback(() => {
    setSpecLoading(true);
    dispatch({
      type: 'sandboxMgr/listServiceSpec',
      payload: {},
      success: (data: ServiceSpecItem[]) => {
        setSpecList(data || []);
        setSpecLoading(false);
      },
      fail: () => {
        setSpecLoading(false);
      },
    });
  }, [dispatch]);

  const handleOpenSpecDrawer = useCallback(() => {
    setSpecDrawerOpen(true);
    loadSpecList();
  }, [loadSpecList]);

  const handleCloseSpecDrawer = useCallback(() => {
    setSpecDrawerOpen(false);
    setSpecFormVisible(false);
    setEditingSpec(null);
    specForm.resetFields();
  }, [specForm]);

  const handleAddSpec = useCallback(() => {
    setEditingSpec(null);
    specForm.resetFields();
    setSpecFormVisible(true);
  }, [specForm]);

  const handleEditSpec = useCallback(
    (record: ServiceSpecItem) => {
      setEditingSpec(record);
      specForm.setFieldsValue({
        serviceKey: record.serviceKey,
        specJson: record.specJson,
        templateJson: record.templateJson || '',
      });
      setSpecFormVisible(true);
    },
    [specForm]
  );

  const handleDeleteSpec = useCallback(
    (record: ServiceSpecItem) => {
      dispatch({
        type: 'sandboxMgr/deleteServiceSpec',
        payload: { serviceKey: record.serviceKey },
        success: () => {
          loadSpecList();
        },
      });
    },
    [dispatch, loadSpecList]
  );

  const handleSaveSpec = useCallback(() => {
    specForm.validateFields().then((values) => {
      setSavingSpec(true);
      dispatch({
        type: 'sandboxMgr/saveServiceSpec',
        payload: {
          serviceKey: values.serviceKey,
          specJson: values.specJson,
          templateJson: values.templateJson,
        },
        success: () => {
          setSavingSpec(false);
          setSpecFormVisible(false);
          specForm.resetFields();
          loadSpecList();
        },
        fail: () => {
          setSavingSpec(false);
        },
      });
    });
  }, [dispatch, specForm, loadSpecList]);

  const handleCancelSpecForm = useCallback(() => {
    setSpecFormVisible(false);
    setEditingSpec(null);
    specForm.resetFields();
  }, [specForm]);

  const columns = [
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.userCode' }),
      dataIndex: 'userCode',
      align: 'center' as const,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.sandboxType' }),
      dataIndex: 'sandboxType',
      align: 'center' as const,
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.endpoint' }),
      dataIndex: 'endpoint',
      align: 'center' as const,
      ellipsis: true,
      render: (value: string, record: SsSandboxRecord) => {
        if (record.status === 'RUNNING' && value) {
          return <Typography.Link onClick={() => handleView(value)}>{value}</Typography.Link>;
        }
        return <Typography.Text disabled>{value || '-'}</Typography.Text>;
      },
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.status' }),
      dataIndex: 'status',
      align: 'center' as const,
      render: (value: string) => {
        if (value === 'RUNNING') {
          return <Tag color="green">{intl.formatMessage({ id: 'sandboxMgr.status.running' })}</Tag>;
        }
        if (value === 'RELEASED') {
          return <Tag color="default">{intl.formatMessage({ id: 'sandboxMgr.status.released' })}</Tag>;
        }
        return <Tag>{value}</Tag>;
      },
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.autoRelease' }),
      dataIndex: 'autoRelease',
      align: 'center' as const,
      render: (value: number, record: SsSandboxRecord) => (
        <Switch
          checked={value === 1}
          disabled={record.status !== 'RUNNING' || updatingId === record.id}
          loading={updatingId === record.id}
          size="small"
          onChange={(checked) => handleAutoReleaseChange(record, checked)}
        />
      ),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.lastAccessTime' }),
      dataIndex: 'lastAccessTime',
      align: 'center' as const,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.createTime' }),
      dataIndex: 'createTime',
      align: 'center' as const,
      render: (value: string | number) => formatTimestamp(value),
    },
    {
      title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
      dataIndex: 'action',
      align: 'center' as const,
      fixed: 'right' as const,
      width: 160,
      render: (_: any, record: SsSandboxRecord) => {
        if (record.status !== 'RUNNING') return null;

        return (
          <Space size="small">
            <Button
              size="small"
              type="link"
              icon={<EyeOutlined />}
              onClick={() => handleView(record.endpoint)}
              disabled={!record.endpoint}
            >
              {intl.formatMessage({ id: 'sandboxMgr.action.view' })}
            </Button>
            <Popconfirm
              title={intl.formatMessage({ id: 'sandboxMgr.delete.confirm' })}
              onConfirm={() => handleDelete(record)}
              disabled={removingId === record.id}
            >
              <Button
                size="small"
                type="link"
                danger
                icon={<DeleteOutlined />}
                loading={removingId === record.id}
                disabled={removingId !== null}
              >
                {intl.formatMessage({ id: 'sandboxMgr.action.delete' })}
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className={classNames('full-height ub ub-ver gap8', styles.container)}>
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <Space size="middle">
            <Input.Search
              placeholder={intl.formatMessage({ id: 'sandboxMgr.search.placeholder' })}
              value={keyword}
              onChange={(e) => setKeyword(trim(e.target.value))}
              onSearch={handleSearch}
              onPressEnter={handleSearch}
              style={{ width: 300 }}
              allowClear
            />
            <Select value={status} onChange={handleStatusChange} style={{ width: 150 }}>
              <Option value="">{intl.formatMessage({ id: 'sandboxMgr.status.all' })}</Option>
              <Option value="RUNNING">{intl.formatMessage({ id: 'sandboxMgr.status.running' })}</Option>
              <Option value="RELEASED">{intl.formatMessage({ id: 'sandboxMgr.status.released' })}</Option>
            </Select>
          </Space>
        </Col>
        <Col>
          <Space size="middle">
            <Button icon={<SettingOutlined />} onClick={handleOpenSpecDrawer}>
              {intl.formatMessage({ id: 'sandboxMgr.config.button' })}
            </Button>
            <span>{intl.formatMessage({ id: 'sandboxMgr.autoRefresh' })}:</span>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => {
                loadData(
                  {
                    pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
                    pageSize: curParam.current?.pageSize || pageInfo.pageSize,
                  },
                  curParam.current?.keyword || keyword,
                  curParam.current?.status || status
                );
              }}
            >
              {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
            </Button>
          </Space>
        </Col>
      </Row>
      <div className={classNames('ub-f1', styles.tableScroll)}>
        <Table<SsSandboxRecord>
          rowKey="id"
          columns={columns}
          dataSource={list}
          pagination={{
            ...pageInfo,
            current: pageInfo.pageIndex,
            showTotal: (total: number) => intl.formatMessage({ id: 'sandboxMgr.pagination.total' }, { total }),
            onChange: handlePaginationChange,
          }}
          scroll={{ x: 1200, y: 'calc(100vh - 230px)' }}
          loading={manualLoading}
          className={styles.table}
        />
      </div>

      {/* 沙箱配置抽屉 */}
      <Drawer
        title={intl.formatMessage({ id: 'sandboxMgr.config.title' })}
        open={specDrawerOpen}
        onClose={handleCloseSpecDrawer}
        width={800}
        destroyOnClose
      >
        <div className={styles.specDrawerContent}>
          <Row justify="end" style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddSpec}>
              {intl.formatMessage({ id: 'sandboxMgr.config.add' })}
            </Button>
          </Row>
          <Table<ServiceSpecItem>
            rowKey="serviceKey"
            dataSource={specList}
            loading={specLoading}
            pagination={false}
            columns={[
              {
                title: intl.formatMessage({ id: 'sandboxMgr.config.serviceKey' }),
                dataIndex: 'serviceKey',
                width: 200,
                ellipsis: true,
              },
              {
                title: intl.formatMessage({ id: 'sandboxMgr.config.specJson' }),
                dataIndex: 'specJson',
                ellipsis: true,
                render: (value: string) => (
                  <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                    {value}
                  </Typography.Paragraph>
                ),
              },
              {
                title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
                width: 150,
                align: 'center',
                render: (_: any, record: ServiceSpecItem) => (
                  <Space size="small">
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEditSpec(record)}>
                      {intl.formatMessage({ id: 'SystemParams.params.edit' })}
                    </Button>
                    <Popconfirm
                      title={intl.formatMessage({ id: 'sandboxMgr.config.deleteConfirm' })}
                      onConfirm={() => handleDeleteSpec(record)}
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                        {intl.formatMessage({ id: 'SystemParams.params.delete' })}
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Drawer>

      {/* 沙箱配置表单弹窗 */}
      <ModalDrawer
        title={intl.formatMessage({
          id: editingSpec ? 'sandboxMgr.config.edit' : 'sandboxMgr.config.addTitle',
        })}
        open={specFormVisible}
        onCancel={handleCancelSpecForm}
        onOk={handleSaveSpec}
        confirmLoading={savingSpec}
        width={720}
      >
        <Form form={specForm} layout="vertical" preserve={false}>
          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.config.serviceKey' })}
            name="serviceKey"
            rules={[{ required: true, message: intl.formatMessage({ id: 'sandboxMgr.config.serviceKeyRequired' }) }]}
          >
            <Input
              disabled={!!editingSpec}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.config.serviceKeyPlaceholder' })}
            />
          </Form.Item>

          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.config.specJson' })}
            name="specJson"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'sandboxMgr.config.specJsonRequired' }) },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch (e) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              rows={12}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.config.specJsonPlaceholder' })}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>

          <Form.Item
            label={intl.formatMessage({ id: 'sandboxMgr.config.templateJson' })}
            name="templateJson"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch (e) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'sandboxMgr.config.invalidJson' })));
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              rows={8}
              placeholder={intl.formatMessage({ id: 'sandboxMgr.config.templateJsonPlaceholder' })}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
        </Form>
      </ModalDrawer>
    </div>
  );
};

export default SandboxMgr;
