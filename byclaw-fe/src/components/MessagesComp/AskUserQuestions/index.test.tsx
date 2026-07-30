jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => (id === 'resource.other' ? '其他' : id),
  }),
}));

jest.mock('@/components/Preview/Md', () => {
  const React = require('react');

  return {
    __esModule: true,
    default: ({ content }: { content: string }) => {
      const strongMatch = content.match(/^(.*?)\*\*(.+)\*\*$/);
      if (strongMatch) {
        return React.createElement(
          'section',
          null,
          strongMatch[1],
          React.createElement('strong', null, strongMatch[2])
        );
      }

      const emphasisMatch = content.match(/^(.*?)\*(.+)\*$/);
      if (emphasisMatch) {
        return React.createElement(
          'section',
          null,
          emphasisMatch[1],
          React.createElement('em', null, emphasisMatch[2])
        );
      }

      return React.createElement('section', null, content);
    },
  };
});

const mockEmit = jest.fn();

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: {
      emit: mockEmit,
    },
    layoutMode: 'normal',
  }),
}));

jest.mock('@/service/message', () => ({
  updateMessageStructById: jest.fn(),
}));

import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import { updateMessageStructById } from '@/service/message';

import { AskUserQuestions, buildQueryQuestion, type IMessageListItemContent } from './index';

const updateMessageStructByIdMock = updateMessageStructById as jest.MockedFunction<typeof updateMessageStructById>;

const questions = [
  {
    question: 'Which framework?',
    header: 'framework',
    options: [
      { label: 'React', description: 'Component-based UI' },
      { label: 'Vue', description: 'Progressive framework' },
    ],
  },
  {
    question: 'Which capabilities?',
    header: 'capabilities',
    multiSelect: true,
    options: [
      { label: 'Testing', description: 'Automated tests' },
      { label: 'Linting', description: 'Static checks' },
    ],
  },
];

function renderQuestions(initialContent: IMessageListItemContent, onUpdate = jest.fn()) {
  function Harness() {
    const [content, setContent] = useState(initialContent);

    return (
      <AskUserQuestions
        message={
          {
            messageId: 'message-1',
            msgId: 'message-1',
            sessionId: 'session-1',
            traceId: 'trace-1',
          } as any
        }
        messageListItem={
          {
            uuid: 'item-1',
            orginContent: JSON.stringify({ questions, customField: 'preserved' }),
            resumeMessageId: 'resume-1',
          } as any
        }
        messageListItemContent={content}
        updateMessageListItemContent={(nextContent) => {
          onUpdate(nextContent);
          setContent(nextContent);
        }}
      />
    );
  }

  return render(<Harness />);
}

beforeEach(() => {
  mockEmit.mockClear();
  updateMessageStructByIdMock.mockReset();
  updateMessageStructByIdMock.mockResolvedValue({} as any);
});

