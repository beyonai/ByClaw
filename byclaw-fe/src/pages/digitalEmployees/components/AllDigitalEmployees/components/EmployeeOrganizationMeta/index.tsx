import type { IAgent } from '@/typescript/agent';
import { useIntl } from '@umijs/max';
import { Tooltip } from 'antd';
import styles from './index.module.less';

export default function EmployeeOrganizationMeta({
  organizations,
}: {
  organizations: IAgent['audienceOrganizations'];
}) {
  const intl = useIntl();
  const names = (organizations || []).map((org) =>
    org.orgId === '-1' ? intl.formatMessage({ id: 'employeePublication.audience.all' }) : org.orgName
  );
  const visibleNames = names.slice(0, 2).join('、');
  return (
    <div className={styles.meta}>
      <span className={styles.label}>{intl.formatMessage({ id: 'digitalEmployees.audienceOrganizations' })}：</span>
      <Tooltip title={names.length ? names.join('、') : undefined}>
        <span className={styles.value}>
          <span className={styles.names}>
            {visibleNames || intl.formatMessage({ id: 'digitalEmployees.audienceOrganizations.unset' })}
          </span>
          {names.length > 2 && <span className={styles.more}>+{names.length - 2}</span>}
        </span>
      </Tooltip>
    </div>
  );
}
