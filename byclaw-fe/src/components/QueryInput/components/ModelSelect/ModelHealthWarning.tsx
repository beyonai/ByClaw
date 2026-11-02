import { WarningOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useIntl } from '@umijs/max';
import useCachedModelHealth from '@/hooks/useCachedModelHealth';
import { openCachedModelHealth, type HealthUser } from '@/service/modelHealth';
import styles from './index.less';

type Props = {
  user?: HealthUser;
  model?: { id: string; label: string; source: 'local' | 'mine' | 'public' };
};

/** Compact last-known warning; it never probes or blocks sending. */
export default function ModelHealthWarning({ user, model }: Props) {
  const intl = useIntl();
  const scope = model?.source === 'public' ? 'PUBLIC' : 'PERSONAL';
  const report = useCachedModelHealth(model?.source === 'local' ? undefined : user, scope);
  const failure = report?.models.find((item) => item.modelId === model?.id && item.status === 'FAILED');
  if (!model || !user || model.source === 'local' || !failure) return null;
  const reason = intl.formatMessage({ id: `modelMgr.health.reason.${failure.errorCode || 'CHECK_UNAVAILABLE'}` });
  return (
    <Tooltip
      trigger={['hover']}
      title={
        <div className={styles.healthTooltip}>
          <div className={styles.healthTooltipTitle}>{intl.formatMessage({ id: 'modelMgr.health.cachedFailure' })}</div>
          <div>{reason}</div>
          <div>{intl.formatMessage({ id: 'modelMgr.health.viewDiagnostics' })}</div>
        </div>
      }
    >
      <WarningOutlined
        className={styles.healthIcon}
        aria-label={`${model.label}: ${reason}`}
        onClick={(event) => {
          event.stopPropagation();
          openCachedModelHealth(user, scope, model.id);
        }}
      />
    </Tooltip>
  );
}
