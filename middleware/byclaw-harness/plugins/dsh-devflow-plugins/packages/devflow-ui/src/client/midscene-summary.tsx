/** Diagnostic projection only; conversation tools remain the action surface. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MidsceneSummary } from '@zhchxiao123/dsh-devflow-web/client'
import { NS } from './locales.ts'
import css from './board.module.css'

export function MidsceneSummarySection({ summary, t }: { summary: MidsceneSummary; t: TranslateNS<typeof NS> }) {
  return <details open>
    <summary className={css.detailSectionSummary}>{t('midscene.title')}</summary>
    {!summary.available ? <p>{t('midscene.unavailable')}</p> : <>
      {summary.profiles.length === 0 ? <p>{t('midscene.unconfigured')}</p> : summary.profiles.map(profile => <section key={profile.name}>
        <h4>{profile.name}</h4>
        <dl>
          <dt>{t('midscene.model')}</dt><dd>{profile.model} · {profile.family}</dd>
          <dt>{t('midscene.target')}</dt><dd>{profile.targetUrl} · {profile.browserMode}</dd>
          <dt>{t('midscene.login')}</dt><dd>{t(`midscene.login.${profile.login}`)}</dd>
          <dt>{t('midscene.formal')}</dt><dd>{t(profile.formalConfigured ? 'midscene.configured' : 'midscene.unconfigured')}</dd>
          <dt>{t('midscene.preflight')}</dt><dd>{profile.preflight ? `${profile.preflight.at} · ${profile.preflight.model}` : t('midscene.none')}</dd>
          <dt>{t('midscene.run')}</dt><dd>{profile.latestRun ? <>
            {profile.latestRun.status} · {profile.latestRun.at} · <code>{profile.latestRun.runId}</code>
            {profile.latestRun.reportUrl ? <> · <a href={profile.latestRun.reportUrl} target="_blank" rel="noreferrer">{t('midscene.report')}</a></> : null}
          </> : t('midscene.none')}</dd>
        </dl>
      </section>)}
      <p>{t(summary.gateEngineAvailable ? 'midscene.gateAvailable' : 'midscene.gateUnavailable')}</p>
      <h4>{t('midscene.jobs')}</h4>
      {summary.jobs.length === 0 ? <p>{t('midscene.none')}</p> : <ul>{summary.jobs.map(job => <li key={job.id}><code>{job.id}</code> · {job.status}</li>)}</ul>}
    </>}
    <p>{t('midscene.help')}</p>
  </details>
}
