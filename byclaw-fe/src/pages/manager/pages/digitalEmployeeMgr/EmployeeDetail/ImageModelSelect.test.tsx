import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, Form } from 'antd';
import { useState } from 'react';
import { getPersonalModelList, getPublicModelList } from '@/pages/manager/service/ModelMgr';
import ImageModelSelect from './ImageModelSelect';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'employeeDetail.imageModel': 'Image model',
        'employeeDetail.imageModelConfiguration': 'Image model configuration',
        'employeeDetail.ttsModel': 'Voice model',
        'employeeDetail.ttsModelConfiguration': 'Voice model configuration',
        'employeeDetail.ttsModelLoadError': 'Failed to load voice models',
        'employeeDetail.ttsModelRetry': 'Retry',
        'modelPopover.mine': 'Mine',
        'modelPopover.public': 'Public',
        'modelPopover.noModels': 'No models',
        'modelPopover.confirm': 'Confirm',
      }[id] || id),
  }),
}));

jest.mock('@/pages/manager/service/ModelMgr', () => ({
  getPersonalModelList: jest.fn(),
  getPublicModelList: jest.fn(),
}));

const model = (id: string, modelType = 'IMAGE_GENERATION') => ({
  modelId: id,
  modelName: `Model ${id}`,
  modelType,
  status: 'ENABLED',
});

const renderSelect = ({
  modelType = 'IMAGE_GENERATION',
  initialValue,
  disabled = false,
}: { modelType?: string; initialValue?: string; disabled?: boolean } = {}) => {
  const onChange = jest.fn();
  const ControlledSelect = () => {
    const [value, setValue] = useState(initialValue);
    return (
      <ConfigProvider theme={{ token: { motion: false } }}>
        <ImageModelSelect
          value={value}
          modelType={modelType}
          disabled={disabled}
          onChange={(nextValue) => {
            setValue(nextValue);
            onChange(nextValue);
          }}
        />
      </ConfigProvider>
    );
  };
  render(<ControlledSelect />);
  return onChange;
};

describe('ImageModelSelect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPersonalModelList as jest.Mock).mockResolvedValue({ data: { rows: [] } });
    (getPublicModelList as jest.Mock).mockResolvedValue({ data: { rows: [] } });
  });

  it.each([
    ['IMAGE_GENERATION', 'Image model'],
    ['TTS', 'Voice model'],
  ])('leaves an empty %s list blank without a global-default option', async (modelType, label) => {
    const onChange = renderSelect({ modelType });

    const trigger = screen.getByRole('button', { name: label });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    fireEvent.click(trigger);

    expect(await screen.findByText(`${label} configuration`)).toBeInTheDocument();
    expect(screen.getByText('No models')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('title', '');
    expect(onChange).not.toHaveBeenCalled();
    expect(getPersonalModelList).toHaveBeenCalledWith(expect.objectContaining({ modelType, status: 'ENABLED' }));
    expect(getPublicModelList).toHaveBeenCalledWith(expect.objectContaining({ modelType, status: 'ENABLED' }));
  });

  it.each([
    ['IMAGE_GENERATION', 'Image model'],
    ['TTS', 'Voice model'],
  ])('selects the first enabled public %s model', async (modelType, label) => {
    (getPersonalModelList as jest.Mock).mockResolvedValue({ data: { rows: [model('mine', modelType)] } });
    (getPublicModelList as jest.Mock).mockResolvedValue({
      data: {
        rows: [
          { ...model('disabled', modelType), status: 'DISABLED' },
          model('chat', 'LLM'),
          model('first', modelType),
          model('second', modelType),
        ],
      },
    });
    const onChange = renderSelect({ modelType });
    const trigger = screen.getByRole('button', { name: label });

    await waitFor(() => expect(trigger).toHaveAttribute('title', 'Model first'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('first');
    fireEvent.click(trigger);
    expect(await screen.findByRole('radio', { name: 'Model first' })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('falls back to the first personal model when public models are unavailable', async () => {
    (getPersonalModelList as jest.Mock).mockResolvedValue({ data: { rows: [model('mine'), model('another')] } });
    const onChange = renderSelect();
    const trigger = screen.getByRole('button', { name: 'Image model' });

    await waitFor(() => expect(trigger).toHaveAttribute('title', 'Model mine'));
    expect(onChange).toHaveBeenCalledWith('mine');
    fireEvent.click(trigger);
    expect(await screen.findByRole('radio', { name: 'Model mine' })).toBeChecked();
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
  });

  it('preserves an existing model and later user selections when switching tabs', async () => {
    (getPersonalModelList as jest.Mock).mockResolvedValue({ data: { rows: [model('mine')] } });
    (getPublicModelList as jest.Mock).mockResolvedValue({ data: { rows: [model('first'), model('saved')] } });
    const onChange = renderSelect({ initialValue: 'saved' });
    const trigger = screen.getByRole('button', { name: 'Image model' });

    await waitFor(() => expect(trigger).toHaveAttribute('title', 'Model saved'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('tab', { name: 'Mine' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Model mine' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Public' }));

    expect(trigger).toHaveAttribute('title', 'Model mine');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('mine');
  });

  it('waits for both lists and respects a saved value hydrated while loading', async () => {
    let resolvePublic!: (response: unknown) => void;
    (getPublicModelList as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolvePublic = resolve;
      })
    );
    const onChange = jest.fn();
    const { rerender } = render(<ImageModelSelect onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Image model' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();

    rerender(<ImageModelSelect value="saved" onChange={onChange} />);
    await act(async () => {
      resolvePublic({ data: { rows: [model('first'), model('saved')] } });
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Image model' })).toHaveAttribute('title', 'Model saved')
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not assign a model in read-only mode', async () => {
    (getPublicModelList as jest.Mock).mockResolvedValue({ data: { rows: [model('first')] } });
    const onChange = renderSelect({ disabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Image model' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Image model' })).toHaveAttribute('title', '');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows submitting a form with both optional model selections empty', async () => {
    const onSave = jest.fn();
    const EmployeeModelForm = () => {
      const [form] = Form.useForm();
      const imageModelId = Form.useWatch('imageModelId', { form, preserve: true });
      const ttsModelId = Form.useWatch('ttsModelId', { form, preserve: true });
      return (
        <Form form={form} onFinish={() => onSave(form.getFieldsValue(true))}>
          <ImageModelSelect value={imageModelId} onChange={(value) => form.setFieldValue('imageModelId', value)} />
          <ImageModelSelect
            modelType="TTS"
            value={ttsModelId}
            onChange={(value) => form.setFieldValue('ttsModelId', value)}
          />
          <button type="submit">Save</button>
        </Form>
      );
    };
    render(<EmployeeModelForm />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Voice model' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({}));
  });

  it('uses the localized voice-model error and retry labels', async () => {
    (getPersonalModelList as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    const onChange = renderSelect({ modelType: 'TTS' });

    expect(await screen.findByText('Failed to load voice models')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    (getPublicModelList as jest.Mock).mockResolvedValue({ data: { rows: [model('voice', 'TTS')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Voice model' })).toHaveAttribute('title', 'Model voice')
    );
    expect(onChange).toHaveBeenCalledWith('voice');
  });
});
