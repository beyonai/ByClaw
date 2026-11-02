import { useCallback, useEffect, useRef, useState } from 'react';
import {
  prepareEmployeeSkills,
  querySkillRuntimeStatus,
  type SkillRuntimeStatus,
} from '@/pages/manager/service/DigitalEmployeeMgr';

/** Poll only while the skill panel is mounted; discard responses from previously selected employees. */
export function useSkillRuntimeStatus(employeeId?: string | number) {
  const [status, setStatus] = useState<SkillRuntimeStatus>();
  const [retrying, setRetrying] = useState(false);
  const currentEmployee = useRef(employeeId);
  currentEmployee.current = employeeId;
  useEffect(() => {
    setStatus(undefined);
    setRetrying(false);
    if (!employeeId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await querySkillRuntimeStatus(employeeId);
        if (!disposed) setStatus(response?.code === 0 ? response.data : undefined);
      } catch {
        if (!disposed) setStatus(undefined);
      } finally {
        if (!disposed) timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [employeeId]);
  const retry = useCallback(async () => {
    if (!employeeId || retrying) return;
    setRetrying(true);
    try {
      const response = await prepareEmployeeSkills(employeeId);
      if (currentEmployee.current === employeeId && response?.code === 0) setStatus(response.data);
    } finally {
      if (currentEmployee.current === employeeId) setRetrying(false);
    }
  }, [employeeId, retrying]);
  return { status, retry, retrying };
}
