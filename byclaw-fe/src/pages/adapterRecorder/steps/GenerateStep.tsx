import { useIntl } from '@umijs/max';
// 拆步② 生成脚本页:折叠展示 generate 提示词 + 「生成 cli 脚本」按钮。点击后按阶段进度逐步展示生成过程,
// 生成结束由父组件自动切到第③步(脚本页)。
import { RobotOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Card, List, Space, Tag, Typography } from 'antd';
import type { RankCandidate } from '../types/recorder';
import { ProgressPanel } from './pipelineShared';

const { Paragraph, Text } = Typography;

/** 与 recorder 后端草稿命名保持一致，仅用于生成前展示的预计保存名。 */
export function previewDraftName(candidate: RankCandidate): string {
  const site = (candidate.endpoint.host || 'example.com').replaceAll(/[^A-Za-z0-9]+/g, '_').replaceAll(/_+$/g, '');
  const command = (candidate.endpoint.pathname || '/search')
    .replaceAll(/[^A-Za-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  return `${site || 'example_com'}/${command || 'adapter'}.js`;
}

interface Props {
  loading: boolean;
  llmSynthesis: boolean;

  /** 生成异步进度。 */
  pipelineProgress?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;

  /** 候选页勾选的接口；生成页据此展示确认清单与实际请求参数。 */
  selectedCandidates?: RankCandidate[];

  /** 触发生成(generate-only)。 */
  onRunGenerate: () => void;

  /** 返回上一步(评分候选页)。 */
  onBack: () => void;
}

export default function GenerateStep({
  loading,
  llmSynthesis,
  pipelineProgress,
  selectedCandidates = [],
  onRunGenerate,
  onBack,
}: Props) {
  const intl = useIntl();
  const running = loading || !!pipelineProgress?.some((phase) => phase.status === 'running');
  const selectedCount = selectedCandidates.length;

  return (
    <Card title={intl.formatMessage({ id: 'adapterRecorder.generate.title' })} variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        {intl.formatMessage({ id: 'adapterRecorder.generate.description' })}
      </Paragraph>

      {running ? (
        <ProgressPanel phases={pipelineProgress} loading={loading} />
      ) : (
        <>
          <Alert
            type={selectedCount ? 'info' : 'warning'}
            showIcon
            icon={llmSynthesis ? <RobotOutlined /> : undefined}
            message={
              selectedCount
                ? intl.formatMessage({ id: 'adapterRecorder.generate.draftCount' }, { v0: selectedCount })
                : intl.formatMessage({ id: 'adapterRecorder.generate.noneSelected' })
            }
            description={
              selectedCount
                ? intl.formatMessage({ id: 'adapterRecorder.generate.selectedHint' })
                : intl.formatMessage({ id: 'adapterRecorder.generate.selectHint' })
            }
          />
          {selectedCount > 0 && (
            <List
              size="small"
              bordered
              style={{ marginTop: 12 }}
              header={<Text strong>{intl.formatMessage({ id: 'adapterRecorder.generate.selectedEndpoints' })}</Text>}
              dataSource={selectedCandidates}
              renderItem={(candidate) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text
                      className="code"
                      aria-label={`${candidate.endpoint.method} ${candidate.endpoint.host}${
                        candidate.endpoint.pathname || candidate.endpoint.urlTemplate
                      }`}
                    >
                      <Tag>{candidate.endpoint.method}</Tag>
                      {candidate.endpoint.host}
                      {candidate.endpoint.pathname || candidate.endpoint.urlTemplate}
                    </Text>
                    <Text type="secondary" className="code" style={{ fontSize: 12 }}>
                      {intl.formatMessage({ id: 'adapterRecorder.generate.estimated' })}
                      {previewDraftName(candidate)}
                      {intl.formatMessage({ id: 'adapterRecorder.generate.candidateScore' })}
                      {candidate.score}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </>
      )}

      <Space style={{ marginTop: 12 }}>
        <Button icon={<ArrowLeftOutlined />} disabled={loading} onClick={onBack}>
          {intl.formatMessage({ id: 'projectSpace.onboarding.action.prev' })}
        </Button>
        <Button
          type="primary"
          danger
          icon={<RobotOutlined />}
          loading={loading}
          disabled={!selectedCount}
          onClick={onRunGenerate}
          aria-label={
            selectedCount
              ? intl.formatMessage({ id: 'adapterRecorder.generate.countAction' }, { v0: selectedCount })
              : intl.formatMessage({ id: 'adapterRecorder.generate.action' })
          }
        >
          {selectedCount
            ? intl.formatMessage({ id: 'adapterRecorder.generate.countAction' }, { v0: selectedCount })
            : intl.formatMessage({ id: 'adapterRecorder.generate.action' })}
        </Button>
      </Space>
    </Card>
  );
}
