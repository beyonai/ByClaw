// Step 1 · 健康检查 —— health(daemon/extension/high-level 健康状态列表)
import { ApiOutlined, CloudServerOutlined, DisconnectOutlined, RobotOutlined, RocketOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Card, List, Space, Typography, theme } from 'antd';
import type { HealthReport } from '../types/recorder';

const { Text, Paragraph } = Typography;

const LLM_SYNTHESIS_DESCRIPTIONS: Record<string, string> = {
  default_model_not_found: '未找到已启用的默认 LLM 模型；可继续使用本地规则流程。',
  default_model_detail_unavailable: '默认模型详情不可用；可继续使用本地规则流程。',
  default_model_endpoint_missing: '默认模型缺少服务地址；可继续使用本地规则流程。',
  default_model_token_missing: '默认模型缺少服务端凭据；可继续使用本地规则流程。',
  default_model_code_missing: '默认模型缺少模型编码；可继续使用本地规则流程。',
  default_model_lookup_failed: '默认模型查询失败；可继续使用本地规则流程。',
};

export function llmSynthesisDescription(reason?: string): string | undefined {
  return reason ? LLM_SYNTHESIS_DESCRIPTIONS[reason] : undefined;
}

const ITEMS: Array<{ key: keyof HealthReport; label: string; icon: React.ReactNode }> = [
  { key: 'localService', label: 'Local Service', icon: <CloudServerOutlined /> },
  { key: 'daemon', label: 'byCLI Daemon', icon: <ApiOutlined /> },
  { key: 'extension', label: 'Chrome 扩展', icon: <DisconnectOutlined /> },
  { key: 'highLevel', label: 'High-Level 模块', icon: <RocketOutlined /> },
];

interface Props {
  health?: HealthReport;
  loading: boolean;
  done: boolean;
  onRun: () => void;
}

// App UI:健康检查是只读状态读数(非交互),用左对齐状态列表而非居中卡片网格;
// 颜色统一走主题 token(theme.useToken),不再内联硬编码 hex。
export default function HealthStep({ health, loading, done, onRun }: Props) {
  const { token } = theme.useToken();
  return (
    <Card title="健康检查" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        录制开始前的只读前置检查:确认 Local Service、daemon、扩展与 High-Level 模块均可用。此步无会话副作用。
      </Paragraph>
      <List
        size="small"
        dataSource={ITEMS}
        renderItem={(it) => {
          const v = health?.[it.key];
          const okState = v === 'ok';
          return (
            <List.Item>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Space size={token.marginSM}>
                  <span style={{ color: okState ? token.colorSuccess : token.colorTextSecondary }}>{it.icon}</span>
                  <Text strong>{it.label}</Text>
                </Space>
                <Badge
                  status={v ? (okState ? 'success' : 'error') : 'default'}
                  text={
                    <Text className="code" type="secondary">
                      {v ?? '未检查'}
                    </Text>
                  }
                />
              </div>
            </List.Item>
          );
        }}
      />
      <Alert
        style={{ marginTop: token.marginMD }}
        type={health?.llmSynthesis ? 'success' : 'info'}
        showIcon
        icon={<RobotOutlined />}
        message={health?.llmSynthesis ? '默认 LLM 已配置（可选）' : '默认 LLM 暂不可用（不阻断）'}
        description={
          health?.llmSynthesis
            ? health.llmSynthesisMessage
            : llmSynthesisDescription(health?.llmSynthesisReason) ??
              health?.llmSynthesisMessage ??
              '健康检查完成后可继续录制；未配置 LLM 时将使用本地规则流程。'
        }
      />
      <Button type="primary" loading={loading} disabled={done} onClick={onRun} style={{ marginTop: token.marginMD }}>
        {done ? '健康检查已通过' : '运行健康检查'}
      </Button>
    </Card>
  );
}
