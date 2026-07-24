import { render, screen } from '@testing-library/react';
import Workbench from './index';

jest.mock('@umijs/max', () => ({ useSelector: () => null }));
jest.mock('./models/useRecorderSession', () => () => ({
  state: 'page_ready',
  data: { recording: 'A' },
  loading: false,
  error: null,
  actions: {},
}));
jest.mock('./components/StepRail', () => () => <div />);
jest.mock('./components/UserIdentityBar', () => () => null);
jest.mock('./steps/CaptureStep', () => () => <div data-testid="capture-step" />);

test('renders the active recording step in the workbench stage', () => {
  render(<Workbench />);

  expect(screen.getByTestId('recorder-work-surface')).toContainElement(screen.getByTestId('capture-step'));
});
