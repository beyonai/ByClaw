import { useIntl } from '@umijs/max';
// Step 5 · 生成草稿 —— select-only init,契约三态:dry-run 预览 → ADR-0005 责任声明 → 确认写入。
// 预览不推进会话;写入(带 responsibleUseAcknowledgedAt)推进 ranked→draft_created。
import { useState } from 'react';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Descriptions, Space, Tag, Typography, theme } from 'antd';
import type { InitResult, RankCandidate } from '../types/recorder';

const { Paragraph, Text } = Typography;

interface Props {
  loading: boolean;
  selectedCandidate?: RankCandidate;

  /** 派生并固化的 adapter 名(site/command) */
  adapterName?: string;

  /** dry-run 预览结果({report,dryRun});未预览时为空 */
  preview?: InitResult;

  /** egressConsent=true 时携带 LLM 外发同意(点「用 AI 生成」才传),不传则不外发、空骨架预览。 */
  onPreview: (egressConsent?: boolean) => void;
  onWrite: () => void;
  onBack: () => void;
}

export default function InitStep({
  loading,
  selectedCandidate,
  adapterName,
  preview,
  onPreview,
  onWrite,
  onBack,
}: Props) {
  const intl = useIntl();
  const [acknowledged, setAcknowledged] = useState(false);
  const { token } = theme.useToken();

  return (
    <Card title={intl.formatMessage({ id: 'adapterRecorder.init.title' })} variant="borderless">
      <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 12 }}>
        {intl.formatMessage({ id: 'adapterRecorder.init.back' })}
      </Button>
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        {intl.formatMessage({ id: 'adapterRecorder.init.description' })}
      </Paragraph>

      {selectedCandidate ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space size={4} wrap>
              <Text className="code">
                {selectedCandidate.endpoint.method} {selectedCandidate.endpoint.pathname}
              </Text>
              <Text type="secondary">→ adapter</Text>
              <Text className="code" strong>
                {adapterName ?? intl.formatMessage({ id: 'adapterRecorder.init.notDerived' })}
              </Text>
            </Space>
          }
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={intl.formatMessage({ id: 'adapterRecorder.init.selectFirst' })}
        />
      )}

      <Button icon={<EyeOutlined />} loading={loading} disabled={!selectedCandidate} onClick={() => onPreview()}>
        {preview
          ? intl.formatMessage({ id: 'adapterRecorder.init.previewAgain' })
          : intl.formatMessage({ id: 'adapterRecorder.init.preview' })}
      </Button>

      {preview && (
        <div style={{ marginTop: 16 }}>
          <Descriptions size="small" column={2} colon={false} styles={{ label: { width: 110 } }} bordered>
            <Descriptions.Item label={intl.formatMessage({ id: 'adapterRecorder.init.adapterPath' })}>
              <Text className="code" copyable>
                {preview.report.adapterPath}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'projectSpace.detail.integration.suite.reportPath' })}>
              <Text className="code" copyable>
                {preview.report.reportPath}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'adapterRecorder.init.channel' })} span={2}>
              <Text className="code">{preview.report.releaseChannel}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                profile {preview.report.localExperimentProfile} · cfg v{preview.report.configSnapshotVersion}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Dry-run" span={2}>
              {preview.dryRun.exists ? (
                <Tag color={token.colorWarning}>{intl.formatMessage({ id: 'adapterRecorder.init.overwrite' })}</Tag>
              ) : (
                <Tag color={token.colorSuccess}>{intl.formatMessage({ id: 'common.create' })}</Tag>
              )}
              <Text type="secondary" style={{ marginLeft: 8 }}>
                {intl.formatMessage({ id: 'adapterRecorder.init.changes' })}
                {preview.dryRun.changedLines ?? '—'}
                {intl.formatMessage({ id: 'adapterRecorder.init.lines' })}
              </Text>
            </Descriptions.Item>
          </Descriptions>

          {!!preview.report.warnings?.length && (
            <Alert type="warning" showIcon style={{ marginTop: 12 }} message={preview.report.warnings.join(';')} />
          )}

          {/* P0-2 外发前置同意:AI 可用但尚未外发 → 显式同意后才把痕迹发模型 */}
          {preview.llmSynthesisOffered && (
            <Alert
              type="warning"
              showIcon
              icon={<RobotOutlined />}
              style={{ marginTop: 12 }}
              message={intl.formatMessage({ id: 'adapterRecorder.init.aiTitle' })}
              description={intl.formatMessage({ id: 'adapterRecorder.init.aiConsent' })}
              action={
                <Button
                  danger
                  type="primary"
                  icon={<RobotOutlined />}
                  loading={loading}
                  onClick={() => onPreview(true)}
                >
                  {intl.formatMessage({ id: 'adapterRecorder.init.aiAction' })}
                </Button>
              }
            />
          )}

          {preview.generatedSource && (
            <div style={{ marginTop: 16 }}>
              {preview.generatedSource.includes('@generated-by adapter-recorder-llm') && (
                <Alert
                  type="warning"
                  showIcon
                  icon={<RobotOutlined />}
                  style={{ marginBottom: 8 }}
                  message={intl.formatMessage({ id: 'adapterRecorder.init.aiGenerated' })}
                  description={intl.formatMessage({ id: 'adapterRecorder.init.reviewHint' })}
                />
              )}
              <Text type="secondary">{intl.formatMessage({ id: 'adapterRecorder.init.sourceTitle' })}</Text>
              <pre
                className="code"
                style={{
                  maxHeight: 320,
                  overflow: 'auto',
                  marginTop: 6,
                  padding: 12,
                  fontSize: 12,
                  lineHeight: 1.5,
                  background: token.colorFillTertiary,
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                {preview.generatedSource}
              </pre>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>
              <SafetyCertificateOutlined style={{ marginRight: 6 }} />
              {intl.formatMessage({ id: 'adapterRecorder.init.acceptBefore' })}
              <Text strong>{intl.formatMessage({ id: 'adapterRecorder.init.responsibility' })}</Text>
              {intl.formatMessage({ id: 'adapterRecorder.init.acceptAfter' })}
            </Checkbox>
          </div>

          <Button
            type="primary"
            icon={<FileTextOutlined />}
            loading={loading}
            disabled={!acknowledged}
            onClick={onWrite}
            style={{ marginTop: 12 }}
          >
            {intl.formatMessage({ id: 'adapterRecorder.init.write' })}
          </Button>
        </div>
      )}
    </Card>
  );
}