describe('AskUserQuestions', () => {
  it('converts structured answers into natural language for the LLM', () => {
    expect(
      buildQueryQuestion([
        {
          question: 'Which framework?',
          header: 'framework',
          selectedOptions: ['React'],
          otherSelected: false,
          otherText: '',
        },
        {
          question: 'Which capabilities?',
          header: 'capabilities',
          selectedOptions: ['Testing', 'Linting'],
          otherSelected: true,
          otherText: 'Custom deployment',
        },
      ])
    ).toBe('framework: React\ncapabilities: Testing,Linting,Custom deployment');
  });

  it('renders one question with its title and supports a single selection', () => {
    const onUpdate = jest.fn();
    renderQuestions(
      {
        substance: {
          formStatus: IFormStatus.INIT,
          questions: [questions[0]],
        },
      },
      onUpdate
    );

    expect(screen.getByText('Which framework?')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /React/ }));

    expect(screen.getByRole('radio', { name: /React/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeEnabled();
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        substance: expect.objectContaining({
          answers: [
            {
              question: 'Which framework?',
              header: 'framework',
              selectedOptions: ['React'],
              otherSelected: false,
              otherText: '',
            },
          ],
        }),
      })
    );
  });

  it('requires free text when the other option is selected in single-select mode', () => {
    renderQuestions({
      substance: {
        formStatus: IFormStatus.INIT,
        questions: [questions[0]],
      },
    });

    fireEvent.click(screen.getByText('其他'));
    expect(screen.getByRole('radio', { name: '其他' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'form.inputPlaceholder' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'form.inputPlaceholder' }), {
      target: { value: 'Svelte' },
    });

    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeEnabled();
  });

  it('renders single and tab question titles as markdown', () => {
    const markdownQuestions = [
      { ...questions[0], question: 'Choose **one framework**' },
      { ...questions[1], question: 'Choose *capabilities*' },
    ];
    const { unmount } = renderQuestions({
      substance: {
        formStatus: IFormStatus.INIT,
        questions: [markdownQuestions[0]],
      },
    });

    expect(screen.getByText('one framework').tagName).toBe('STRONG');

    unmount();
    renderQuestions({
      substance: {
        formStatus: IFormStatus.INIT,
        questions: markdownQuestions,
      },
    });

    expect(screen.getByRole('tab', { name: 'Choose one framework' }).querySelector('strong')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Choose capabilities' }).querySelector('em')).not.toBeNull();
  });

  // Ant Design 选项交互与异步持久化在双 worker 钩子中可能超过默认 5 秒。
  it('ignores a blank other option in multi-select mode', async () => {
    renderQuestions({
      substance: {
        formStatus: IFormStatus.INIT,
        questions: [questions[1]],
      },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: '其他' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'form.inputPlaceholder' }), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Testing/ }));
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeEnabled();

    // 确认操作会等待异步持久化；用 act 统一刷新 Promise 与状态更新，避免双 worker 时超时。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.confirm' }));
    });
    expect(updateMessageStructByIdMock).toHaveBeenCalled();

    const persistedContent = JSON.parse(updateMessageStructByIdMock.mock.calls[0][0].content);
    expect(persistedContent.answers[0]).toEqual(
      expect.objectContaining({
        selectedOptions: ['Testing'],
        otherSelected: false,
        otherText: '',
      })
    );
  }, 15000);

  it('uses tabs for multiple questions and requires every question to be answered', () => {
    renderQuestions({
      substance: {
        formStatus: IFormStatus.INIT,
        questions,
      },
    });

    expect(screen.getByRole('tab', { name: 'Which framework?' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Which capabilities?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /React/ }));
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Which capabilities?' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Testing/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Linting/ }));

    expect(screen.getByRole('checkbox', { name: /Testing/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Linting/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'form.confirm' })).toBeEnabled();
  });

  it('persists the completed answers before emitting the resume event', async () => {
    const callOrder: string[] = [];
    const onUpdate = jest.fn();
    updateMessageStructByIdMock.mockImplementation(async () => {
      callOrder.push('persist');
      return {} as any;
    });
    mockEmit.mockImplementation(() => {
      callOrder.push('emit');
    });

    renderQuestions(
      {
        sourceAgentType: 'agent',
        substance: {
          formStatus: IFormStatus.INIT,
          questions: [questions[0]],
        },
      },
      onUpdate
    );

    fireEvent.click(screen.getByRole('radio', { name: /Vue/ }));
    const confirmButton = screen.getByRole('button', { name: 'form.confirm' });
    // 选项变更会先由 Harness 回写状态，确认按钮解除禁用后再提交，避免并发执行时读取旧答案。
    await waitFor(() => expect(confirmButton).toBeEnabled());
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });

    await waitFor(() => expect(mockEmit).toHaveBeenCalledWith('beyond-chat-on-send-msg', expect.any(Object)));

    expect(callOrder).toEqual(['persist', 'emit']);
    expect(mockEmit).toHaveBeenCalledWith(
      'beyond-chat-on-send-msg',
      expect.objectContaining({
        sendProps: expect.objectContaining({
          queryQuestion: 'framework: Vue',
        }),
      })
    );
    expect(updateMessageStructByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'item-1',
        messageId: 'message-1',
        updateField: 'messageStruct',
      })
    );
    const persistedContent = JSON.parse(updateMessageStructByIdMock.mock.calls[0][0].content);
    expect(persistedContent).toEqual(
      expect.objectContaining({
        customField: 'preserved',
        formStatus: IFormStatus.FINISH,
        answers: [
          {
            question: 'Which framework?',
            header: 'framework',
            selectedOptions: ['Vue'],
            otherSelected: false,
            otherText: '',
          },
        ],
      })
    );
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ substance: expect.objectContaining({ formStatus: IFormStatus.FINISH }) })
    );
  });

  // 全量测试以双 worker 运行时，Ant Design 状态更新可能超过 Jest 默认的 5 秒超时。
  it('does not finish or emit when persistence fails', async () => {
    const onUpdate = jest.fn();
    updateMessageStructByIdMock.mockRejectedValue(new Error('save failed'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    renderQuestions(
      {
        substance: {
          formStatus: IFormStatus.INIT,
          questions: [questions[0]],
        },
      },
      onUpdate
    );

    fireEvent.click(screen.getByRole('radio', { name: /React/ }));
    const confirmButton = screen.getByRole('button', { name: 'form.confirm' });
    // 等待选项状态提交后再触发失败分支，保证断言观察到本次异步保存的状态变化。
    await waitFor(() => expect(confirmButton).toBeEnabled());
    onUpdate.mockClear();
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });

    await waitFor(() => expect(updateMessageStructByIdMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.confirm' })).toBeEnabled());
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ substance: expect.objectContaining({ formStatus: IFormStatus.FINISH }) })
    );
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ submitting: false }));
    expect(mockEmit).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  }, 15000);
});
