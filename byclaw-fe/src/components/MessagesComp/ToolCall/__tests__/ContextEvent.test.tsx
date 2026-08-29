import { fireEvent, render, screen } from '@testing-library/react';

import ToolCall from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

describe('ToolCall context event', () => {
  it('renders runtime context as injected input instead of a tool result', () => {
    render(
      <ToolCall
        messageListItemContent={{
          substance: {
            title: '上下文注入 · skill-catalog',
            output: 'Loaded Spring Boot skills',
            status: '_DONE_',
            source: 'runtime',
            eventKind: 'context',
          },
        }}
      />
    );

    fireEvent.click(screen.getByText('上下文注入 · skill-catalog'));

    expect(screen.getByText('contextEvent.input')).toBeInTheDocument();
    expect(screen.getByText('Loaded Spring Boot skills')).toBeInTheDocument();
    expect(screen.queryByText('toolCall.output')).not.toBeInTheDocument();
  });
});
