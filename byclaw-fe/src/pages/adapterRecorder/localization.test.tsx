import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { FLOW_STEPS, getInvalidStateHint } from './constants/recorder';
import { DraftCard } from './steps/pipelineShared';
import type { PipelineDraft } from './types/recorder';
import ErrorRecovery from './components/ErrorRecovery';
import CaptureStep from './steps/CaptureStep';
import HealthStep, { llmHealthStatus, requiredHealthChecksPass } from './steps/HealthStep';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
  getIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
jest.mock('./steps/VncFrame', () => () => <div data-testid="recording-preview" />);

beforeEach(() => {
  mockLocale = 'zh-CN';
});

it('changes step labels and recovery guidance without reloading constants or changing protocol states', () => {
  const originalStates = FLOW_STEPS.map(({ key, enterState, doneState }) => ({ key, enterState, doneState }));
  expect(FLOW_STEPS[0].title).toBe('健康检查');
  const chineseHint = getInvalidStateHint();
  mockLocale = 'en-US';
  expect(FLOW_STEPS[0].title).toBe('Health check');
  expect(getInvalidStateHint()).not.toBe(chineseHint);
  expect(getInvalidStateHint()).not.toMatch(/[\u4e00-\u9fff]/);
  expect(FLOW_STEPS.map(({ key, enterState, doneState }) => ({ key, enterState, doneState }))).toEqual(originalStates);
});

it('keeps the available health badge and next action when the language changes', () => {
  const health = { localService: 'ok', daemon: 'ok', extension: 'ok', highLevel: 'ok', llmSynthesis: true } as const;
  const onNext = jest.fn();
  const view = () => (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <HealthStep health={health} loading={false} onRun={jest.fn()} onNext={onNext} />
    </ConfigProvider>
  );
  const { rerender } = render(view());
  expect(llmHealthStatus(health)).toBe('可用');
  mockLocale = 'en-US';
  rerender(view());
  expect(llmHealthStatus(health)).toBe('Available');
  expect(screen.getByText('Available').closest('.ant-badge')).toHaveClass('ant-badge-status');
  expect(
    screen.getByText('Available').closest('.ant-badge')?.querySelector('.ant-badge-status-success')
  ).not.toBeNull();
  expect(requiredHealthChecksPass(health)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  expect(onNext).toHaveBeenCalledTimes(1);
});

it('uses a complete recording action sentence and preserves the sample identifier', () => {
  mockLocale = 'en-US';
  const stop = jest.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <CaptureStep
        phase="A"
        state="page_ready"
        loading={false}
        recording="A"
        recordingMode="vnc"
        onSeedChange={jest.fn()}
        onStartA={jest.fn()}
        onStopA={stop}
        onStartB={jest.fn()}
        onStopB={jest.fn()}
      />
    </ConfigProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording A' }));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('recording-preview')).toBeVisible();
});

it('translates known recovery guidance while retaining server diagnostics and retry behavior', () => {
  mockLocale = 'en-US';
  const retry = jest.fn();
  render(
    <ErrorRecovery
      error={{ code: 'verify_timeout', message: 'upstream detail #42' }}
      terminal={false}
      onRetry={retry}
      onReset={jest.fn()}
    />
  );
  expect(screen.getByText('upstream detail #42')).toBeVisible();
  expect(screen.getByText('verify_timeout')).toBeVisible();
  expect(screen.getByText(/Verify timed out/i)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it.each(['尚未测试', 'pending verification'])(
  'keeps the untested state independent of the display language (%s)',
  (reason) => {
    mockLocale = 'en-US';
    const draft: PipelineDraft = {
      id: 'draft_1',
      candidateId: 'candidate_1',
      site: 'example.test',
      name: 'search',
      source: 'source',
      score: 90,
      confidence: 'high',
      reason: '',
      risks: [],
      notes: [],
      staticOk: true,
      staticViolations: [],
      verify: { ok: false, rows: 0, fieldCount: 0, reasons: [reason] },
      usable: false,
    };
    render(<DraftCard draft={draft} source={draft.source} onSourceChange={jest.fn()} />);
    expect(screen.getByText('Untested')).toBeVisible();
    expect(screen.queryByText('Verify failed')).not.toBeInTheDocument();
    expect(draft.verify.reasons).toEqual([reason]);
  }
);
