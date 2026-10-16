import { fireEvent, render, screen } from '@testing-library/react';

import ToolCall, { CONNECTOR_AUTHORIZATION_REQUEST_EVENT, parseConnectorAction } from '..';

jest.mock('@umijs/max', () => ({
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
    ).toEqual({ connectorCode: 'image-generation-model', label: '配置文生图模型' });
    expect(
      parseConnectorAction(
        'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=speech-generation-model; 系统默认语音模型当前不可用。'
      )
    ).toEqual({ connectorCode: 'speech-generation-model', label: '配置语音模型' });
    expect(parseConnectorAction('Error: MEDIA_MODEL_NOT_CONFIGURED: IMAGE')).toBeUndefined();
    expect(
      parseConnectorAction(
        'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=unknown-connector; unavailable'
      )
    ).toBeUndefined();
  });

  it('requests the exact connector authorization page from an error tool card', () => {
    const listener = jest.fn();
    window.addEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, listener);

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
    fireEvent.click(screen.getByRole('button', { name: '配置文生图模型' }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      connectorCode: 'image-generation-model',
    });
    window.removeEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, listener);
  });

  it('shows the connector action when the streamed status was not normalized to _ERROR_', () => {
    render(
      <ToolCall
        messageListItemContent={{
          substance: {
            title: 'image_generate',
            output:
              'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=image-generation-model; 系统默认文生图模型当前不可用。请打开连接器授权页面，配置并启用个人连接器后重试（原因：MEDIA_HTTP_401）。',
            status: '_DONE_',
          },
        }}
      />
    );

    fireEvent.click(screen.getByText('image_generate'));

    expect(screen.getByRole('button', { name: '配置文生图模型' })).toBeInTheDocument();
  });
});
