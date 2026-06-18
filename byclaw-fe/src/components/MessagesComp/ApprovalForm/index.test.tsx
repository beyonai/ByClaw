jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: {
      emit: jest.fn(),
    },
  }),
}));

jest.mock('@/service/message', () => ({
  updateMessageStructById: jest.fn(),
}));

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ApprovalForm from './index';

import type { OperationFormConfirmation } from './index.d';

const scrollIntoViewMock = jest.fn();
const requestAnimationFrameMock = jest.fn((callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  window.requestAnimationFrame = requestAnimationFrameMock;
});

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  requestAnimationFrameMock.mockClear();
});

function renderApprovalForm() {
  const messageListItemContent: OperationFormConfirmation = {
    sourceAgentType: 'agent',
    metadata: '{}',
    schemaVersion: '1',
    formId: 'approval-form',
    title: 'Approval',
    description: 'Please confirm',
    substance: [
      {
        toolCallId: 'tool-call-1',
        toolName: 'tool-one',
        actionCode: 'action-one',
        actionName: 'Action One',
        title: 'Step One',
        description: 'First step',
        rule: [
          [
            {
              formType: 'input',
              fieldCode: 'customerName',
              fieldPath: 'customerName',
              fieldName: 'Customer Name',
              fieldType: 'string',
            },
          ],
        ],
      },
      {
        toolCallId: 'tool-call-2',
        toolName: 'tool-two',
        actionCode: 'action-two',
        actionName: 'Action Two',
        title: 'Step Two',
        description: 'Second step',
        rule: [
          [
            {
              formType: 'input',
              fieldCode: 'projectName',
              fieldPath: 'projectName',
              fieldName: 'Project Name',
              fieldType: 'string',
            },
          ],
        ],
      },
    ],
  };

  const view = render(
    <ApprovalForm
      message={
        {
          messageId: 'message-1',
          queryMsgId: 'query-1',
          traceId: 'trace-1',
        } as any
      }
      messageIdx={0}
      messageListItem={
        {
          uuid: 'list-item-1',
          orginContent: '{}',
        } as any
      }
      messageListItemContent={messageListItemContent}
      updateMessageListItemContent={jest.fn()}
    />
  );

  return {
    ...view,
    messageListItemContent,
  };
}

function createApprovalFormProps(messageListItemContent: OperationFormConfirmation) {
  return {
    message: {
      messageId: 'message-1',
      queryMsgId: 'query-1',
      traceId: 'trace-1',
    } as any,
    messageIdx: 0,
    messageListItem: {
      uuid: 'list-item-1',
      orginContent: '{}',
    } as any,
    messageListItemContent,
    updateMessageListItemContent: jest.fn(),
  };
}

function getButton(text: string) {
  return screen
    .getByText((content, node) => node?.tagName === 'SPAN' && content.replace(/\s/g, '') === text)
    .closest('button') as HTMLButtonElement;
}

function queryButton(text: string) {
  return (
    screen
      .queryByText((content, node) => node?.tagName === 'SPAN' && content.replace(/\s/g, '') === text)
      ?.closest('button') || null
  );
}

describe('ApprovalForm', () => {
  it('updates input value when fieldValue changes after initial render', async () => {
    const initialContent: OperationFormConfirmation = {
      sourceAgentType: 'agent',
      metadata: '{}',
      schemaVersion: '1',
      formId: 'approval-form',
      title: 'Approval',
      description: 'Please confirm',
      substance: [
        {
          toolCallId: 'tool-call-1',
          toolName: 'tool-one',
          actionCode: 'action-one',
          actionName: 'Action One',
          title: 'Step One',
          description: 'First step',
          rule: [
            [
              {
                formType: 'input',
                fieldCode: 'customerName',
                fieldPath: 'customerName',
                fieldName: 'Customer Name',
                fieldType: 'string',
                fieldValue: 'Alice',
              },
            ],
          ],
        },
      ],
    };
    const nextContent: OperationFormConfirmation = {
      ...initialContent,
      substance: [
        {
          ...initialContent.substance[0],
          rule: [
            [
              {
                ...initialContent.substance[0].rule[0][0],
                fieldValue: 'Bob',
              },
            ],
          ],
        },
      ],
    };

    const { rerender } = render(<ApprovalForm {...createApprovalFormProps(initialContent)} />);

    expect(screen.getByLabelText('Customer Name')).toHaveValue('Alice');

    rerender(<ApprovalForm {...createApprovalFormProps(nextContent)} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Customer Name')).toHaveValue('Bob');
    });
  });

  it('renders horizontal steps and only the current step form content', async () => {
    const { container, messageListItemContent } = renderApprovalForm();

    expect(container.querySelector('.ant-steps-horizontal')).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-steps-item')[0]).toHaveClass('ant-steps-item-process');
    expect(container.querySelectorAll('.ant-steps-item')[1]).toHaveClass('ant-steps-item-wait');
    expect(screen.getByText('Step One')).toBeInTheDocument();
    expect(screen.getByText('Step Two')).toBeInTheDocument();
    expect(screen.getByText('Customer Name')).toBeInTheDocument();
    expect(screen.queryByText('Project Name')).not.toBeInTheDocument();
    expect(getButton('common.prev')).toBeDisabled();
    expect(queryButton('common.next')).not.toBeInTheDocument();
    expect(getButton('common.skip')).toBeEnabled();
    expect(getButton('common.confirm')).toBeEnabled();
    expect(screen.queryByText('common.submit')).not.toBeInTheDocument();

    fireEvent.click(getButton('common.confirm'));

    expect(messageListItemContent.substance[0].confirmed).toBe(true);
    expect(container.querySelectorAll('.ant-steps-item')[0]).toHaveClass('ant-steps-item-finish');
    expect(screen.queryByText('common.submit')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Project Name')).toBeInTheDocument();
    });
    expect(screen.queryByText('Customer Name')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.ant-steps-item')[0]).toHaveClass('ant-steps-item-finish');
    expect(container.querySelectorAll('.ant-steps-item')[1]).toHaveClass('ant-steps-item-process');
    expect(getButton('common.prev')).toBeEnabled();
    expect(queryButton('common.next')).not.toBeInTheDocument();
    expect(screen.queryByText('common.submit')).not.toBeInTheDocument();

    fireEvent.click(getButton('common.skip'));

    expect(messageListItemContent.substance[1].confirmed).toBe(false);
    expect(container.querySelectorAll('.ant-steps-item')[1]).toHaveClass('ant-steps-item-error');
    expect(screen.getByText('common.submit')).toBeInTheDocument();

    fireEvent.click(getButton('common.prev'));

    await waitFor(() => {
      expect(screen.getByText('Customer Name')).toBeInTheDocument();
    });
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    await waitFor(() => {
      expect(screen.queryByText('Project Name')).not.toBeInTheDocument();
    });
  }, 15000);
});
