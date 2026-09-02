import type { TesterConfig } from './types';

// 默认配置:每日 02:00 批量集成、需求全 coded 才纳入、失败按图自动打回、最多 3 轮。
// agentId 留空=沿用全局「测试数字员工」默认(卡片与弹框回填 resolveDefaultAgent 解析出的名字)。
export const DEFAULT_TESTER_CONFIG: TesterConfig = {
  enabled: true,
  schedule: { cron: '0 2 * * *', cronLabel: '每日 02:00', timezone: 'Asia/Shanghai' },
  admission: { requireAllCoded: true, maxConcurrentReqs: 2 },
  kickback: { autoAttribute: true, createDefectWhenUnclear: true, maxRounds: 3 },
};
