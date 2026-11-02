import { fireEvent, render, screen } from '@testing-library/react';

import * as connectorAuthorization from '@/utils/connectorAuthorization';
import ToolCall, { parseConnectorAction } from '..';

jest.mock('@umijs/max', () => ({
  getIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(),
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

describe('ToolCall connector recovery action', () => {
  it('recognizes only supported media connector configuration errors', () => {
    expect(
      parseConnectorAction(
        'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=image-generation-model; 系统默认文生图模型当前不可用。'
      )
    ).toEqual({ connectorCode: 'image-generation-model', label: '配置文生图模型连接器' });
    expect(
      parseConnectorAction(
        'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=speech-generation-model; 系统默认语音模型当前不可用。'
      )
    ).toEqual({ connectorCode: 'speech-generation-model', label: '配置语音模型连接器' });
    expect(parseConnectorAction('Error: MEDIA_MODEL_NOT_CONFIGURED: IMAGE')).toBeUndefined();
    expect(
      parseConnectorAction(
        'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=unknown-connector; unavailable'
      )
    ).toBeUndefined();
  });

  it('does not bury the connector action inside an error tool card', () => {
    render(
      <ToolCall
        messageListItemContent={{
          substance: {
            title: 'image_generate',
            output:
              'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=image-generation-model; 请配置连接器。',
            status: '_ERROR_',
          },
        }}
      />
    );

    fireEvent.click(screen.getByText('image_generate'));
    expect(screen.queryByRole('button', { name: '配置文生图模型连接器' })).not.toBeInTheDocument();
  });

  it('collects and deduplicates connector actions from all tool results', () => {
    const collectConnectorActions = (connectorAuthorization as any).collectConnectorActions;
    const imageError = {
      content: {
        substance: {
          output: 'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=image-generation-model; 请配置连接器。',
        },
      },
    };
    const speechError = {
      content: {
        substance: {
          output:
            'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=speech-generation-model; 请配置连接器。',
        },
      },
    };

    expect(collectConnectorActions([imageError, imageError, speechError])).toEqual([
      { connectorCode: 'image-generation-model', label: '配置文生图模型连接器' },
      { connectorCode: 'speech-generation-model', label: '配置语音模型连接器' },
    ]);
  });
});
