/** WorkBuddy-shaped expert group strip backed by Harness-native child sessions. */

import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActivityTeam } from './ActivityPanel.tsx'
import { LEAD_ART, memberArtUrl } from './artwork.ts'
import { expertState, teamForParent, type ExpertVisualState } from './expert-team-model.ts'
import css from './ExpertTeamDock.module.css'

const STATE_URL = '/plugins/dsh-agent-teams/state'
const POLL_MS = 1000

export interface ExpertTeamDockInjected {
  readonly openSession: (id: SessionId) => void
}

export type ExpertTeamDockProps = PropsRuntime<'conversation.input.dock'> & ExpertTeamDockInjected

const STATE_LABEL: Record<ExpertVisualState, string> = {
  working: '执行中',
  failed: '失败',
  completed: '完成',
  waiting: '等待',
  idle: '待命',
}

function fallbackInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

export function ExpertTeamDock({ sessionId, openSession }: ExpertTeamDockProps) {
  const [teams, setTeams] = useState<ActivityTeam[]>([])
  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(STATE_URL, { cache: 'no-store' })
        if (!response.ok) return
        const value = await response.json() as { teams?: ActivityTeam[] }
        if (active) setTeams(Array.isArray(value.teams) ? value.teams : [])
      } catch {
        // The dock is optional in webless/transient boot states.
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const team = teamForParent(teams, String(sessionId))
  if (team === undefined) return null
  const completed = team.tasks.filter(task => task.status === 'completed').length
  return (
    <section className={css.dock} aria-label={`${team.name} 专家团`} data-agent-team-dock={team.teamId}>
      <div className={css.heading}>
        <span className={css.title}>{team.name}</span>
        <span className={css.progress}>{completed}/{team.tasks.length} 任务完成</span>
      </div>
      <div className={css.experts}>
        <span className={css.expert} data-state="captain" title="父会话 · 拆解、派发、汇总">
          <img className={css.avatar} src={LEAD_ART} alt="" aria-hidden />
          <span className={css.copy}><strong>交付队长</strong><small>父会话</small></span>
          <span className={css.check}>◆</span>
        </span>
        {team.members.map((member) => {
          const state = expertState(member, team.tasks)
          const artwork = memberArtUrl(member.name, member.role)
          return (
            <button
              type="button"
              className={css.expert}
              data-state={state}
              key={member.id}
              disabled={member.id === ''}
              onClick={() => { if (member.id !== '') openSession(member.id as SessionId) }}
              title={`打开子会话：${member.name}${member.role === '' ? '' : ` · ${member.role}`}`}
            >
              {artwork === null
                ? <span className={css.fallback}>{fallbackInitial(member.name)}</span>
                : <img className={css.avatar} src={artwork} alt="" aria-hidden />}
              <span className={css.copy}><strong>{member.name}</strong><small>{member.role || '专家成员'}</small></span>
              <span className={css.check} aria-label={STATE_LABEL[state]}>{state === 'completed' ? '✓' : state === 'failed' ? '!' : state === 'working' ? '●' : '○'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
