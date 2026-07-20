// Step 5 · 生成草稿 —— select-only init,契约三态:dry-run 预览 → ADR-0005 责任声明 → 确认写入。
// 预览不推进会话;写入(带 responsibleUseAcknowledgedAt)推进 ranked→draft_created。
import { useState } from 'react';
import { FileTextOutlined, EyeOutlined, SafetyCertificateOutlined, RobotOutlined } from '@ant-design/icons';
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
}

export default function InitStep({ loading, selectedCandidate, adapterName, preview, onPreview, onWrite }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const { token } = theme.useToken();

  return (
    <Card title="生成 Adapter 草稿" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        基于选定候选 select-only 生成 adapter:先 dry-run 预览(不写盘),确认 ADR-0005 责任声明后写入。
        写入成功后会话推进到 draft_created。
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
                {adapterName ?? '(未派生)'}
              </Text>
            </Space>
          }
        />
      ) : (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="请先在上方选择一个候选 endpoint" />
      )}

      <Button icon={<EyeOutlined />} loading={loading} disabled={!selectedCandidate} onClick={() => onPreview()}>
        {preview ? '重新预览 (dry-run)' : '预览草稿 (dry-run)'}
      </Button>

      {preview && (
        <div style={{ marginTop: 16 }}>
          <Descriptions size="small" column={1} colon={false} styles={{ label: { width: 110 } }} bordered>
            <Descriptions.Item label="Adapter 路径">
              <Text className="code" copyable>
                {preview.report.adapterPath}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="报告路径">
              <Text className="code" copyable>
                {preview.report.reportPath}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="发布通道">
              <Text className="code">{preview.report.releaseChannel}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                profile {preview.report.localExperimentProfile} · cfg v{preview.report.configSnapshotVersion}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Dry-run">
              {preview.dryRun.exists ? (
                <Tag color={token.colorWarning}>已存在,将覆盖</Tag>
              ) : (
                <Tag color={token.colorSuccess}>新建</Tag>
              )}
              <Text type="secondary" style={{ marginLeft: 8 }}>
                变更 {preview.dryRun.changedLines ?? '—'} 行
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
              message="用 AI 生成 adapter(实验功能)"
              description="点击后会把本次录制的页面截图 + 抓到的真实请求/响应发送给 Anthropic 分析,生成 func/columns。数据可能含登录态站点信息,仅在你接受该外发时继续。当前预览为空骨架,未发送任何数据。"
              action={
                <Button
                  danger
                  type="primary"
                  icon={<RobotOutlined />}
                  loading={loading}
                  onClick={() => onPreview(true)}
                >
                  用 AI 生成(发送痕迹)
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
                  message="此 adapter 由 AI 基于你的录制痕迹生成"
                  description="你的页面截图与抓到的真实请求/响应已发送给模型分析。写盘前请逐行审阅下方代码,确认逻辑正确且不含敏感信息。"
                />
              )}
              <Text type="secondary">生成的 adapter 源码(写盘前审阅):</Text>
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
              我已阅读并接受 <Text strong>责任使用声明</Text>(ADR-0005):仅在获授权的场景下生成与运行此 adapter。
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
            确认写入
          </Button>
        </div>
      )}
    </Card>
  );
}
