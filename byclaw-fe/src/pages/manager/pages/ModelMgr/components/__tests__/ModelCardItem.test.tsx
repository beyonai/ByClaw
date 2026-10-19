import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import enMessages from '@/locales/en-US/manager';
import zhMessages from '@/locales/zh-CN/manager';
import ModelCardItem from '../ModelCardItem';

describe('model card display', () => {
  it.each([
    { name: 'populated', systems: ['BYAI'] },
    { name: 'empty', systems: [] },
    { name: 'missing', systems: undefined },
  ])('omits the system tag section for $name systems and preserves edit data', ({ systems }) => {
    const record = {
      id: 'model-1',
      displayName: 'Example model',
      modelType: 'LLM',
      modelCode: 'example-code',
      providerName: 'OpenAI',
      status: 'ENABLED',
      contextTokens: 8192,
      abilities: ['3'],
      systems,
      updatedAt: '2026-10-15 10:00:00',
    };
    const onEdit = jest.fn();

    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <ModelCardItem
          intl={{ formatMessage: ({ id }: { id: string }) => id }}
          record={record}
          abilityLabelMap={{ '3': 'Conversation model' }}
          onSetStatus={jest.fn()}
          onSetDefault={jest.fn()}
          onEdit={onEdit}
          onDebug={jest.fn()}
          onDelete={jest.fn()}
        />
      </ConfigProvider>
    );

    expect(screen.queryByText('modelMgr.filterSystem')).not.toBeInTheDocument();
    expect(screen.queryByText('BYAI')).not.toBeInTheDocument();
    expect(screen.queryByText('-')).not.toBeInTheDocument();
    expect(screen.getByText('Example model')).toBeInTheDocument();
    expect(screen.getByText('example-code')).toBeInTheDocument();
    expect(screen.getByText('8192 tokens')).toBeInTheDocument();
    expect(screen.getByText('modelMgr.filterAbility')).toBeInTheDocument();
    expect(screen.getByText('Conversation model')).toBeInTheDocument();
    expect(screen.getByText('modelMgr.statusEnabled')).toBeInTheDocument();

    // 仅隐藏列表展示，编辑时仍传递完整记录，避免丢失已配置的系统标签。
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(record);
  });
});

describe('model defaults by type', () => {
  const modelTypes = ['LLM', 'EMBEDDING', 'RERANK', 'TTS', 'ASR', 'IMAGE_GENERATION', 'CUSTOM_TYPE'];

  const renderCard = (
    overrides: Record<string, unknown> = {},
    messages: Record<string, string> = {},
    modelTypeLabelMap: Record<string, string> = {}
  ) => {
    const record = {
      id: 'model-1',
      displayName: 'Example model',
      modelType: 'TTS',
      status: 'ENABLED',
      abilities: [],
      isDefault: 0,
      ...overrides,
    };
    const onSetDefault = jest.fn();
    const { unmount } = render(
      <ConfigProvider locale={enUS} theme={{ token: { motion: false } }}>
        <ModelCardItem
          intl={{ formatMessage: ({ id }: { id: string }) => messages[id] || id }}
          record={record}
          abilityLabelMap={{ '1': 'Default Conversation Model', '3': 'Conversation model' }}
          modelTypeLabelMap={modelTypeLabelMap}
          onSetStatus={jest.fn()}
          onSetDefault={onSetDefault}
          onEdit={jest.fn()}
          onDebug={jest.fn()}
          onDelete={jest.fn()}
        />
      </ConfigProvider>
    );
    return { record, onSetDefault, unmount };
  };

  it.each([
    ['LLM', '大语言模型', 'Large language model'],
    ['RERANK', '重排模型', 'Reranking model'],
    ['EMBEDDING', '向量模型', 'Embedding model'],
    ['TTS', '语音模型', 'Text to speech'],
    ['ASR', '语音识别', 'Speech recognition'],
    ['IMAGE_GENERATION', '文生图', 'Image generation'],
  ])('renders translated names for %s without exposing the code', (modelType, chinese, english) => {
    const { unmount } = renderCard({ modelType }, zhMessages);
    expect(screen.getByText(chinese)).toBeInTheDocument();
    expect(screen.queryByText(modelType)).not.toBeInTheDocument();
    unmount();
    renderCard({ modelType }, enMessages);
    expect(screen.getByText(english)).toBeInTheDocument();
    expect(screen.queryByText(modelType)).not.toBeInTheDocument();
  });

  it('uses the configured label for custom types', () => {
    renderCard({ modelType: ' custom ' }, zhMessages, { CUSTOM: '自定义类型' });

    expect(screen.getByText('自定义类型')).toBeInTheDocument();
    expect(screen.queryByText('custom')).not.toBeInTheDocument();
  });

  it.each<Record<string, string>>([{}, { CUSTOM: 'CUSTOM' }])(
    'does not expose an untranslated type code with labels %j',
    (labels) => {
      renderCard({ modelType: 'CUSTOM' }, zhMessages, labels);

      expect(screen.getByText('未知类型')).toBeInTheDocument();
      expect(screen.queryByText('CUSTOM')).not.toBeInTheDocument();
    }
  );

  it.each(modelTypes)('allows an enabled %s model without conversation abilities to become default', (modelType) => {
    renderCard({ modelType });

    expect(screen.getByRole('button', { name: 'modelMgr.setDefault' })).toBeInTheDocument();
    expect(screen.queryByText('modelMgr.defaultModel')).not.toBeInTheDocument();
  });

  it.each(modelTypes)('marks the current %s default and hides its set-default action', (modelType) => {
    renderCard({ modelType, isDefault: 1 });

    expect(screen.getByText('modelMgr.defaultModel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'modelMgr.setDefault' })).not.toBeInTheDocument();
  });

  it.each([true, '1'])('accepts the backend default flag %s', (isDefault) => {
    renderCard({ isDefault });

    expect(screen.getByText('modelMgr.defaultModel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'modelMgr.setDefault' })).not.toBeInTheDocument();
  });

  it.each([null, undefined, '', '   '])('does not label an empty type %s as LLM', (modelType) => {
    renderCard({ modelType });

    expect(screen.queryByText('LLM')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'modelMgr.setDefault' })).toBeInTheDocument();
  });

  it.each(['DISABLED', 'TESTING'])('does not allow a %s model to become default', (status) => {
    renderCard({ status });

    expect(screen.queryByRole('button', { name: 'modelMgr.setDefault' })).not.toBeInTheDocument();
  });

  it('uses the backend default flag even when a stale default-conversation ability remains', () => {
    renderCard({ modelType: 'LLM', abilities: ['1', '3'], isDefault: 0 });

    expect(screen.getByRole('button', { name: 'modelMgr.setDefault' })).toBeInTheDocument();
    expect(screen.queryByText('modelMgr.defaultModel')).not.toBeInTheDocument();
  });

  it('does not treat the legacy conversation ability as an ASR default', () => {
    renderCard({ modelType: 'ASR', abilities: ['1'] });
    expect(screen.queryByText('modelMgr.defaultModel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'modelMgr.setDefault' })).toBeInTheDocument();
  });

  it('passes the selected model to the callback only after confirmation', async () => {
    const { record, onSetDefault } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'modelMgr.setDefault' }));
    expect(await screen.findByText('modelMgr.confirmSetDefault')).toBeInTheDocument();
    expect(onSetDefault).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    expect(onSetDefault).toHaveBeenCalledWith(record);
  });
});
