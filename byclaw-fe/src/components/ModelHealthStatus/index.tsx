import { WarningOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { openCachedModelHealth, type HealthUser, type ModelHealthReport } from '@/service/modelHealth';
import styles from './index.module.less';

type Props = { user: HealthUser; report?: ModelHealthReport };

export function ModelHealthSummary({ user, report, reports }: Props & { reports?: (ModelHealthReport | undefined)[] }) {
  const intl = useIntl();
  const groups = (reports || [report]).flatMap((cached) => {
    const count = cached?.models.filter((model) => model.status === 'FAILED').length || 0;
    if (!cached || !count) return [];
    return [
      {
        scope: cached.scope,
        count,
        name: intl.formatMessage({ id: `modelMgr.health.${cached.scope.toLowerCase()}` }),
      },
    ];
  });
  const count = groups.reduce((total, group) => total + group.count, 0);
  if (!count) return null;
  return (
    <div className={styles.summary} role="status">
      <WarningOutlined />
      <span>
        {intl.formatMessage(
          { id: reports ? 'modelMgr.health.cachedSummary' : 'modelMgr.health.cachedScopeSummary' },
          { count, scope: groups[0].name }
        )}
      </span>
      <div className={styles.summaryActions}>
        {groups.map((group) => (
          <button key={group.scope} type="button" onClick={() => openCachedModelHealth(user, group.scope)}>
            {intl.formatMessage(
              { id: reports ? 'modelMgr.health.scopeIssues' : 'modelMgr.health.viewDiagnostics' },
              { scope: group.name, count: group.count }
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ModelHealthBadge({ user, report, modelId }: Props & { modelId: string | number }) {
  const intl = useIntl();
  const item = report?.models.find((model) => model.modelId === `${modelId}` && model.status === 'FAILED');
  if (!report || !item) return null;
  return (
    <button
      type="button"
      className={styles.badge}
      title={intl.formatMessage({ id: `modelMgr.health.reason.${item.errorCode || 'CHECK_UNAVAILABLE'}` })}
      aria-label={intl.formatMessage({ id: 'modelMgr.health.statusLabel' }, { name: item.modelName || `${modelId}` })}
      onClick={(event) => {
        event.stopPropagation();
        openCachedModelHealth(user, report.scope, `${modelId}`);
      }}
    >
      <WarningOutlined />
      {intl.formatMessage({
        id: `modelMgr.health.${item.errorCode === 'CHECK_UNAVAILABLE' ? 'statusUnknown' : 'cachedFailure'}`,
      })}
    </button>
  );
}
