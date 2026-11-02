// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { MidsceneSummary } from '@zhchxiao123/dsh-devflow-web/client'
import { MidsceneSummarySection } from '../src/client/midscene-summary.tsx'
import { makeTranslate } from './harness-doubles.ts'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'
const t = makeTranslate(en)
afterEach(cleanup)
const empty: MidsceneSummary = { available: true, profiles: [], jobs: [], gateEngineAvailable: false }
it('keeps absent and unconfigured states explicit without mutation controls', () => {
  const { rerender } = render(<MidsceneSummarySection summary={{ ...empty, available: false }} t={t} />)
  expect(screen.getByText('Midscene summary is unavailable.')).toBeTruthy()
  rerender(<MidsceneSummarySection summary={empty} t={t} />)
  expect(screen.getByText('Configuration is incomplete for this workspace.')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
it('shows config, scoped run/report and owner job while distinguishing suite pass from completion', () => {
  const summary: MidsceneSummary = { ...empty, gateEngineAvailable: true,
    profiles: [{ name: 'local', model: 'vision', family: 'glm-v', targetUrl: 'http://app.test', browserMode: 'puppeteer', login: 'none', formalConfigured: true,
      preflight: { at: 'today', model: 'unknown' }, latestRun: { runId: 'one', at: 'today', status: 'passed', reportUrl: 'http://host.test/report' } }],
    jobs: [{ id: 'midscene-1', status: 'running' }] }
  const { rerender } = render(<MidsceneSummarySection summary={summary} t={t} />)
  expect(screen.getByText('midscene-1')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open report' }).getAttribute('href')).toBe('http://host.test/report')
  expect(screen.getByText(/does not authorize completion/)).toBeTruthy()
  delete summary.profiles[0].latestRun!.reportUrl
  rerender(<MidsceneSummarySection summary={summary} t={t} />)
  expect(screen.queryByRole('link')).toBeNull()
  delete summary.profiles[0].latestRun; delete summary.profiles[0].preflight
  summary.profiles[0].formalConfigured = false
  rerender(<MidsceneSummarySection summary={summary} t={t} />)
  expect(screen.getAllByText('No records')).toHaveLength(2)
})
