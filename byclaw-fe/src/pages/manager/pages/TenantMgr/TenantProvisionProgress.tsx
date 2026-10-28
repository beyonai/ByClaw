import { useIntl } from '@umijs/max';
import { CheckOutlined, CloseOutlined, LoadingOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Modal } from 'antd';
import type { TenantItem } from '../../service/TenantMgr';
import { tenantProvisionSteps } from './provisionStatus';
import styles from './TenantProvisionProgress.module.less';

export default function TenantProvisionProgress({
  tenant,
  onClose,
  onRetry,
  retrying,
}: {
  tenant: TenantItem | null;
  onClose: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const intl = useIntl();
  const stages = [
    {
      title: intl.formatMessage({ id: 'tenant.progress.identity' }),
      description: intl.formatMessage({ id: 'tenant.progress.identityDescription' }),
    },
    {
      title: intl.formatMessage({ id: 'tenant.progress.database' }),
      description: intl.formatMessage({ id: 'tenant.progress.databaseDescription' }),
    },
    {
      title: intl.formatMessage({ id: 'tenant.progress.service' }),
      description: intl.formatMessage({ id: 'tenant.progress.serviceDescription' }),
    },
    {
      title: intl.formatMessage({ id: 'tenant.progress.schema' }),
      description: intl.formatMessage({ id: 'tenant.progress.schemaDescription' }),
    },
  ];

  const labels = {
    done: intl.formatMessage({ id: 'tenant.progress.done' }),
    active: intl.formatMessage({ id: 'tenant.progress.active' }),
    pending: intl.formatMessage({ id: 'tenant.progress.pending' }),
    failed: intl.formatMessage({ id: 'tenant.progress.failed' }),
    paused: intl.formatMessage({ id: 'tenant.progress.paused' }),
  };

  const steps = tenantProvisionSteps(tenant?.provisionState || '', tenant?.provisionStage);
  return (
    <Modal
      title={
        tenant
          ? intl.formatMessage({ id: 'tenant.progressTitle' }, { name: tenant.enterpriseName })
          : intl.formatMessage({ id: 'tenant.progress.title' })
      }
      open={!!tenant}
      footer={
        tenant?.provisionState === 'FAILED' ? (
          <Button loading={retrying} onClick={onRetry}>
            {intl.formatMessage({ id: 'tenant.progress.retry' })}
          </Button>
        ) : null
      }
      onCancel={onClose}
      width={680}
      destroyOnHidden
    >
      <div className={styles.summary}>
        <span>{intl.formatMessage({ id: 'tenant.enterpriseSummary' }, { id: tenant?.enterpriseId })}</span>
        <span>{intl.formatMessage({ id: 'tenant.packageSummary' }, { name: tenant?.packageName })}</span>
      </div>
      {tenant?.provisionState === 'MANUAL_REQUIRED' && (
        <Alert
          type="warning"
          showIcon
          className={styles.notice}
          message={intl.formatMessage({ id: 'tenant.progress.manualRequired' })}
        />
      )}
      <ol className={styles.timeline}>
        {stages.map((stage, index) => {
          const status = steps[index];
          return (
            <li className={`${styles.step} ${styles[status]}`} key={stage.title}>
              <div className={styles.rail}>
                <span className={styles.circle} aria-hidden="true">
                  {status === 'done' ? (
                    <CheckOutlined />
                  ) : status === 'failed' ? (
                    <CloseOutlined />
                  ) : status === 'paused' ? (
                    <PauseCircleOutlined />
                  ) : (
                    index + 1
                  )}
                </span>
              </div>
              <div className={styles.content}>
                <div className={styles.heading}>
                  <strong>{stage.title}</strong>
                  <span className={styles.badge}>
                    {status === 'active' && <LoadingOutlined spin />}
                    {labels[status]}
                  </span>
                </div>
                <p>{stage.description}</p>
                {(status === 'failed' || status === 'paused') && tenant?.failureReason && (
                  <p className={styles.failure}>{tenant.failureReason}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
