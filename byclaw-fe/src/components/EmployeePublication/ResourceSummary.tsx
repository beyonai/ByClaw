import { useIntl } from '@umijs/max';
import type { PublicationDependency } from '@/service/employeePublication';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button, Empty, Space, Tabs, Tag, Typography, theme } from 'antd';
import { useId, useState, type ReactNode } from 'react';
import ResourceAvailabilityList, { resourceIsOmitted } from './ResourceAvailabilityList';
import styles from './ResourceSummary.module.less';

const needsAttention = (row: PublicationDependency) => resourceIsOmitted(row) || !!row.warning || !!row.error;

export default function PublicationResourceSummary({
  dependencies,
  onDownloadSkill,
}: {
  dependencies: PublicationDependency[];
  onDownloadSkill: (row: PublicationDependency) => void;
}) {
  const intl = useIntl();
  const categories = [
    {
      key: 'retained',
      label: intl.formatMessage({ id: 'employeePublication.resources.retainedTab' }),
      emptyText: intl.formatMessage({ id: 'employeePublication.resources.emptyRetained' }),
    },
    {
      key: 'omitted',
      label: intl.formatMessage({ id: 'employeePublication.resources.omittedTab' }),
      emptyText: intl.formatMessage({ id: 'employeePublication.resources.emptyOmitted' }),
    },
  ];

  const { token } = theme.useToken();
  const contentId = `publication-resources-${useId().replace(/:/g, '')}`;
  const [expanded, setExpanded] = useState(false);
  const [activeKey, setActiveKey] = useState(() => (dependencies.some(resourceIsOmitted) ? 'omitted' : 'retained'));
  const omittedCount = dependencies.filter(resourceIsOmitted).length;
  const restrictedCount = dependencies.filter((row) => !resourceIsOmitted(row) && row.warning).length;
  const renderResources = (rows: PublicationDependency[]) => (
    <ResourceAvailabilityList
      dependencies={[...rows].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)))}
      renderAction={(row) =>
        row.action === 'COPY_SKILL' && (
          <Button type="link" size="small" style={{ marginTop: 6 }} onClick={() => onDownloadSkill(row)}>
            {intl.formatMessage({ id: 'employeePublication.resources.downloadSkill' })}
          </Button>
        )
      }
    />
  );
  return (
    <section
      className={styles.panel}
      aria-label={intl.formatMessage({ id: 'employeePublication.resources.title' })}
      style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}
    >
      <div className={styles.heading}>
        <Space wrap size={[8, 6]}>
          <Typography.Text strong>{intl.formatMessage({ id: 'employeePublication.resources.title' })}</Typography.Text>
          <Typography.Text type="secondary">
            {intl.formatMessage({ id: 'employeePublication.resources.total' }, { count: dependencies.length })}
          </Typography.Text>
          {omittedCount > 0 && (
            <Tag color="orange">
              {intl.formatMessage({ id: 'employeePublication.resources.omittedCount' }, { count: omittedCount })}
            </Tag>
          )}
          {restrictedCount > 0 && (
            <Tag color="gold">
              {intl.formatMessage({ id: 'employeePublication.resources.restrictedCount' }, { count: restrictedCount })}
            </Tag>
          )}
        </Space>
        <Button
          type="link"
          size="small"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? intl.formatMessage({ id: 'employeePublication.resources.collapse' })
            : intl.formatMessage({ id: 'employeePublication.resources.expand' })}
        </Button>
      </div>
      <Typography.Paragraph type="secondary" className={styles.hint}>
        {omittedCount || restrictedCount
          ? intl.formatMessage({ id: 'employeePublication.resources.warningHint' })
          : intl.formatMessage({ id: 'employeePublication.resources.scopeHint' })}
      </Typography.Paragraph>
      <div id={contentId}>
        <Tabs
          className={styles.tabs}
          size="small"
          activeKey={activeKey}
          onChange={setActiveKey}
          onTabClick={() => setExpanded(true)}
          destroyOnHidden
          items={categories.map(({ key, label, emptyText }) => {
            const rows = dependencies.filter((row) => resourceIsOmitted(row) === (key === 'omitted'));
            let children: ReactNode = null;
            if (expanded) {
              children = rows.length ? (
                renderResources(rows)
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
              );
            }
            return {
              key,
              label: intl.formatMessage(
                { id: 'employeePublication.resources.tabCount' },
                { label, count: rows.length }
              ),
              children,
            };
          })}
        />
      </div>
    </section>
  );
}
