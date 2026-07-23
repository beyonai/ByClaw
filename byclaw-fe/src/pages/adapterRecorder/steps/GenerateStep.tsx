// 拆步② 生成脚本页:折叠展示 generate 提示词 + 「生成 cli 脚本」按钮。点击后按阶段进度逐步展示生成过程,
// 生成结束由父组件自动切到第③步(脚本页)。
import { RobotOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Space, Typography } from 'antd';
import { ProgressPanel } from './pipelineShared';

const { Paragraph } = Typography;

interface Props {
  loading: boolean;
  llmSynthesis: boolean;

  /** 生成异步进度。 */
  pipelineProgress?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;

  /** 候选页选中要生成脚本的接口数(仅为选中的生成)。 */
  selectedCount?: number;

  /** 触发生成(generate-only)。 */
  onRunGenerate: () => void;

  /** 返回上一步(评分候选页)。 */
  onBack: () => void;
}

export default function GenerateStep({
  loading,
  llmSynthesis,
  pipelineProgress,
  selectedCount,
  onRunGenerate,
  onBack,
}: Props) {
  const running = loading || !!pipelineProgress?.length;
  let generationMessage = '将为所选接口生成本地脚本';
  if (selectedCount) generationMessage = `将为选中的 ${selectedCount} 个接口 + 证据生成脚本`;

  return (
    <Card title="② 生成 cli 脚本" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        为选中的接口生成确定性 cli 脚本。若上一步启用了
        AI，它仅用于候选接口的语义评分；不会把模型输出直接写入可执行脚本。生成完成后可逐个测试并保存。
      </Paragraph>

      {running ? (
        <ProgressPanel phases={pipelineProgress} loading={loading} />
      ) : (
        <Alert
          type="info"
          showIcon
          icon={llmSynthesis ? <RobotOutlined /> : undefined}
          message={generationMessage}
          description="仅为你在候选页勾选的接口生成;生成后每个脚本可单独测试(真跑 verify)与保存。"
        />
      )}

      <Space style={{ marginTop: 12 }}>
        <Button icon={<ArrowLeftOutlined />} disabled={loading} onClick={onBack}>
          上一步
        </Button>
        <Button type="primary" danger icon={<RobotOutlined />} loading={loading} onClick={onRunGenerate}>
          生成 cli 脚本
        </Button>
      </Space>
    </Card>
  );
}
