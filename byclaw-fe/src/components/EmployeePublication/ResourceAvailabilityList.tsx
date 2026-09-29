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

export const resourceIsOmitted = (row: PublicationDependency) =>
  ['OMIT_RESOURCE', 'UNAVAILABLE_RESOURCE'].includes(row.action);

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
            <Tag color={resourceIsOmitted(row) ? 'orange' : row.action === 'COPY_SKILL' ? 'blue' : undefined}>
              {resourceIsOmitted(row) ? '不会带入' : row.action === 'COPY_SKILL' ? '生成企业技能副本' : '保留关联'}
            </Tag>
          </Space>
          <div style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary">谁可以使用：</Typography.Text>
            <span>
              {resourceIsOmitted(row) ? '新企业员工中不可用' : row.availabilityScope || '尚未确认，沿用原授权范围'}
            </span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary">原因：</Typography.Text>
            <span>{row.reason || row.warning || '保留原资源关联与权限'}</span>
          </div>
          <div>
            <Typography.Text type="secondary">发布后：</Typography.Text>
            <span>
              {resourceIsOmitted(row)
                ? '此资源不会出现在企业员工中，依赖它的能力不可用；原个人员工保持不变。'
                : row.impact || '按原有资源权限使用，实际可用性取决于资源状态。'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
