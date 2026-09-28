import type { PublicationDependency } from '@/service/employeePublication';
import { Space, Tag, Typography, theme } from 'antd';

const resourceTypeLabels: Record<string, string> = {
  TOOL: '工具',
  TOOLKIT: '工具',
  MCP: '工具',
  MCP_TOOL: '工具',
  AGENT: '工具',
  SKILL: '技能',
  KG_DOC: '知识',
  KG_DB: '知识',
  KG_QA: '知识',
  KG_TERM: '知识',
  KG_CLOUD: '知识',
};

export default function ResourceAvailabilityList({ dependencies }: { dependencies: PublicationDependency[] }) {
  const { token } = theme.useToken();
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
      {dependencies.map((row, index) => (
        <li
          key={`${row.resourceId}-${index}`}
          style={{
            padding: '12px 16px',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            background: token.colorBgContainer,
            overflowWrap: 'anywhere',
          }}
        >
          <Space wrap size={8} style={{ marginBottom: 8, maxWidth: '100%' }}>
            <Tag style={{ marginInlineEnd: 0 }}>{resourceTypeLabels[row.resourceType || ''] || '资源'}</Tag>
            <Typography.Text strong>{row.name}</Typography.Text>
          </Space>
          <div style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary">谁可以使用：</Typography.Text>
            <span>{row.availabilityScope || '尚未确认，沿用原授权范围'}</span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary">原因：</Typography.Text>
            <span>{row.reason || row.warning || '保留原资源关联与权限'}</span>
          </div>
          <div>
            <Typography.Text type="secondary">发布后：</Typography.Text>
            <span>{row.impact || '未获授权或资源不可用时，用户无法使用此资源；不影响员工发布'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
