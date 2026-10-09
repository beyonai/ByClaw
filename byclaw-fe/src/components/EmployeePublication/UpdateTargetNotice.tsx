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
  const target = detail.updateTarget;
  if (!target) return null;
  return (
    <Alert
      showIcon
      type="warning"
      style={{ margin: '12px 0' }}
      message={target.changed ? '官方员工配置已变化，需要重新确认' : `将更新官方员工：${target.name}`}
      description={
        <>
          {target.changed && <div>将更新官方员工：{target.name}</div>}
          <div>
            {target.fromPersonal
              ? '本次以个人员工已保存的配置为起点，审核通过后覆盖该企业副本的基础信息、角色与能力配置及关联资源。企业副本单独调整过的这些内容也可能被替换。'
              : '审核通过后，待发布配置将替换该企业副本的基础信息、角色与能力配置及关联资源。'}
            员工 ID 和授权保留，个人员工的后续修改不会自动同步到本次申请。
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
            查看当前官方配置
          </a>
          {target.changed && (
            <div>
              请先核对当前官方配置，再重新对照并确认覆盖范围。重新对照保留本页待发布配置，不会提交申请。
              {onRefresh && (
                <Button type="link" disabled={busy} onClick={onRefresh}>
                  重新对照官方配置
                </Button>
              )}
            </div>
          )}
        </>
      }
    />
  );
}
