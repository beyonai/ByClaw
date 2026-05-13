/* eslint-disable function-paren-newline */
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@umijs/max';
import { get } from 'lodash';
import { getDcSystemConfig } from '@/pages/manager/service/session';

const ENABLE_SANDBOX_PARAM = 'ENABLE_SANDBOX';
const FROM_SANDBOX_VALUE = 'FROM_SANDBOX';

type DigitalTypeOption = { value: string; [k: string]: unknown };

/**
 * 数字员工类型选项 Hook
 * - 从 redux 获取 digitalTypeOpts、blockedPaths
 * - 请求 getDcSystemConfig(paramCode=ENABLE_SANDBOX)，仅当 paramValue="1" 时展示 FROM_SANDBOX
 * - myDigitalTypeOpts 在以上基础上再按 blockedPaths 过滤
 */
export function useDigitalTypeOptions() {
  const { digitalTypeOpts: reduxDigitalTypeOpts } = useSelector(
    (s: { employeeMgr: { digitalTypeOpts: DigitalTypeOption[] } }) => s.employeeMgr
  );
  const { blockedPaths } = useSelector((s: { menu: { blockedPaths?: string[] } }) => s.menu);

  const [enableSandbox, setEnableSandbox] = useState(false);

  useEffect(() => {
    getDcSystemConfig({ paramCode: ENABLE_SANDBOX_PARAM })
      .then((res) => {
        if (`${res.code}` === '0') {
          const paramValue = get(res, 'data.paramValue');
          setEnableSandbox(paramValue === '1');
        }
      })
      .catch(() => {
        setEnableSandbox(false);
      });
  }, []);

  /** 根据 ENABLE_SANDBOX 过滤 FROM_SANDBOX，再按 blockedPaths 过滤，得到最终选项 */
  const digitalTypeOpts = useMemo(() => {
    if (!Array.isArray(reduxDigitalTypeOpts)) return [];
    return reduxDigitalTypeOpts
      .filter((item) => (item.value === FROM_SANDBOX_VALUE ? enableSandbox : true))
      .filter((item) => !blockedPaths?.includes(item.value));
  }, [reduxDigitalTypeOpts, enableSandbox, blockedPaths]);

  return { digitalTypeOpts };
}
