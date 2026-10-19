import { enabled } from '@byclaw/jev-client'
import type { GoalConfig } from './goal-types.js'
export const browserGoalEnabled = (env = process.env): boolean => enabled(env.BYCLAW_BROWSER_JEV_ENABLED)
export function resolveGoalConfig(env = process.env): GoalConfig {
  const integer = (name: string, fallback: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name])
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`browser-goal-config-invalid:${name}`)
    return value
  }
  const confidence = env.BYCLAW_BROWSER_JEV_MIN_CONFIDENCE === undefined ? 0.5 : Number(env.BYCLAW_BROWSER_JEV_MIN_CONFIDENCE)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('browser-goal-config-invalid:confidence')
  return { maxSteps: integer('BYCLAW_BROWSER_GOAL_MAX_STEPS', 40, 100), maxDecisions: integer('BYCLAW_BROWSER_GOAL_MAX_DECISIONS', 80, 200),
    maxRunMs: integer('BYCLAW_BROWSER_GOAL_TIMEOUT_MS', 180000, 900000), maxPauseMs: integer('BYCLAW_BROWSER_GOAL_PAUSE_TIMEOUT_MS', 120000, 300000),
    maxQueueWaitMs: integer('BYCLAW_BROWSER_GOAL_QUEUE_TIMEOUT_MS', 10000, 60000), maxTextCalls: integer('BYCLAW_BROWSER_GOAL_MAX_TEXT_CALLS', 12, 50),
    minConfidence: confidence, lockPath: env.BYCLAW_BROWSER_AUTOMATION_LOCK ?? '/run/byclaw-browser/automation.lock' }
}
