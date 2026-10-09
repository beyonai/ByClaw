import { CheckOutlined, CloseOutlined, LoadingOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import type { TenantItem } from '../../service/TenantMgr';
import { tenantProvisionSteps } from './provisionStatus';
import styles from './TenantProvisionProgress.module.less';

const stages = [
  { title: '创建企业与成员身份', description: '企业记录及首位 OWNER 已建立' },
  { title: '准备独立数据库', description: '数据库沙箱已分配并通过连接检查' },
  { title: '启动企业专属服务', description: '正在验证连接与服务就绪状态' },
  { title: '初始化业务数据结构', description: '完成校验后，企业状态将变为可进入' },
];

const labels = { done: '已完成', active: '进行中', pending: '待开始', failed: '失败' };

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
  const steps = tenantProvisionSteps(tenant?.provisionState || '', tenant?.provisionStage);
  return (
    <Modal
      title={tenant ? `${tenant.enterpriseName} · 开通进度` : '开通进度'}
      open={!!tenant}
      footer={
        tenant?.provisionState === 'FAILED' ? (
          <Button loading={retrying} onClick={onRetry}>
            重试开通
          </Button>
        ) : null
      }
      onCancel={onClose}
      width={680}
      destroyOnHidden
    >
      <div className={styles.summary}>
        <span>企业 ID：{tenant?.enterpriseId}</span>
        <span>套餐：{tenant?.packageName}</span>
      </div>
      <ol className={styles.timeline}>
        {stages.map((stage, index) => {
          const status = steps[index];
          return (
            <li className={`${styles.step} ${styles[status]}`} key={stage.title}>
              <div className={styles.rail}>
                <span className={styles.circle} aria-hidden="true">
                  {status === 'done' ? <CheckOutlined /> : status === 'failed' ? <CloseOutlined /> : index + 1}
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
                {status === 'failed' && tenant?.failureReason && (
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
