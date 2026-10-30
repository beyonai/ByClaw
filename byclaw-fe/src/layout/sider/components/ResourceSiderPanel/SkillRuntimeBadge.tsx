import { Button, Space, Tag, Tooltip } from 'antd';
import { useIntl } from '@umijs/max';
import type { SkillRuntimeStatus } from '@/pages/manager/service/DigitalEmployeeMgr';

export default function SkillRuntimeBadge({
  skill,
  retry,
  retrying,
}: {
  skill?: SkillRuntimeStatus['skills'][number];
  retry: () => Promise<void>;
  retrying: boolean;
}) {
  const intl = useIntl();
  const state = skill?.state || 'UNKNOWN';
  const canRetry = state === 'FAILED' || state === 'PREPARING';
  return (
    <Space size={2} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <Tooltip
        title={
          skill?.errorCode
            ? intl.formatMessage({
              id: `skillRuntime.error.${skill.errorCode}`,
              defaultMessage: intl.formatMessage({ id: 'skillRuntime.detail' }, { code: skill.errorCode }),
            })
            : undefined
        }
      >
        <Tag color={state === 'READY' ? 'success' : state === 'FAILED' ? 'error' : 'default'}>
          {intl.formatMessage({ id: `skillRuntime.${state}` })}
        </Tag>
      </Tooltip>
      {canRetry && (
        <Button
          type="link"
          size="small"
          loading={retrying}
          onClick={() => {
            void retry().catch(() => undefined);
          }}
        >
          {intl.formatMessage({ id: 'skillRuntime.retry' })}
        </Button>
      )}
    </Space>
  );
}
