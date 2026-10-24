import { Badge } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import useCachedModelHealth from '@/hooks/useCachedModelHealth';

export default function ModelHealthMenuBadge({ className }: { className?: string }) {
  const user = useSelector(({ user }: any) => user.userInfo);
  const personal = useCachedModelHealth(user, 'PERSONAL');
  const publicReport = useCachedModelHealth(user, 'PUBLIC');
  const count = [personal, publicReport].reduce(
    (total, report) => total + (report?.models.filter((item) => item.status === 'FAILED').length || 0),
    0
  );
  const intl = useIntl();
  return (
    <Badge
      className={className}
      count={count}
      size="small"
      title={intl.formatMessage({ id: 'modelMgr.health.menuFailures' }, { count })}
    />
  );
}
