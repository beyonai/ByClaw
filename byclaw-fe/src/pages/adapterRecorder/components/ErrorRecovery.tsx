import { useIntl, getIntl } from '@umijs/max';
// 失败态恢复卡 —— uipro UX 规范:错误要给清晰恢复路径(重试 + 帮助),不止报错。
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Result, Space, Typography } from 'antd';
import type { RecorderError } from '../types/recorder';

const { Paragraph, Text } = Typography;

/** 错误码 → 用户可执行的恢复建议 */
const RECOVERY_HINT: Record<string, string> = {
  get page_lost() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.pageLost' });
  },
  get daemon_unavailable() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.daemonUnavailable' });
  },
  get extension_disconnected() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.extensionDisconnected' });
  },
  get verify_timeout() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.verifyTimeout' });
  },
  get invalid_state() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.invalidState' });
  },
  get validation_failed() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.validationFailed' });
  },
  get responsible_use_required() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.responsibleUse' });
  },
  get verification_required() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.verificationRequired' });
  },
  get source_changed_after_verify() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.sourceChanged' });
  },
  get save_adapter_disabled() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.saveDisabled' });
  },
  get bycli_storage_unavailable() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.storageUnavailable' });
  },
  get daemon_timeout() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.daemonTimeout' });
  },
  get daemon_protocol_error() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.daemonProtocol' });
  },
  get resource_save_failed() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.saveFailed' });
  },
  get authentication_required() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.authentication' });
  },
  get session_not_found() {
    return getIntl().formatMessage({ id: 'adapterRecorder.recovery.sessionMissing' });
  },
};

interface Props {
  error: RecorderError;

  /** 是否为会话终止级错误(failed 态),决定按钮文案 */
  terminal: boolean;
  onRetry: () => void;
  onReset: () => void;
}

export default function ErrorRecovery({ error, terminal, onRetry, onReset }: Props) {
  const intl = useIntl();
  const hint =
    error.hint ?? RECOVERY_HINT[error.code] ?? intl.formatMessage({ id: 'adapterRecorder.recovery.retryHint' });
  return (
    <Result
      status="error"
      title={error.message}
      subTitle={
        <Text className="code" type="secondary">
          {error.code}
        </Text>
      }
      extra={
        <Space direction="vertical" align="center" style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
            {hint}
          </Paragraph>
          <Space>
            {!terminal && (
              <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
                {intl.formatMessage({ id: 'employeeDetail.ttsModelRetry' })}
              </Button>
            )}
            <Button
              danger={terminal}
              type={terminal ? 'primary' : 'default'}
              icon={<ReloadOutlined />}
              onClick={onReset}
            >
              {terminal
                ? intl.formatMessage({ id: 'adapterRecorder.recovery.rebind' })
                : intl.formatMessage({ id: 'adapterRecorder.recovery.reset' })}
            </Button>
          </Space>
        </Space>
      }
    />
  );
}
