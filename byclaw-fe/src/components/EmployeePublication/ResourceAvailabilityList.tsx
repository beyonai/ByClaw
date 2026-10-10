import { useIntl } from '@umijs/max';
import type { PublicationDependency } from '@/service/employeePublication';
import { Space, Tag, Typography, theme } from 'antd';
import type { ReactNode } from 'react';

export const resourceIsOmitted = (row: PublicationDependency) =>
  ['OMIT_RESOURCE', 'UNAVAILABLE_RESOURCE'].includes(row.action);

const getResourceActionMessageId = (row: PublicationDependency) => {
  if (resourceIsOmitted(row)) return 'employeePublication.resources.omitted';
  if (row.action === 'COPY_SKILL') return 'employeePublication.resources.copySkill';
  return 'employeePublication.resources.retained';
};

export default function ResourceAvailabilityList({
  dependencies,
  renderAction,
}: {
  dependencies: PublicationDependency[];
  renderAction?: (row: PublicationDependency) => ReactNode;
}) {
  const intl = useIntl();
  const resourceTypeLabels: Record<string, string> = {
    TOOL: intl.formatMessage({ id: 'employeePublication.resourceType.tool' }),
    TOOLKIT: intl.formatMessage({ id: 'employeePublication.resourceType.tool' }),
    MCP: intl.formatMessage({ id: 'employeePublication.resourceType.tool' }),
    MCP_TOOL: intl.formatMessage({ id: 'employeePublication.resourceType.tool' }),
    AGENT: intl.formatMessage({ id: 'employeePublication.resourceType.tool' }),
    SKILL: intl.formatMessage({ id: 'employeePublication.resourceType.skill' }),
    KG_DOC: intl.formatMessage({ id: 'employeePublication.resourceType.knowledge' }),
    KG_DB: intl.formatMessage({ id: 'employeePublication.resourceType.knowledge' }),
    KG_QA: intl.formatMessage({ id: 'employeePublication.resourceType.knowledge' }),
    KG_TERM: intl.formatMessage({ id: 'employeePublication.resourceType.knowledge' }),
    KG_CLOUD: intl.formatMessage({ id: 'employeePublication.resourceType.knowledge' }),
  };

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
            <Tag style={{ marginInlineEnd: 0 }}>
              {resourceTypeLabels[row.resourceType || ''] ||
                intl.formatMessage({ id: 'employeePublication.resourceType.resource' })}
            </Tag>
            <Typography.Text strong>{row.name}</Typography.Text>
            <Tag color={resourceIsOmitted(row) ? 'orange' : row.action === 'COPY_SKILL' ? 'blue' : undefined}>
              {intl.formatMessage({ id: getResourceActionMessageId(row) })}
            </Tag>
          </Space>
          <div style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary">
              {intl.formatMessage({ id: 'employeePublication.resources.usersLabel' })}
            </Typography.Text>
            <span>
              {resourceIsOmitted(row)
                ? intl.formatMessage({ id: 'employeePublication.resources.unavailable' })
                : row.availabilityScope || intl.formatMessage({ id: 'employeePublication.resources.scopeUnknown' })}
            </span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary">
              {intl.formatMessage({ id: 'employeePublication.resources.reasonLabel' })}
            </Typography.Text>
            <span>
              {row.reason || row.warning || intl.formatMessage({ id: 'employeePublication.resources.keepPermissions' })}
            </span>
          </div>
          <div>
            <Typography.Text type="secondary">
              {intl.formatMessage({ id: 'employeePublication.resources.afterLabel' })}
            </Typography.Text>
            <span>
              {resourceIsOmitted(row)
                ? intl.formatMessage({ id: 'employeePublication.resources.omittedImpact' })
                : row.impact || intl.formatMessage({ id: 'employeePublication.resources.retainedImpact' })}
            </span>
          </div>
          {renderAction?.(row)}
        </li>
      ))}
    </ul>
  );
}
