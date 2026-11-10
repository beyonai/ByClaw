import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  Button,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useState, type ReactNode } from 'react';
import type { ColumnsType } from 'antd/es/table';
import {
  formatJsonIfValid,
  getServiceSpecDimension,
  getToolSandboxMetadata,
  isServiceSpecAutoStartEnabled,
  isServiceSpecEnabled,
  isValidToolCover,
  type ServiceSpecConfig,
  type ServiceSpecDimension,
} from './serviceSpecUtils';
import styles from './market.module.less';

interface Props {
  specs: ServiceSpecConfig[];
  loading: boolean;
  dimension: ServiceSpecDimension;
  updatingKey: string | null;
  onDimensionChange: (dimension: ServiceSpecDimension) => void;
  onAdd: (dimension: ServiceSpecDimension) => void;
  onEdit: (record: ServiceSpecConfig) => void;
  onDelete: (record: ServiceSpecConfig) => void;
  onEnabledChange: (record: ServiceSpecConfig, enabled: boolean) => void;
  onAutoStartChange: (record: ServiceSpecConfig, enabled: boolean) => void;
  renderRebuildActions?: (record: ServiceSpecConfig) => ReactNode;
}

const DIMENSIONS: ServiceSpecDimension[] = ['USER', 'TENANT', 'SHARED', 'TOOL'];

