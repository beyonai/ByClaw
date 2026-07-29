// 从选定 RankCandidate 派生 adapter 名(site/command)的纯函数。
// 抽出独立模块(不依赖 React / @/ 运行时)以便单测 + 跨包(be e2e)复用真链路验证。
import type { RankCandidate } from '../types/recorder';

/** slug 化:契约 adapter 名只允许 [A-Za-z0-9_-];host/路径段 → 连字符 slug。 */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 从选定候选派生 site/command(例:example.com + /api/search → example-com/search)。
 * host/pathname 缺失时分别兜底 'site'/'command',保证产出始终是合法的 site/command 两段名。 */
export function deriveAdapterName(cand: RankCandidate): string {
  const site = slug(cand.endpoint.host || '') || 'site';
  const lastSeg = (cand.endpoint.pathname || '').split('/').filter(Boolean).pop() || '';
  const command = slug(lastSeg) || 'command';
  return `${site}/${command}`;
}
