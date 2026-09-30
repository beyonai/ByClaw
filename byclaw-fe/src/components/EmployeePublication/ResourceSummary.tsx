import type { PublicationDependency } from '@/service/employeePublication';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button, Empty, Space, Tabs, Tag, Typography, theme } from 'antd';
import { useId, useState, type ReactNode } from 'react';
import ResourceAvailabilityList, { resourceIsOmitted } from './ResourceAvailabilityList';
import styles from './ResourceSummary.module.less';

const categories = [
  { key: 'omitted', label: '不会带入关联', emptyText: '没有需要排除的关联资源' },
  { key: 'retained', label: '保留关联', emptyText: '暂无保留关联的资源' },
];

const needsAttention = (row: PublicationDependency) => resourceIsOmitted(row) || !!row.warning || !!row.error;

export default function PublicationResourceSummary({
  dependencies,
  onDownloadSkill,
}: {
  dependencies: PublicationDependency[];
  onDownloadSkill: (row: PublicationDependency) => void;
}) {
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
            下载待审技能
          </Button>
        )
      }
    />
  );
  return (
    <section
      className={styles.panel}
      aria-label="关联资源说明"
      style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}
    >
      <div className={styles.heading}>
        <Space wrap size={[8, 6]}>
          <Typography.Text strong>关联资源说明</Typography.Text>
          <Typography.Text type="secondary">共 {dependencies.length} 项</Typography.Text>
          {omittedCount > 0 && <Tag color="orange">{omittedCount} 项不会带入</Tag>}
          {restrictedCount > 0 && <Tag color="gold">{restrictedCount} 项使用范围受限</Tag>}
        </Space>
        <Button
          type="link"
          size="small"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起说明' : '展开说明'}
        </Button>
      </div>
      <Typography.Paragraph type="secondary" className={styles.hint}>
        {omittedCount || restrictedCount
          ? '这些提醒不影响员工发布。“不会带入”的资源及依赖它们的能力在企业员工中不可用。'
          : '按发布结果查看资源的可用范围，原个人员工的配置保持不变。'}
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
              label: `${label}（${rows.length}）`,
              children,
            };
          })}
        />
      </div>
    </section>
  );
}
