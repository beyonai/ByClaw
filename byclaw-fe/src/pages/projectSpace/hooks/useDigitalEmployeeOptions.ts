import { useCallback, useEffect, useState } from 'react';
import { queryMyCreatedAndSubscribedAgentsV2 } from '@/service/digitalEmployees';

export interface DigitalEmployeeOption {
  value: string;
  label: string;
  keywords?: string;
}

const pickArray = (...candidates: any[]): any[] => candidates.find((item) => Array.isArray(item)) || [];

// 复用「我创建+订阅」的数字员工分页接口(同运营任务选择器数据源),归一为下拉选项。
// enabled 用于弹窗未打开时不发请求。
export const useDigitalEmployeeOptions = (enabled: boolean) => {
  const [options, setOptions] = useState<DigitalEmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await queryMyCreatedAndSubscribedAgentsV2({ pageNum: 1, pageSize: 100 });
      const list = pickArray(res?.list, res?.data?.list, res?.rows, res?.data?.rows);
      setOptions(
        list
          .map((agent: any) => {
            const value = agent.resourceId ?? agent.agentId ?? agent.id;
            const label = agent.agentName || agent.resourceName || agent.name || '';
            return {
              value: value === undefined || value === null ? '' : `${value}`,
              label,
              keywords: [agent.agentName, agent.resourceName, agent.name, agent.description].filter(Boolean).join(' '),
            };
          })
          .filter((option: DigitalEmployeeOption) => option.value && option.label)
      );
    } catch (error) {
      console.error('Failed to load digital employee options:', error);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchOptions();
  }, [enabled, fetchOptions]);

  return { options, loading };
};
