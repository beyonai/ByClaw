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
  const running = loading || !!pipelineProgress?.some((phase) => phase.status === 'running');
  const selectedCount = selectedCandidates.length;

  return (
    <Card title="② 生成 cli 脚本" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        为选中的接口生成确定性 cli 脚本。若上一步启用了
        AI，它仅用于候选接口的语义评分；不会把模型输出直接写入可执行脚本。生成完成后可逐个测试并保存。
      </Paragraph>

      {running ? (
        <ProgressPanel phases={pipelineProgress} loading={loading} />
      ) : (
        <>
          <Alert
            type={selectedCount ? 'info' : 'warning'}
            showIcon
            icon={llmSynthesis ? <RobotOutlined /> : undefined}
            message={selectedCount ? `将生成 ${selectedCount} 个本地 adapter 草稿` : '尚未选择候选接口'}
            description={
              selectedCount
                ? '仅为下方列出的接口生成本地草稿；生成后仍需逐个测试（verify）才能保存。'
                : '请返回上一步勾选至少一个候选 endpoint。'
            }
          />
          {selectedCount > 0 && (
            <List
              size="small"
              bordered
              style={{ marginTop: 12 }}
              header={<Text strong>已选候选 endpoint</Text>}
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
                      预计草稿：{previewDraftName(candidate)} · 候选分数 {candidate.score}
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
          上一步
        </Button>
        <Button
          type="primary"
          danger
          icon={<RobotOutlined />}
          loading={loading}
          disabled={!selectedCount}
          onClick={onRunGenerate}
          aria-label={selectedCount ? `生成 ${selectedCount} 个 cli 脚本` : '生成 cli 脚本'}
        >
          {selectedCount ? `生成 ${selectedCount} 个 cli 脚本` : '生成 cli 脚本'}
        </Button>
      </Space>
    </Card>
  );
}
