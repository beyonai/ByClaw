import { useEffect, useState } from 'react';
import { queryInstalledResourceIds } from '@/pages/manager/service/DigitalEmployeeMgr';

/**
 * 查询当前用户对指定数字员工是否有「管理权限」。
 * 复用安装目标专用接口，由后端按“本人创建、显式管理授权、adminvip”统一校验，
 * 用于在无管理权限时隐藏安装、卸载和删除入口（后端仍是安全边界）。
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
    queryInstalledResourceIds({ resourceId: `${digitalEmployeeId}` })
      .then((res: any) => {
        if (cancelled) return;
        const responseCode = res?.code;
        setCanManage(responseCode === undefined || [0, 200].includes(Number(responseCode)));
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
