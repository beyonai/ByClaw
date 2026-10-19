import { useIntl } from '@umijs/max';
// Step 6 · 执行 Verify —— runner 子进程隔离执行 adapter。
// 安全(M7c redaction):仅返回脱敏 VerifySummary(行数 + 字段**数**〔非列名,列名可能是 seed 值〕+
// fixture/trace 状态),不回原始行数据,故展示为摘要而非数据表。
import { CheckCircleFilled, PlayCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Tag, Typography, theme } from 'antd';
import type { InitResult, VerifySummary } from '../types/recorder';

const { Paragraph, Text } = Typography;

interface Props {
  loading: boolean;

  /** 已写入的草稿(被 verify 的对象) */
  draft?: InitResult;
  result?: VerifySummary;
  onVerify: () => void;
}

export default function VerifyStep({ loading, draft, result, onVerify }: Props) {
  const intl = useIntl();
  const { token } = theme.useToken();
  return (
    <Card title={intl.formatMessage({ id: 'adapterRecorder.verify.run' })} variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        {intl.formatMessage({ id: 'adapterRecorder.verify.description' })}
      </Paragraph>

      {draft && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={<Text className="code">{draft.report.adapterPath}</Text>}
        />
      )}

      <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} disabled={!!result} onClick={onVerify}>
        {result
          ? intl.formatMessage({ id: 'adapterRecorder.verify.complete' })
          : intl.formatMessage({ id: 'adapterRecorder.verify.run' })}
      </Button>

      {result && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={result.ok ? 'success' : 'error'}
            showIcon
            icon={result.ok ? <CheckCircleFilled /> : undefined}
            style={{ marginBottom: 12 }}
            message={
              result.ok
                ? intl.formatMessage({ id: 'adapterRecorder.verify.shapePassed' }, { v0: result.rows ?? 0 })
                : intl.formatMessage(
                  { id: 'adapterRecorder.verify.failedWithDetail' },
                  { v0: result.error ? `:${result.error.code}` : '' }
                )
            }
            description={!result.ok && result.error ? result.error.message : undefined}
          />

          <Descriptions size="small" column={1} colon={false} styles={{ label: { width: 96 } }} bordered>
            <Descriptions.Item label={intl.formatMessage({ id: 'adapterRecorder.verify.phase' })}>
              <Text className="code">{result.stage ?? '—'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'adapterRecorder.verify.rowCount' })}>
              <Text className="code">{result.rows ?? 0}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'adapterRecorder.verify.fieldCount' })}>
              {typeof result.fieldCount === 'number' ? (
                <Text className="code">{result.fieldCount}</Text>
              ) : (
                <Text type="secondary">—</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Fixture">
              <Text className="code">{result.fixture?.status ?? '—'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Trace">
              <Text className="code">{result.trace?.retained ? 'retained' : 'discarded'}</Text>
            </Descriptions.Item>
          </Descriptions>

          {result.ok && (
            <Tag color={token.colorSuccess} className="code" style={{ marginTop: 12 }}>
              session → done
            </Tag>
          )}
        </div>
      )}
    </Card>
  );
}
