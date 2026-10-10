import { useIntl } from '@umijs/max';
import type { PublicationDetail } from '@/service/employeePublication';
import { getRuntimeActualUrl } from '@/utils';
import { Alert, Button } from 'antd';

export default function UpdateTargetNotice({
  detail,
  onRefresh,
  busy,
}: {
  detail: PublicationDetail;
  onRefresh?: () => void;
  busy?: boolean;
}) {
  const intl = useIntl();
  const target = detail.updateTarget;
  if (!target) return null;
  return (
    <Alert
      showIcon
      type="warning"
      style={{ margin: '12px 0' }}
      message={
        target.changed
          ? intl.formatMessage({ id: 'employeePublication.update.changed' })
          : intl.formatMessage({ id: 'employeePublication.update.target' }, { v0: target.name })
      }
      description={
        <>
          {target.changed && (
            <div>
              {intl.formatMessage({ id: 'employeePublication.update.targetLabel' })}
              {target.name}
            </div>
          )}
          <div>
            {target.fromPersonal
              ? intl.formatMessage({ id: 'employeePublication.update.fromPersonal' })
              : intl.formatMessage({ id: 'employeePublication.update.fromOfficial' })}
            {intl.formatMessage({ id: 'employeePublication.update.preserved' })}
          </div>
          <a
            href={getRuntimeActualUrl(
              `/digitalEmployeesCreate?appId=${encodeURIComponent(
                target.resourceId
              )}&readOnly=true&log=false&manage=false`
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            {intl.formatMessage({ id: 'employeePublication.update.viewCurrent' })}
          </a>
          {target.changed && (
            <div>
              {intl.formatMessage({ id: 'employeePublication.update.recheckHint' })}
              {onRefresh && (
                <Button type="link" disabled={busy} onClick={onRefresh}>
                  {intl.formatMessage({ id: 'employeePublication.update.recheck' })}
                </Button>
              )}
            </div>
          )}
        </>
      }
    />
  );
}
