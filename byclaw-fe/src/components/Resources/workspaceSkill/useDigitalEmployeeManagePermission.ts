import { useEffect, useState } from 'react';
import { queryResourceOperationPermissions } from '@/pages/manager/service/resources';

/**
 * 查询当前用户对指定数字员工是否有「管理权限」。
 * 返回的 hasManagePermission 与后端 hasResourceManagePermission 同口径，
 * 用于在无管理权限时隐藏技能的卸载 / 删除入口（后端仍是安全边界，这里仅做 UX 收口）。
 *
 * 默认 false：权限确认前不暴露卸载/删除，避免无权限用户点击后才报错。
 */
export const useDigitalEmployeeManagePermission = (digitalEmployeeId?: string | number): boolean => {
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!digitalEmployeeId) {
      setCanManage(false);
      return () => {
        cancelled = true;
      };
    }
    queryResourceOperationPermissions({ resourceId: `${digitalEmployeeId}` })
      .then((res: any) => {
        if (cancelled) return;
        const permissions = res?.data || res || {};
        setCanManage(!!(permissions.hasManagePermission ?? permissions.canManageAuth));
      })
      .catch(() => {
        if (cancelled) return;
        setCanManage(false);
      });
    return () => {
      cancelled = true;
    };
  }, [digitalEmployeeId]);

  return canManage;
};
