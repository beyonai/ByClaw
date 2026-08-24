import { useCallback, useEffect, useState } from 'react';
import { getAllDigitalEmployeesV2, queryMyCreated } from '@/service/digitalEmployees';

export interface DigitalEmployeeOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
  // 接口原样的头像值,不在这里拼 URL:渲染侧统一走 getAgentChatAvatar,
  // 与「数字员工」页两个 Tab 用同一条管道(圆形头像、icon- 字体图标、默认头像兜底)。
  // chatAvatar 优先(两个列表接口都返回它),缺失才退企业/个人列表各自的图片字段。
  chatAvatar?: string;
  // 接口原样的 agentType。「去聊天」构造输入框 mention 时要用真实类型:
  // 这两个列表接口的员工不在 redux 的 employees 列表里,输入框查不到就会兜底成「AI 助手」,
  // 所以名字/头像/类型都得由这里带过去,不能让渲染侧自己去查。
  agentType?: string;
}

const pickArray = (...candidates: any[]): any[] => candidates.find((item) => Array.isArray(item)) || [];

// 复用“员工”模块的个人助理和数字员工两个 Tab 数据源，并归一为项目下拉选项。
// enabled 用于弹窗未打开时不发请求。
export const useDigitalEmployeeOptions = (enabled: boolean) => {
  const [options, setOptions] = useState<DigitalEmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [personalRes, enterpriseRes] = await Promise.all([
        queryMyCreated({
          pageNum: 1,
          pageSize: 100,
          terminals: ['ALL', 'PC', 'APP'],
          resourceStatus: '2',
        }),
        getAllDigitalEmployeesV2({
          pageNum: 1,
          pageSize: 100,
          ownerType: 'enterprise',
          resourceStatus: '2',
          orderField: 'updateTime',
          orderBy: 'desc',
        }),
      ]);
      const list = [
        ...pickArray(personalRes?.list, personalRes?.data?.list, personalRes?.rows, personalRes?.data?.rows),
        ...pickArray(enterpriseRes?.list, enterpriseRes?.data?.list, enterpriseRes?.rows, enterpriseRes?.data?.rows),
      ];
      const optionMap = new Map<string, DigitalEmployeeOption>();
      list.forEach((agent: any) => {
        const value = agent.resourceId ?? agent.agentId ?? agent.id;
        const label = agent.agentName || agent.resourceName || agent.name || '';
        if (value === undefined || value === null || !label) return;
        const optionValue = `${value}`;
        if (optionMap.has(optionValue)) return;
        optionMap.set(optionValue, {
          value: optionValue,
          label,
          description: agent.resourceDesc || agent.description || agent.desc || agent.intro || '',
          keywords: [agent.agentName, agent.resourceName, agent.name, agent.resourceDesc, agent.description, agent.desc]
            .filter(Boolean)
            .join(' '),
          chatAvatar: agent.chatAvatar || agent.resourceLogoUrl || agent.avatar || undefined,
          agentType: agent.agentType || undefined,
        });
      });
      setOptions(Array.from(optionMap.values()));
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
