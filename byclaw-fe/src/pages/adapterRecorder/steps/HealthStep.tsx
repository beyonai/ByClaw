// Step 1 · 健康检查 —— health(daemon/extension/high-level 健康状态列表)
import { ApiOutlined, CloudServerOutlined, DisconnectOutlined, RobotOutlined, RocketOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Card, List, Space, Typography, theme } from 'antd';
import type { HealthReport } from '../types/recorder';

const { Text, Paragraph } = Typography;

const LLM_SYNTHESIS_DESCRIPTIONS: Record<string, string> = {
  default_model_not_found: '未找到已启用的默认 LLM 模型；可继续使用本地规则流程。',
  default_model_list_lookup_failed: '默认模型列表查询失败；可继续使用本地规则流程。',
  default_model_detail_lookup_failed: '默认模型详情查询失败；可继续使用本地规则流程。',
  default_model_detail_unavailable: '默认模型详情不可用；可继续使用本地规则流程。',
  default_model_endpoint_missing: '默认模型缺少服务地址；可继续使用本地规则流程。',
  default_model_token_missing: '默认模型缺少服务端凭据；可继续使用本地规则流程。',
  default_model_code_missing: '默认模型缺少模型编码；可继续使用本地规则流程。',
  default_model_lookup_failed: '默认模型查询失败；可继续使用本地规则流程。',
};

export function llmSynthesisDescription(reason?: string): string | undefined {
  return reason ? LLM_SYNTHESIS_DESCRIPTIONS[reason] : undefined;
}

const REQUIRED_ITEMS: Array<{
  key: 'localService' | 'daemon' | 'extension' | 'highLevel';
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'localService', label: 'Local Service', icon: <CloudServerOutlined /> },
  { key: 'daemon', label: 'byCLI Daemon', icon: <ApiOutlined /> },
  { key: 'extension', label: 'Chrome 扩展', icon: <DisconnectOutlined /> },
  { key: 'highLevel', label: 'High-Level 模块', icon: <RocketOutlined /> },
];

export function requiredHealthChecksPass(health?: HealthReport): boolean {
  return (
    health?.localService === 'ok' && health.daemon === 'ok' && health.extension === 'ok' && health.highLevel === 'ok'
  );
}

export function llmHealthStatus(health?: HealthReport): '未检查' | '可用' | '不可用' {
  if (health?.llmSynthesis === undefined) return '未检查';
  return health.llmSynthesis ? '可用' : '不可用';
}

export function shouldShowLlmUnavailableAlert(health?: HealthReport): boolean {
  return health?.llmSynthesis === false;
}

function llmHealthDescription(health?: HealthReport): string | undefined {
  if (health?.llmSynthesis) return health.llmSynthesisMessage;
  const reason =
    llmSynthesisDescription(health?.llmSynthesisReason) ?? health?.llmSynthesisMessage ?? '将使用本地规则流程。';
  return `${reason} 仍可使用本地规则评分和本地脚本生成。`;
}

interface Props {
  health?: HealthReport;
  loading: boolean;
  onRun: () => void;
  onNext: () => void;
}

// App UI:健康检查是只读状态读数(非交互),用左对齐状态列表而非居中卡片网格;
// 颜色统一走主题 token(theme.useToken),不再内联硬编码 hex。
export default function HealthStep({ health, loading, onRun, onNext }: Props) {
  const { token } = theme.useToken();
  const requiredChecksPass = requiredHealthChecksPass(health);
  const llmStatus = llmHealthStatus(health);
  const llmDescription = llmHealthDescription(health);
  return (
    <Card title="健康检查" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        录制开始前的只读前置检查:确认 Local Service、daemon、扩展与 High-Level 模块均可用。此步无会话副作用。
      </Paragraph>
      <List
        size="small"
        dataSource={REQUIRED_ITEMS}
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
      <List
        size="small"
        dataSource={[{ key: 'llm', label: '默认 LLM', icon: <RobotOutlined /> }]}
        renderItem={(it) => (
          <List.Item>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Space size={token.marginSM}>
                <span style={{ color: llmStatus === '可用' ? token.colorSuccess : token.colorTextSecondary }}>
                  {it.icon}
                </span>
                <Text strong>{it.label}</Text>
              </Space>
              <Badge
                status={llmStatus === '可用' ? 'success' : llmStatus === '不可用' ? 'warning' : 'default'}
                text={
                  <Text className="code" type="secondary">
                    {llmStatus}
                  </Text>
                }
              />
            </div>
          </List.Item>
        )}
      />
      {shouldShowLlmUnavailableAlert(health) ? (
        <Alert
          style={{ marginTop: token.marginMD }}
          type="info"
          showIcon
          icon={<RobotOutlined />}
          message="未检测到可用默认 LLM"
          description={llmDescription}
        />
      ) : null}
      {health && !requiredChecksPass ? (
        <Alert
          style={{ marginTop: token.marginMD }}
          type="warning"
          showIcon
          message="必需服务检查未通过"
          description="请修复 Local Service、byCLI Daemon、Chrome 扩展和 High-Level 模块后重新运行健康检查。"
        />
      ) : null}
      <Space style={{ marginTop: token.marginMD, width: '100%', justifyContent: 'space-between' }}>
        <Button type="primary" loading={loading} onClick={onRun}>
          运行健康检查
        </Button>
        {requiredChecksPass ? (
          <Button disabled={loading} onClick={onNext}>
            下一步
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