export default function ServiceSpecCatalog(props: Props) {
  const intl = useIntl();
  const t = (key: string) => intl.formatMessage({ id: `sandboxMgr.${key}` });
  const [search, setSearch] = useState('');
  const [capability, setCapability] = useState<string>();
  const [detail, setDetail] = useState<ServiceSpecConfig | null>(null);
  const records = props.specs.filter((record) => getServiceSpecDimension(record) === props.dimension);
  const isMarket = props.dimension === 'TOOL';
  const capabilities = Array.from(
    new Set(records.flatMap((record) => getToolSandboxMetadata(record).capabilities))
  ).sort();
  const filtered = records.filter((record) => {
    const metadata = getToolSandboxMetadata(record);
    const text = [record.serviceKey, record.displayName, metadata.description, ...metadata.capabilities]
      .join(' ')
      .toLowerCase();
    return text.includes(search.trim().toLowerCase()) && (!capability || metadata.capabilities.includes(capability));
  });
  const detailMetadata = detail ? getToolSandboxMetadata(detail) : null;
  const availabilitySwitch = (record: ServiceSpecConfig) => (
    <Tooltip title={t(isMarket ? 'market.enabledTip' : `dimension.${props.dimension}Tip`)}>
      <Switch
        size="small"
        aria-label={`${record.displayName || record.serviceKey} ${t('market.enabled')}`}
        checked={isServiceSpecEnabled(record)}
        loading={props.updatingKey === record.serviceKey}
        disabled={props.updatingKey !== null}
        onChange={(checked) => props.onEnabledChange(record, checked)}
      />
    </Tooltip>
  );
  const actions = (record: ServiceSpecConfig) => (
    <Space size={4} wrap>
      <Button size="small" type="link" icon={<EditOutlined />} onClick={() => props.onEdit(record)}>
        {t('market.edit')}
      </Button>
      <Popconfirm title={t('config.deleteConfirm')} onConfirm={() => props.onDelete(record)}>
        <Button
          size="small"
          type="text"
          danger
          aria-label={`${record.serviceKey} ${t('market.delete')}`}
          icon={<DeleteOutlined />}
        />
      </Popconfirm>
    </Space>
  );

  const autoStartColumns: ColumnsType<ServiceSpecConfig> = [];
  if (props.dimension === 'USER') {
    autoStartColumns.push({
      title: t('config.autoStart'),
      width: 120,
      render: (_: unknown, record: ServiceSpecConfig) => (
        <Tooltip title={t('config.autoStartTip')}>
          <Switch
            size="small"
            aria-label={`${record.serviceKey} ${t('config.autoStart')}`}
            checked={isServiceSpecAutoStartEnabled(record)}
            disabled={props.updatingKey !== null}
            loading={props.updatingKey === record.serviceKey}
            onChange={(checked) => props.onAutoStartChange(record, checked)}
          />
        </Tooltip>
      ),
    });
  }

  return (
    <section className={styles.catalog}>
      <Tabs
        activeKey={props.dimension}
        onChange={(key) => {
          setSearch('');
          setCapability(undefined);
          props.onDimensionChange(key as ServiceSpecDimension);
        }}
        items={DIMENSIONS.map((dimension) => ({
          key: dimension,
          label: (
            <Space size={6}>
              {t(`dimension.${dimension}`)}
              <span className={styles.tabCount}>
                {props.specs.filter((record) => getServiceSpecDimension(record) === dimension).length}
              </span>
            </Space>
          ),
        }))}
      />
      {isMarket && (
        <div className={styles.hero}>
          <div className={styles.heroIcon}>
            <AppstoreOutlined />
          </div>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>BYCLAW / TOOL SANDBOX</div>
            <Typography.Title level={3}>{t('market.title')}</Typography.Title>
            <Typography.Paragraph>{t('market.subtitle')}</Typography.Paragraph>
          </div>
          <div className={styles.heroMetric}>
            <strong>
              {records.filter(isServiceSpecEnabled).length}
              <span> / {records.length}</span>
            </strong>
            <span>{t('market.available')}</span>
          </div>
        </div>
      )}
      <div className={styles.toolbar}>
        <Input
          prefix={<SearchOutlined />}
          aria-label={t('market.search')}
          placeholder={t('market.search')}
          value={search}
          allowClear
          onChange={(event) => setSearch(event.target.value)}
          className={styles.search}
        />
        {isMarket && (
          <Select
            aria-label={t('market.capabilityFilter')}
            placeholder={t('market.capabilityFilter')}
            value={capability}
            allowClear
            onChange={setCapability}
            options={capabilities.map((value) => ({ label: value, value }))}
            className={styles.capabilityFilter}
          />
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={() => props.onAdd(props.dimension)}>
          {t('config.add')}
        </Button>
      </div>
      <Typography.Paragraph type="secondary" className={styles.scopeTip}>
        {t(isMarket ? 'market.enabledTip' : `dimension.${props.dimension}Tip`)}
      </Typography.Paragraph>
      {isMarket ? (
        <Spin spinning={props.loading}>
          {filtered.length ? (
            <div className={styles.grid}>
              {filtered.map((record) => {
                const metadata = getToolSandboxMetadata(record);
                const enabled = isServiceSpecEnabled(record);
                return (
                  <article className={styles.card} key={record.serviceKey}>
                    <div className={styles.cover}>
                      {metadata.coverImage && isValidToolCover(metadata.coverImage) ? (
                        <img src={metadata.coverImage} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <div className={styles.coverPlaceholder}>
                          <ToolOutlined />
                          <span>{metadata.capabilities[0] || 'SANDBOX'}</span>
                        </div>
                      )}
                      <Tag color={enabled ? 'success' : 'default'} className={styles.status}>
                        {t(enabled ? 'market.available' : 'market.unavailable')}
                      </Tag>
                    </div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardTitle}>
                        <Typography.Title level={5}>{record.displayName || record.serviceKey}</Typography.Title>
                        {availabilitySwitch(record)}
                      </div>
                      <Typography.Text type="secondary" className={styles.serviceKey}>
                        {record.serviceKey}
                      </Typography.Text>
                      <Typography.Paragraph
                        ellipsis={{ rows: 2, tooltip: metadata.description }}
                        className={styles.description}
                      >
                        {metadata.description || t('market.noDescription')}
                      </Typography.Paragraph>
                      <div className={styles.tags}>
                        {metadata.capabilities.length ? (
                          metadata.capabilities.map((tag) => <Tag key={tag}>{tag}</Tag>)
                        ) : (
                          <span>{t('market.noCapabilities')}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.cardFooter}>
                      <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)}>
                        {t('market.details')}
                      </Button>
                      {actions(record)}
                    </div>
                    {props.renderRebuildActions && (
                      <div className={styles.rebuildActions}>{props.renderRebuildActions(record)}</div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty description={t('market.empty')} />
          )}
        </Spin>
      ) : (
        <Table<ServiceSpecConfig>
          rowKey="serviceKey"
          dataSource={filtered}
          loading={props.loading}
          pagination={false}
          scroll={{ x: 740 }}
          columns={[
            { title: t('config.serviceKey'), dataIndex: 'serviceKey', width: 180, ellipsis: true },
            {
              title: t('config.specJson'),
              dataIndex: 'specJson',
              ellipsis: true,
              render: (value: string) => (
                <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                  {value}
                </Typography.Paragraph>
              ),
            },
            {
              title: t('market.enabled'),
              width: 100,
              align: 'center',
              render: (_: unknown, record) => availabilitySwitch(record),
            },
            ...autoStartColumns,
            {
              title: t('table.action'),
              width: props.renderRebuildActions ? 300 : 130,
              render: (_: unknown, record) => (
                <Space wrap>
                  {props.renderRebuildActions?.(record)}
                  {actions(record)}
                </Space>
              ),
            },
          ]}
        />
      )}
      <Drawer
        title={detail?.displayName || detail?.serviceKey}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={640}
        destroyOnClose
      >
        {detail && detailMetadata && (
          <div className={styles.detail}>
            {detailMetadata.coverImage && isValidToolCover(detailMetadata.coverImage) && (
              <img className={styles.detailCover} src={detailMetadata.coverImage} alt="" referrerPolicy="no-referrer" />
            )}
            <Typography.Text code>{detail.serviceKey}</Typography.Text>
            <Typography.Paragraph className={styles.detailDescription}>
              {detailMetadata.description || t('market.noDescription')}
            </Typography.Paragraph>
            <Space wrap>
              {detailMetadata.capabilities.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
            <Typography.Title level={5}>{t('config.specJson')}</Typography.Title>
            <pre className={styles.configPreview}>{formatJsonIfValid(detail.specJson)}</pre>
            {detail.templateJson && (
              <>
                <Typography.Title level={5}>{t('config.templateJson')}</Typography.Title>
                <pre className={styles.configPreview}>{formatJsonIfValid(detail.templateJson)}</pre>
              </>
            )}
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                props.onEdit(detail);
                setDetail(null);
              }}
            >
              {t('market.edit')}
            </Button>
          </div>
        )}
      </Drawer>
    </section>
  );
}
