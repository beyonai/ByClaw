import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
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
