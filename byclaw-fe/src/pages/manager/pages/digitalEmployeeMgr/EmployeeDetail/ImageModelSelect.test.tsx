import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getPersonalModelList, getPublicModelList } from '@/pages/manager/service/ModelMgr';
import ImageModelSelect from './ImageModelSelect';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'employeeDetail.ttsModel': 'Voice model',
        'employeeDetail.ttsModelConfiguration': 'Voice model configuration',
        'employeeDetail.ttsModelGlobalDefault': 'Use global default',
        'employeeDetail.ttsModelLoadError': 'Failed to load voice models',
        'employeeDetail.ttsModelRetry': 'Retry',
      }[id] || id),
  }),
}));

jest.mock('@/pages/manager/service/ModelMgr', () => ({
  getPersonalModelList: jest.fn(),
  getPublicModelList: jest.fn(),
}));

describe('ImageModelSelect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPersonalModelList as jest.Mock).mockResolvedValue({ data: { rows: [] } });
    (getPublicModelList as jest.Mock).mockResolvedValue({ data: { rows: [] } });
  });

  it('uses voice-model translations when selecting TTS models', async () => {
    render(<ImageModelSelect modelType="TTS" onChange={jest.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Voice model' });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    fireEvent.click(trigger);

    expect(await screen.findByText('Voice model configuration')).toBeInTheDocument();
    expect(screen.getAllByText('Use global default').length).toBeGreaterThanOrEqual(2);
    expect(getPersonalModelList).toHaveBeenCalledWith(expect.objectContaining({ modelType: 'TTS', status: 'ENABLED' }));
  });

  it('uses the localized voice-model error and retry labels', async () => {
    (getPersonalModelList as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    render(<ImageModelSelect modelType="TTS" onChange={jest.fn()} />);

    expect(await screen.findByText('Failed to load voice models')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
