import { useIntl, getIntl } from '@umijs/max';
// Step 1 · 健康检查 —— health(daemon/extension/high-level 健康状态列表)
import { ApiOutlined, CloudServerOutlined, DisconnectOutlined, RobotOutlined, RocketOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Card, List, Space, Typography, theme } from 'antd';
import type { HealthReport } from '../types/recorder';

const { Text, Paragraph } = Typography;

// 延迟读取文案，切换语言后无需重新加载模块。
const LLM_SYNTHESIS_DESCRIPTIONS: Record<string, string> = {
  get default_model_not_found() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.modelMissing' });
  },
  get default_model_list_lookup_failed() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.modelListFailed' });
  },
  get default_model_detail_lookup_failed() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.modelDetailsFailed' });
  },
  get default_model_detail_unavailable() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.modelUnavailable' });
  },
  get default_model_endpoint_missing() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.endpointMissing' });
  },
  get default_model_token_missing() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.credentialsMissing' });
  },
  get default_model_code_missing() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.codeMissing' });
  },
  get default_model_lookup_failed() {
    return getIntl().formatMessage({ id: 'adapterRecorder.health.modelLookupFailed' });
  },
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
  {
    key: 'extension',
    get label() {
      return getIntl().formatMessage({ id: 'adapterRecorder.health.extension' });
    },
    icon: <DisconnectOutlined />,
  },
  {
    key: 'highLevel',
    get label() {
      return getIntl().formatMessage({ id: 'adapterRecorder.health.highLevel' });
    },
    icon: <RocketOutlined />,
  },
];

export function requiredHealthChecksPass(health?: HealthReport): boolean {
  return (
    health?.localService === 'ok' && health.daemon === 'ok' && health.extension === 'ok' && health.highLevel === 'ok'
  );
}

export function llmHealthStatus(health?: HealthReport): string {
  if (health?.llmSynthesis === undefined) return getIntl().formatMessage({ id: 'adapterRecorder.health.unchecked' });
  return health.llmSynthesis
    ? getIntl().formatMessage({ id: 'adapterRecorder.health.available' })
    : getIntl().formatMessage({ id: 'adapterRecorder.health.unavailable' });
}

export function shouldShowLlmUnavailableAlert(health?: HealthReport): boolean {
  return health?.llmSynthesis === false;
}

function llmHealthDescription(health?: HealthReport): string | undefined {
  if (health?.llmSynthesis) return health.llmSynthesisMessage;
  const reason =
    llmSynthesisDescription(health?.llmSynthesisReason) ??
    health?.llmSynthesisMessage ??
    getIntl().formatMessage({ id: 'adapterRecorder.health.localFallback' });
  return getIntl().formatMessage({ id: 'adapterRecorder.health.localAvailable' }, { v0: reason });
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
  const intl = useIntl();
  const { token } = theme.useToken();
  const requiredChecksPass = requiredHealthChecksPass(health);
  const llmStatus = llmHealthStatus(health);
  const llmDescription = llmHealthDescription(health);
  return (
    <Card title={intl.formatMessage({ id: 'adapterRecorder.step.health' })} variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        {intl.formatMessage({ id: 'adapterRecorder.health.description' })}
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
                      {v ?? intl.formatMessage({ id: 'adapterRecorder.health.unchecked' })}
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
        dataSource={[
          {
            key: 'llm',
            label: intl.formatMessage({ id: 'adapterRecorder.health.defaultLlm' }),
            icon: <RobotOutlined />,
          },
        ]}
        renderItem={(it) => (
          <List.Item>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Space size={token.marginSM}>
                <span style={{ color: health?.llmSynthesis === true ? token.colorSuccess : token.colorTextSecondary }}>
                  {it.icon}
                </span>
                <Text strong>{it.label}</Text>
              </Space>
              <Badge
                status={
                  health?.llmSynthesis === true ? 'success' : health?.llmSynthesis === false ? 'warning' : 'default'
                }
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
          message={intl.formatMessage({ id: 'adapterRecorder.health.noLlm' })}
          description={llmDescription}
        />
      ) : null}
      {health && !requiredChecksPass ? (
        <Alert
          style={{ marginTop: token.marginMD }}
          type="warning"
          showIcon
          message={intl.formatMessage({ id: 'adapterRecorder.health.requiredUnavailable' })}
          description={intl.formatMessage({ id: 'adapterRecorder.health.repairHint' })}
        />
      ) : null}
      <Space style={{ marginTop: token.marginMD, width: '100%', justifyContent: 'space-between' }}>
        <Button type="primary" loading={loading} onClick={onRun}>
          {intl.formatMessage({ id: 'adapterRecorder.health.run' })}
        </Button>
        {requiredChecksPass ? (
          <Button disabled={loading} onClick={onNext}>
            {intl.formatMessage({ id: 'projectSpace.onboarding.action.next' })}
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
