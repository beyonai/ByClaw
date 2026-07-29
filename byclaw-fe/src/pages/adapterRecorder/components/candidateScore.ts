/* eslint-disable lines-around-comment */
// 候选双维评分推导(纯函数,无 UI/运行时依赖)——便于单测且供 CandidateCard/PipelineStep 复用。
// 只 type-import(运行时擦除),故根 vitest(node 环境、无 @ 别名解析)可直接测。
import type { Confidence, RankCandidate } from '../types/recorder';

/**
 * LLM 效用分(0–100)→ confidence 档位(仅用于配色/标签,非权威)。
 * 权威分自带 confidence band(be 计算);LLM 效用是模型自报,前端按阈值归档展示。
 * 不产出 'rejected'(效用分是辅助建议,不做硬拒)。
 */
export function utilityBand(score: number): Confidence {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export interface ScoreDimension {
  /** 0–100 分值 */
  score: number;

  /** confidence 档位(高/中/低/拒绝),决定配色与档位标签 */
  band: Confidence;
}

/**
 * 把候选的双维评分拆成可展示的两个独立维度:
 *  - rank:be 权威双轨分(规则 + 受限语义加成),自带 confidence band。决定排序/自动生成。
 *  - utility:LLM 自报效用分(可选)。仅在 llmUtilityScore 存在时返回(LLM-off/规则路径无此维度)。
 * 纯函数,便于单测「有 llmUtilityScore → 两维、无 → 仅 rank」。
 */
export function candidateScoreDimensions(c: Pick<RankCandidate, 'score' | 'confidence' | 'llmUtilityScore'>): {
  rank: ScoreDimension;
  utility?: ScoreDimension;
} {
  const rank: ScoreDimension = { score: c.score, band: c.confidence };
  if (c.llmUtilityScore === null || c.llmUtilityScore === undefined) return { rank };
  return { rank, utility: { score: c.llmUtilityScore, band: utilityBand(c.llmUtilityScore) } };
}
