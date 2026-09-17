#!/usr/bin/env node
/**
 * granularity-repair.mjs — 单调收紧 requiredContentGranularity。
 *
 * 存在理由:用户明确要求全文、但会话以 any 初始化时,public-collect 的前置条件
 * (probe-state.mjs:118-121)会抛 PUBLIC_COLLECT_SESSION_INVALID,而既有契约同时禁止
 * 新建 -v2 兄弟会话来绕过。retighten 在原会话上就地修正该字段,使死路重新可走。
 *
 * 只允许 any → full-text。反向必须拒绝:收紧只会让可宣称的结果集变小
 * (delivery-state.mjs:76 与 :80-81 两个分支都只会更难满足),放松则等于
 * 「把标准挪到产物上」,正是粒度门禁要防的伪造。
 *
 * 本命令只写 task.requiredContentGranularity 与 task.granularityHistory 两个字段:
 * 不动 inventory、不动 topic relevance、不动 fullTextEvidence,也不碰 session.delivery
 * (拒绝条件 3、4 已保证此时不可能存在活的 receipt,详见设计 §2.2.2)。
 */
'use strict';
import {
  loadSession,
  persistSession,
  withSessionLock,
} from './session.mjs';
import { hasBusinessArtifacts } from './probe-state.mjs';

const GRANULARITIES = new Set(['any', 'full-text']);

export function cmdRetighten(paths, args) {
  return withSessionLock(paths, 'retighten', () => {
    const { session } = loadSession(paths, { persistMigration: true });
    const requested = typeof args['required-content-granularity'] === 'string'
      ? args['required-content-granularity'].trim()
      : '';
    if (!GRANULARITIES.has(requested)) {
      throw new Error(`--required-content-granularity 必须是 ${[...GRANULARITIES].join(' 或 ')}`);
    }
    const current = session.task?.requiredContentGranularity || 'any';

    // 条件 1: 只允许 any → full-text
    if (!(current === 'any' && requested === 'full-text')) {
      throw new Error('RETIGHTEN_NOT_MONOTONIC: 只允许 any → full-text;'
        + `当前 ${current},请求 ${requested}。放松粒度等于把标准挪到产物上,必须拒绝`);
    }

    // 条件 2: 尊重 public-collect 的单写者租约(router 也会独立拦一次,此处为纵深防御)
    if (session.task?.activeOrchestrationRunId) {
      throw new Error(`ORCHESTRATION_IN_PROGRESS: run=${session.task.activeOrchestrationRunId}`);
    }

    // 条件 3: 已交付的会话不可就地修复
    if (session.delivery && session.delivery.status !== 'failed') {
      throw new Error(`RETIGHTEN_DELIVERY_PRESENT: 已存在 status=${session.delivery.status} 的交付 receipt;`
        + '已交付的会话不可就地修改粒度标准');
    }

    // 条件 5: candidates 会话不登记正文,收紧会使其永久无法完成(设计 §2.2.1)
    if ((session.task?.materializationTarget || 'selected') === 'candidates') {
      throw new Error('RETIGHTEN_TARGET_HAS_NO_BODIES: candidates 会话不登记正文,'
        + 'full-text 对它不是更严格的标准而是不可满足的标准;收紧只适用于 selected 与 all');
    }

    // 条件 4: 只改字段而不能真正解锁 public-collect 时,必须拒绝而不是谎报成功
    if (hasBusinessArtifacts(session)) {
      throw new Error('RETIGHTEN_SESSION_NOT_FRESH: 会话已有业务产物,'
        + 'public-collect 仍会因 SESSION_NOT_FRESH 拒绝;'
        + '本会话无法承载 public-collect run,请如实上报该缺口');
    }

    const at = new Date().toISOString();
    session.task.requiredContentGranularity = requested;
    const history = Array.isArray(session.task.granularityHistory)
      ? session.task.granularityHistory
      : [];
    history.push({ from: current, to: requested, at });
    session.task.granularityHistory = history;
    persistSession(paths, session);

    return {
      ok: true,
      action: 'retighten',
      task: {
        requiredContentGranularity: requested,
        materializationTarget: session.task.materializationTarget,
        granularityHistory: session.task.granularityHistory,
      },
      warnings: [],
    };
  });
}
