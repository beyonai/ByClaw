import { useEffect, useRef, useState } from 'react';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { Button } from 'antd';
import { CloseOutlined, WarningOutlined } from '@ant-design/icons';
import {
  checkModelHealth,
  refreshCachedModelHealth,
  MODEL_HEALTH_EVENT,
  MODEL_HEALTH_OPEN_EVENT,
  modelHealthLocation,
  updateModelHealthNotice,
  type ModelHealthItem,
  type ModelHealthReport,
} from '@/service/modelHealth';
import styles from './index.module.less';

type Props = { user: any };

export default function ModelHealthNotice({ user }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const [report, setReport] = useState<ModelHealthReport>();
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const manualScope = useRef<ModelHealthReport['scope']>();
  const t = (name: string, values?: Record<string, any>) =>
    intl.formatMessage({ id: `modelMgr.health.${name}` }, values);
  const presented = useRef('');
  const retrying = useRef(false);
  const userId = user?.userId ?? user?.id;

  useEffect(() => {
    if (userId === undefined || userId === null) {
      setReport(undefined);
      return;
    }
    setReport(undefined);
    setSelectedModelId(undefined);
    manualScope.current = undefined;
    let active = true;
    const accept = (next?: ModelHealthReport) => {
      if (!active || !next) return;
      if (manualScope.current) {
        if (manualScope.current === next.scope) setReport({ ...next, dismissed: false });
        return;
      }
      setSelectedModelId(undefined);
      setReport(next);
      const stamp = `${userId}:${next.scope}:${next.checkedAt}:${next.focusModelId ?? ''}`;
      if (!next.healthy && !next.dismissed && !next.presented && presented.current !== stamp && !retrying.current) {
        presented.current = stamp;
        updateModelHealthNotice(user, next);
        navigate(modelHealthLocation(next));
      }
    };
    const handle = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.invalidated) {
        void refreshCachedModelHealth(user, manualScope.current);
        return;
      }
      if (`${detail.userId}` === `${userId}` && `${detail.enterpriseId ?? ''}` === `${user?.enterpriseId ?? ''}`)
        accept(detail.report);
    };
    const open = async (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (`${detail.userId}` !== `${userId}` || `${detail.enterpriseId ?? ''}` !== `${user?.enterpriseId ?? ''}`)
        return;
      const cached = await refreshCachedModelHealth(user, detail.scope);
      if (!active) return;
      if (
        !cached?.models.some((item) => item.status === 'FAILED' && (!detail.modelId || item.modelId === detail.modelId))
      )
        return;
      manualScope.current = cached.scope;
      setSelectedModelId(detail.modelId);
      setExpanded(false);
      setCheckFailed(false);
      setReport({ ...cached, dismissed: false });
    };
    window.addEventListener(MODEL_HEALTH_EVENT, handle);
    window.addEventListener(MODEL_HEALTH_OPEN_EVENT, open);
    // Let the login callback finish its initial redirect before opening the affected model.
    const timer = window.setTimeout(() => {
      void checkModelHealth(user).then(accept);
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener(MODEL_HEALTH_EVENT, handle);
      window.removeEventListener(MODEL_HEALTH_OPEN_EVENT, open);
    };
  }, [userId, user?.enterpriseId, user?.userCode]);

  if (!report || report.healthy || report.dismissed) return null;
  const failures = report.models.filter(
    (model) => model.status === 'FAILED' && (!selectedModelId || model.modelId === selectedModelId)
  );
  if (!failures.length) return null;
  const canRepair = report.scope === 'PERSONAL' || user?.userCode?.toLowerCase() === 'adminvip';
  const unknown = failures.every((model) => model.errorCode === 'CHECK_UNAVAILABLE');
  const retry = async () => {
    setChecking(true);
    setCheckFailed(false);
    retrying.current = true;
    try {
      let next: ModelHealthReport | undefined;
      if (failures.every((item) => item.modelId)) {
        for (const item of failures) {
          next = await checkModelHealth(user, { force: true, modelId: item.modelId!, scope: report.scope });
          if (next) updateModelHealthNotice(user, next);
        }
      } else {
        next = await checkModelHealth(user, { force: true });
        if (next) updateModelHealthNotice(user, next);
      }
      if (!next) setCheckFailed(true);
      if (next) {
        setReport(next);
        setCheckFailed(next.models.some((item) => item.errorCode === 'CHECK_UNAVAILABLE'));
      }
    } finally {
      retrying.current = false;
      setChecking(false);
    }
  };
  const repair = (item: ModelHealthItem) => {
    manualScope.current = undefined;
    navigate(modelHealthLocation(report, item), {
      state: item.modelId ? { editModelId: item.modelId, editModelRequestId: Date.now() } : { createModel: true },
    });
  };

  return (
    <aside className={styles.notice} role="alert" aria-label={t('title', { count: failures.length })}>
      <WarningOutlined className={styles.icon} />
      <div className={styles.body}>
        <div className={styles.heading}>
          <strong>{unknown ? t('checkService') : t('title', { count: failures.length })}</strong>
          <span className={styles.scope}>{t(report.scope === 'PUBLIC' ? 'public' : 'personal')}</span>
        </div>
        <p className={styles.intro}>{t(unknown ? 'retryUnavailable' : 'intro')}</p>
        <div className={styles.models}>
          {failures.map((item, index) => (
            <div key={item.modelId || `${item.modelType}-${index}`} className={styles.model}>
              <div className={styles.modelHeading}>
                <strong>
                  {item.modelName || (item.modelType ? t('missingModel', { type: item.modelType }) : t('checkService'))}
                </strong>
                {item.modelName && <span className={styles.type}>{item.modelType}</span>}
                {canRepair && (
                  <Button type="link" size="small" onClick={() => repair(item)}>
                    {t(item.errorCode === 'MODEL_NOT_CONFIGURED' ? 'addModel' : 'configure')}
                  </Button>
                )}
              </div>
              <p>{t(`reason.${item.errorCode || 'CHECK_UNAVAILABLE'}`)}</p>
              {expanded && (
                <dl className={styles.details}>
                  {item.modelId && (
                    <>
                      <dt>{t('modelId')}</dt>
                      <dd>{item.modelId}</dd>
                    </>
                  )}
                  {item.endpoint && (
                    <>
                      <dt>{t('endpoint')}</dt>
                      <dd>{item.endpoint}</dd>
                    </>
                  )}
                  {item.httpStatus && (
                    <>
                      <dt>{t('httpStatus')}</dt>
                      <dd>{item.httpStatus}</dd>
                    </>
                  )}
                  <dt>{t('errorCode')}</dt>
                  <dd>{item.errorCode}</dd>
                </dl>
              )}
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          <Button size="small" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {t(expanded ? 'hideDetails' : 'details')}
          </Button>
          {canRepair && (
            <Button size="small" loading={checking} onClick={retry}>
              {t('retry')}
            </Button>
          )}
          <span className={styles.time}>
            {t('checkedAt', { time: intl.formatTime(report.checkedAt, { hour: '2-digit', minute: '2-digit' }) })}
          </span>
        </div>
        {checkFailed && <p className={styles.intro}>{t('retryUnavailable')}</p>}
        {!canRepair && <p className={styles.intro}>{t('contactAdmin')}</p>}
        {canRepair && location.pathname !== (report.scope === 'PUBLIC' ? '/manager/systemParams/modal' : '/models') && (
          <Button type="link" size="small" onClick={() => navigate(modelHealthLocation(report))}>
            {t('viewModels')}
          </Button>
        )}
      </div>
      <button
        type="button"
        className={styles.close}
        aria-label={t('dismiss')}
        onClick={() => {
          manualScope.current = undefined;
          updateModelHealthNotice(user, report, true);
          setReport({ ...report, dismissed: true });
        }}
      >
        <CloseOutlined />
      </button>
    </aside>
  );
}
