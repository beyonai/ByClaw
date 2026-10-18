import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getMyModels, getPublicModels } from '@/pages/models/service';
import { readReasoningTranslationSettings } from '@/utils/reasoningTranslationSettings';
import ReasoningTranslationSelect from '.';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: (selector: (state: unknown) => unknown) => selector({ user: { userInfo: { userId: 1 } } }),
}));
jest.mock('@/pages/models/service', () => ({ getMyModels: jest.fn(), getPublicModels: jest.fn() }));

describe('ReasoningTranslationSelect', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    (getMyModels as jest.Mock).mockResolvedValue({
      data: { rows: [{ modelId: '42', modelName: 'Translator', status: 'ENABLED' }] },
    });
    (getPublicModels as jest.Mock).mockResolvedValue({ data: { rows: [] } });
  });

  it('requires a translation model, persists the switch, and restores it after remount', async () => {
    const view = render(<ReasoningTranslationSelect sessionId="session-1" />);
    fireEvent.click(screen.getByRole('button', { name: /reasoningTranslation.label/ }));
    const toggle = await screen.findByRole('switch', { name: 'reasoningTranslation.label' });
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(getMyModels).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'reasoningTranslation.model' }));
    fireEvent.click(await screen.findByText('Translator'));
    fireEvent.click(toggle);
    expect(readReasoningTranslationSettings('session-1')).toEqual({
      translateReasoning: true,
      reasoningTranslationModelId: '42',
    });
    view.unmount();
    render(<ReasoningTranslationSelect sessionId="session-1" />);
    expect(screen.getByRole('button', { name: /reasoningTranslation.label/ })).toHaveAttribute('aria-pressed', 'true');
    expect(readReasoningTranslationSettings('session-2').translateReasoning).toBe(false);
  });
});
