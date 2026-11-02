import { DownOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Dropdown, Space, Tooltip, Typography } from 'antd';
import { sandboxEndpoints, type SandboxEndpoint } from './endpointUtils';

export default function EndpointLinks({
  value,
  sandboxType,
  running,
}: {
  value?: string;
  sandboxType?: string;
  running: boolean;
}) {
  const intl = useIntl();
  const endpoints = sandboxEndpoints(value, sandboxType);
  if (!endpoints.length) return <Typography.Text disabled>-</Typography.Text>;
  const link = (entry: SandboxEndpoint) =>
    running && entry.href ? (
      <a href={entry.href} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>
        {entry.key}
      </a>
    ) : (
      <Typography.Text disabled style={{ overflowWrap: 'anywhere' }}>
        {entry.key}
      </Typography.Text>
    );
  const showMore = endpoints.length > 2 || endpoints.some((entry) => entry.key.length > 20 || entry.value.length > 100);
  return (
    <Space size="small" wrap>
      {endpoints.slice(0, 2).map((entry) => (
        <Tooltip key={entry.key} title={entry.value}>
          <span
            style={{
              display: 'inline-block',
              maxWidth: 85,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              verticalAlign: 'middle',
            }}
          >
            {link(entry)}
          </span>
        </Tooltip>
      ))}
      {showMore && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: endpoints.map((entry) => ({
              key: entry.key,
              label: (
                <div style={{ maxWidth: 'min(520px, 75vw)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                  {link(entry)}
                  <div style={{ color: '#666', fontSize: 12 }}>{entry.value}</div>
                </div>
              ),
            })),
            style: { maxHeight: 320, overflowY: 'auto' },
          }}
        >
          <Button type="link" size="small">
            {intl.formatMessage({ id: 'sandboxMgr.endpoint.more' })} <DownOutlined />
          </Button>
        </Dropdown>
      )}
    </Space>
  );
}
