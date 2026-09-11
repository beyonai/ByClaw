import { useEffect, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
  Button,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Spin,
  Tooltip,
  Tag,
  message,
} from 'antd';
import { DatabaseOutlined, LinkOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import useGlobal from '@/hooks/useGlobal';
import { ResourceTypeMap } from '@/constants/resource';
import {
  availableDataSources,
  changeDataSourceBinding,
  listDataSources,
  querySessionDataSources,
  saveDataSource,
  type DataSource,
  type DataSourceInput,
} from '@/service/projectDataSources';
import styles from './index.module.less';

interface Props {
  projectId?: number;
  sessionId?: string;
  canManage?: boolean;
  refreshKey?: number;
  renderHeader?: (actions: React.ReactNode) => React.ReactNode;
}

const ProjectDataSources = ({ projectId, sessionId, canManage = false, refreshKey = 0, renderHeader }: Props) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const label = (key: string): string => intl.formatMessage({ id: `dataSource.${key}` });
  const [items, setItems] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<DataSource>();
  const [editing, setEditing] = useState<DataSource>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [available, setAvailable] = useState<DataSource[]>([]);
  const [selected, setSelected] = useState<string | number>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<DataSourceInput>();
  const scope = useRef(0);
  const mutationPending = useRef(false);
  const confirmation = useRef<ReturnType<typeof Modal.confirm> | undefined>(undefined);

  useEffect(() => {
    scope.current += 1;
    setPage(1);
    setDetail(undefined);
    setEditorOpen(false);
    setBindingOpen(false);
    setBusy(false);
    mutationPending.current = false;
    return () => {
      scope.current += 1;
      confirmation.current?.destroy();
    };
  }, [projectId, sessionId]);

  useEffect(() => {
    let disposed = false;
    setItems([]);
    setLoading(true);
    const load = async (): Promise<{ items: DataSource[]; total: number }> => {
      if (sessionId) return querySessionDataSources(sessionId, page);
      const rows = projectId ? await listDataSources(projectId) : [];
      return { items: rows, total: rows.length };
    };
    void load()
      .then((result) => {
        if (!disposed) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch(() => {
        if (!disposed) message.error(intl.formatMessage({ id: 'dataSource.loadFailed' }));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [projectId, sessionId, page, revision, refreshKey, intl]);

  const mutate = async (action: () => Promise<unknown>): Promise<void> => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    const currentScope = scope.current;
    setBusy(true);
    try {
      await action();
      if (currentScope !== scope.current) return;
      setEditorOpen(false);
      setBindingOpen(false);
      setDetail(undefined);
      if (editorOpen) form.resetFields();
      setRevision((value) => value + 1);
    } catch {
      if (currentScope === scope.current) message.error(label('saveFailed'));
    } finally {
      if (currentScope === scope.current) {
        setBusy(false);
        mutationPending.current = false;
      }
    }
  };

  const openEditor = (item?: DataSource): void => {
    setEditing(item);
    form.resetFields();
    if (item) {
      form.setFieldsValue({
        datasourceName: item.datasourceName,
        description: item.description,
        datasourceType: item.datasourceType,
        connectionConfig:
          item.datasourceType === 'opengauss'
            ? { ...item.connectionConfig, port: Number(item.connectionConfig.port) }
            : item.connectionConfig,
      });
    } else {
      form.setFieldsValue({ datasourceType: 'opengauss', connectionConfig: { port: 5432, sslMode: 'require' } });
    }
    setEditorOpen(true);
  };
  const openBinding = async (): Promise<void> => {
    if (!projectId) return;
    const currentScope = scope.current;
    setAvailable([]);
    setSelected(undefined);
    setBindingOpen(true);
    setBusy(true);
    try {
      const rows = await availableDataSources(projectId);
      if (currentScope === scope.current) setAvailable(rows);
    } catch {
      if (currentScope === scope.current) message.error(label('loadFailed'));
    } finally {
      if (currentScope === scope.current) setBusy(false);
    }
  };
  const reference = (item: DataSource): void => {
    EventEmitter.emit('queryInput-insert-item', {
      type: ResourceTypeMap.dataSource,
      item: { resourceId: item.datasourceId, resourceName: item.datasourceName },
    });
  };
  const remove = (item: DataSource, action: 'unbind' | 'delete'): void => {
    if (!projectId) return;
    confirmation.current = Modal.confirm({
      title: label(action),
      content: label(action === 'delete' ? 'deleteWarning' : 'unlinkWarning'),
      okButtonProps: { danger: true },
      onOk: () => mutate(() => changeDataSourceBinding(action, projectId, item.datasourceId)),
    });
  };

  const actions = (item: DataSource): NonNullable<import('antd').MenuProps['items']> => {
    const rows: NonNullable<import('antd').MenuProps['items']> = [
      { key: 'view', label: label('view'), onClick: () => setDetail(item) },
    ];
    if (sessionId) {
      rows.push({ key: 'reference', label: label('reference'), onClick: () => reference(item) });
      return rows;
    }
    if (item.canEdit) {
      rows.push({ key: 'edit', label: label('edit'), onClick: () => openEditor(item) });
      rows.push({ key: 'delete', label: label('delete'), danger: true, onClick: () => remove(item, 'delete') });
    }
    if (item.canManageBinding)
      rows.push({ key: 'unbind', label: label('unbind'), onClick: () => remove(item, 'unbind') });
    return rows;
  };

  const toolbar =
    !sessionId && canManage ? (
      <>
        <Tooltip title={label('create')}>
          <Button
            type="text"
            size="small"
            className={styles.headerAction}
            icon={<PlusOutlined />}
            aria-label={label('create')}
            disabled={busy}
            onClick={() => openEditor()}
          />
        </Tooltip>
        <Tooltip title={label('bind')}>
          <Button
            type="text"
            size="small"
            className={styles.headerAction}
            icon={<LinkOutlined />}
            aria-label={label('bind')}
            disabled={busy}
            onClick={() => void openBinding()}
          />
        </Tooltip>
      </>
    ) : null;

  return (
    <>
      {renderHeader?.(toolbar)}
      <div className={styles.panel}>
        {!renderHeader && toolbar && <div className={styles.toolbar}>{toolbar}</div>}
        <Spin spinning={loading}>
          {!items.length && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={label('empty')} />}
          {items.map((item) => (
            <div className={styles.row} key={item.datasourceId}>
              <span className={styles.name} title={sessionId ? label('referenceHint') : item.datasourceName}>
                <DatabaseOutlined />{' '}
                <span
                  tabIndex={0}
                  role="button"
                  onDoubleClick={() => (sessionId ? reference(item) : setDetail(item))}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    if (sessionId) reference(item);
                    else setDetail(item);
                  }}
                >
                  {item.datasourceName}
                </span>
              </span>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: actions(item),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  disabled={busy}
                  icon={<MoreOutlined />}
                  aria-label={label('actions')}
                />
              </Dropdown>
            </div>
          ))}
        </Spin>
        {sessionId && total > 50 && (
          <Pagination
            size="small"
            current={page}
            pageSize={50}
            total={total}
            showSizeChanger={false}
            onChange={setPage}
          />
        )}
        <Modal
          open={!!detail}
          title={label('details')}
          width={720}
          centered
          className={styles.modal}
          footer={null}
          onCancel={() => setDetail(undefined)}
        >
          <div className={styles.summary}>
            <span className={styles.summaryIcon}>
              <DatabaseOutlined />
            </span>
            <div className={styles.summaryText}>
              <div className={styles.summaryName}>{detail?.datasourceName}</div>
              <Tag>{detail?.datasourceType === 'opengauss' ? 'openGauss' : detail?.datasourceType}</Tag>
            </div>
          </div>
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{label('basicInfo')}</h4>
            <Descriptions
              column={1}
              colon={false}
              items={[{ key: 'description', label: label('description'), children: detail?.description || '—' }]}
            />
          </section>
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{label('connectionInfo')}</h4>
            <Descriptions
              layout="vertical"
              column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
              colon={false}
              items={[
                ...Array.from(
                  new Set([
                    'host',
                    'port',
                    'database',
                    'schema',
                    'username',
                    'sslMode',
                    ...Object.keys(detail?.connectionConfig || {}),
                  ])
                ).map((key) => ({
                  key,
                  label: label(key),
                  children: String(detail?.connectionConfig[key] ?? '—'),
                })),
                {
                  key: 'password',
                  label: label('password'),
                  children: label(detail?.hasPassword ? 'configured' : 'notConfigured'),
                },
              ]}
            />
          </section>
        </Modal>
        <Modal
          open={editorOpen}
          title={label(editing ? 'edit' : 'create')}
          width={720}
          centered
          className={styles.modal}
          okText={intl.formatMessage({ id: 'common.save' })}
          cancelText={intl.formatMessage({ id: 'common.cancel' })}
          confirmLoading={busy}
          onCancel={() => {
            setEditorOpen(false);
            form.resetFields();
          }}
          onOk={() => {
            void form
              .validateFields()
              .then((values) => {
                if (projectId) return mutate(() => saveDataSource(projectId, values, editing?.datasourceId));
              })
              .catch(() => undefined);
          }}
        >
          <Form form={form} layout="vertical" preserve={false} className={styles.form}>
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>{label('basicInfo')}</h4>
              <div className={styles.formGrid}>
                <Form.Item
                  name="datasourceName"
                  label={label('name')}
                  rules={[{ required: true, whitespace: true, max: 128 }]}
                >
                  <Input maxLength={128} placeholder={label('namePlaceholder')} />
                </Form.Item>
                <Form.Item name="datasourceType" label={label('type')} rules={[{ required: true }]}>
                  <Select disabled={!!editing} options={[{ value: 'opengauss', label: 'openGauss' }]} />
                </Form.Item>
              </div>
              <Form.Item name="description" label={label('description')}>
                <Input.TextArea
                  maxLength={2000}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder={label('descriptionPlaceholder')}
                />
              </Form.Item>
            </section>
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>{label('connectionInfo')}</h4>
              <div className={styles.formGrid}>
                <Form.Item
                  name={['connectionConfig', 'host']}
                  label={label('host')}
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder={label('hostPlaceholder')} />
                </Form.Item>
                <Form.Item
                  name={['connectionConfig', 'port']}
                  label={label('port')}
                  rules={[{ required: true }, { type: 'integer', min: 1, max: 65535 }]}
                >
                  <InputNumber className={styles.select} min={1} max={65535} precision={0} />
                </Form.Item>
                <Form.Item
                  name={['connectionConfig', 'database']}
                  label={label('database')}
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder={label('databasePlaceholder')} />
                </Form.Item>
                <Form.Item name={['connectionConfig', 'schema']} label={label('schema')}>
                  <Input placeholder={label('schemaPlaceholder')} />
                </Form.Item>
                <Form.Item
                  name={['connectionConfig', 'username']}
                  label={label('username')}
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input autoComplete="off" placeholder={label('usernamePlaceholder')} />
                </Form.Item>
                <Form.Item
                  name="password"
                  label={label('password')}
                  extra={editing ? label('passwordHint') : undefined}
                  rules={[{ required: !editing }]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={label(editing ? 'passwordKeep' : 'passwordPlaceholder')}
                  />
                </Form.Item>
                <Form.Item name={['connectionConfig', 'sslMode']} label={label('sslMode')} rules={[{ required: true }]}>
                  <Select
                    options={['disable', 'require', 'verify-ca', 'verify-full'].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              </div>
            </section>
          </Form>
        </Modal>
        <Modal
          open={bindingOpen}
          title={label('bind')}
          width={520}
          centered
          className={styles.modal}
          confirmLoading={busy}
          okButtonProps={{ disabled: selected === undefined || busy }}
          onCancel={() => setBindingOpen(false)}
          onOk={() => {
            if (projectId && selected !== undefined)
              void mutate(() => changeDataSourceBinding('bind', projectId, selected));
          }}
        >
          <p className={styles.bindingHint}>{label('bindingHint')}</p>
          <Select
            placeholder={label('selectPlaceholder')}
            notFoundContent={
              busy ? (
                <Spin size="small" />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={label('availableEmpty')} />
              )
            }
            className={styles.select}
            loading={busy}
            value={selected}
            onChange={setSelected}
            showSearch
            optionFilterProp="label"
            options={available.map((item) => ({ value: item.datasourceId, label: item.datasourceName }))}
          />
        </Modal>
      </div>
    </>
  );
};
export default ProjectDataSources;
