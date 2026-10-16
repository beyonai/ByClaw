import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import ModelPresetPicker from '../ModelPresetPicker';
import { MODEL_FORM_PRESETS } from '../modelFormPresets';
import type { ModelFormPreset } from '../modelFormPresets';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    locale: 'zh-CN',
    formatMessage: ({ id }: { id: string }, values: Record<string, string> = {}) => {
      const message = jest.requireActual('@/locales/zh-CN/manager').default[id] || id;
      return message.replace(/\{(\w+)\}/g, (_: string, key: string) => values[key] || '');
    },
  }),
}));

const renderPicker = async (presets?: ModelFormPreset[]) => {
  const onSelect = jest.fn();
  await act(async () => {
    render(
      <ConfigProvider virtual={false} theme={{ token: { motion: false } }}>
        <ModelPresetPicker presets={presets} onSelect={onSelect} />
      </ConfigProvider>
    );
  });
  return onSelect;
};

const openPicker = () => fireEvent.mouseDown(screen.getByRole('combobox', { name: '官方模型模板（选填）' }));
const selectOption = async (label: string) => {
  await act(async () => {
    fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }));
  });
};

describe('ModelPresetPicker', () => {
  it('renders only one searchable list and includes older versions immediately', async () => {
    const onSelect = await renderPicker();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openPicker();
    expect(await screen.findByText('MiniMax-M2.7 · MiniMax')).toBeInTheDocument();
    await selectOption('MiniMax-M3 · MiniMax');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('minimax:MiniMax-M3');
  });

  it('searches and applies an older template in one selection', async () => {
    const onSelect = await renderPicker();
    openPicker();
    fireEvent.change(screen.getByRole('combobox', { name: '官方模型模板（选填）' }), {
      target: { value: 'MiniMax-M2.7' },
    });
    await selectOption('MiniMax-M2.7 · MiniMax');
    expect(onSelect).toHaveBeenCalledWith('minimax:MiniMax-M2.7');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows each channel in the same list and applies its exact ID without a second selection', async () => {
    const first = MODEL_FORM_PRESETS.find(({ id }) => id === 'minimax:MiniMax-M3')!;
    const onSelect = await renderPicker([first, { ...first, id: 'fixture:bailian', channel: 'bailian' }]);
    openPicker();
    expect(await screen.findByText('MiniMax-M3 · MiniMax')).toBeInTheDocument();
    await selectOption('MiniMax-M3 · MiniMax（阿里云百炼接入）');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('fixture:bailian');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
