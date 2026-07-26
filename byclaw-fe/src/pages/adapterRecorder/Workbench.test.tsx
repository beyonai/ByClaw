import { fireEvent, render, screen } from '@testing-library/react';
import Workbench from './index';

let mockSession: any = {
  state: 'page_ready',
  data: { recording: 'A' },
  loading: false,
  error: null,
  actions: {},
};

jest.mock('@umijs/max', () => ({ useSelector: () => null }));
jest.mock('./models/useRecorderSession', () => () => mockSession);
jest.mock('./components/StepRail', () => () => <div />);
jest.mock('./components/UserIdentityBar', () => () => null);
jest.mock('./steps/CaptureStep', () => () => <div data-testid="capture-step" />);
jest.mock('./steps/HealthStep', () => ({ onNext }: { onNext: () => void }) => (
  <button type="button" onClick={onNext}>
    下一步
  </button>
));

test('renders the active recording step in the workbench stage', () => {
  render(<Workbench />);

  expect(screen.getByTestId('recorder-work-surface')).toContainElement(screen.getByTestId('capture-step'));
});

test('continues after passing health checks without LLM', () => {
  const continueAfterHealth = jest.fn();
  mockSession = {
    state: 'idle',
    data: {
      health: {
        localService: 'ok',
        daemon: 'ok',
        extension: 'ok',
        highLevel: 'ok',
        llmSynthesis: false,
      },
    },
    loading: false,
    error: null,
    actions: { health: jest.fn(), continueAfterHealth },
  };

  render(<Workbench />);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));

  expect(continueAfterHealth).toHaveBeenCalledTimes(1);
});
