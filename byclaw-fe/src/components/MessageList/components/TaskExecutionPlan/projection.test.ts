import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessage } from '@/typescript/message';
import { selectLatestTaskPlan } from './projection';

const createAssistantMessage = (overrides: Partial<IMessage>): IMessage =>
  ({
    creatorId: 'assistant',
    fromBeyond: true,
    msgId: 'message-1',
    messageId: 'message-1',
    sessionId: 'session-1',
    messageState: IMessageState.Done,
    createTime: '1',
    messageList: [],
    thinkList: [],
    ...overrides,
  } as IMessage);

describe('selectLatestTaskPlan', () => {
  it('uses the newest native task plan snapshot in the current conversation', () => {
    const first = createAssistantMessage({
      msgId: 'message-1',
      taskPlan: {
        planId: 'plan-1',
        version: 1,
        title: 'Old plan',
        status: 'ACTIVE',
        sessionId: 'session-1',
        messageId: 'message-1',
        tasks: [{ taskId: 'task-1', position: 1, title: 'Old task', status: 'IN_PROGRESS' }],
      },
    });
    const latest = createAssistantMessage({
      msgId: 'message-2',
      messageId: 'message-2',
      createTime: '2',
      taskPlan: {
        planId: 'plan-2',
        version: 3,
        title: 'Latest plan',
        status: 'COMPLETED',
        sessionId: 'session-1',
        messageId: 'message-2',
        tasks: [{ taskId: 'task-2', position: 1, title: 'Latest task', status: 'COMPLETED' }],
      },
    });

    expect(selectLatestTaskPlan([first, latest])?.title).toBe('Latest plan');
  });

  it('selects the plan from the newest answer even when its version restarts', () => {
    const first = createAssistantMessage({
      createTime: '2026-08-21T10:00:00+08:00',
      taskPlan: {
        planId: 'plan-old',
        version: 3,
        title: 'Old plan',
        status: 'ACTIVE',
        sessionId: 'session-1',
        messageId: 'message-1',
        tasks: [{ taskId: 'task-1', position: 1, title: 'Old task', status: 'IN_PROGRESS' }],
      },
    });
    const second = createAssistantMessage({
      msgId: 'message-2',
      messageId: 'message-2',
      createTime: '2026-08-21T10:05:00+08:00',
      taskPlan: {
        planId: 'plan-new',
        version: 1,
        title: 'New plan',
        status: 'ACTIVE',
        sessionId: 'session-1',
        messageId: 'message-2',
        tasks: [{ taskId: 'task-2', position: 1, title: 'New task', status: 'PENDING' }],
      },
    });

    expect(selectLatestTaskPlan([first, second])?.planId).toBe('plan-new');
  });

  it('normalizes the latest generic 2008 plan event into a task plan snapshot', () => {
    const message = createAssistantMessage({
      thinkList: [
        {
          uuid: 'plan-event',
          contentType: SSEMessageType.taskOutline,
          status: SSEEventStatus.done,
          orginContent: '',
          seq: 8,
          content: {
            substance: JSON.stringify({
              planId: 'external-plan',
              task_description: 'Release checklist',
              status: 0,
              steps: [
                {
                  step_topic: 'Delivery',
                  sub_steps: [
                    {
                      id: '1',
                      step_name: 'Step 1',
                      step_description: 'Run tests',
                      tool_metadata: { status: 'completed' },
                    },
                    {
                      id: '2',
                      step_name: 'Step 2',
                      step_description: 'Deploy preview',
                      tool_metadata: { status: 'in_progress' },
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    });

    expect(selectLatestTaskPlan([message])).toEqual(
      expect.objectContaining({
        planId: 'external-plan',
        title: 'Release checklist',
        status: 'ACTIVE',
        sessionId: 'session-1',
        messageId: 'message-1',
        tasks: [
          expect.objectContaining({ taskId: '1', position: 1, title: 'Run tests', status: 'COMPLETED' }),
          expect.objectContaining({ taskId: '2', position: 2, title: 'Deploy preview', status: 'IN_PROGRESS' }),
        ],
      })
    );
  });

  it('does not leak a task plan from another session when the selected child conversation has none', () => {
    const parentMessage = createAssistantMessage({
      sessionId: 'parent-session',
      taskPlan: {
        planId: 'parent-plan',
        version: 1,
        title: 'Parent plan',
        status: 'ACTIVE',
        sessionId: 'parent-session',
        messageId: 'message-1',
        tasks: [{ taskId: 'task-1', position: 1, title: 'Parent task', status: 'PENDING' }],
      },
    });

    expect(selectLatestTaskPlan([parentMessage], 'child-session')).toBeUndefined();
  });

  it('prefers the native latest snapshot when one message also contains a compatibility plan event', () => {
    const message = createAssistantMessage({
      taskPlan: {
        planId: 'native-plan',
        version: 4,
        title: 'Native latest plan',
        status: 'ACTIVE',
        sessionId: 'session-1',
        messageId: 'message-1',
        tasks: [{ taskId: 'native-task', position: 1, title: 'Native task', status: 'IN_PROGRESS' }],
      },
      thinkList: [
        {
          uuid: 'compatibility-plan',
          contentType: SSEMessageType.taskOutline,
          status: SSEEventStatus.done,
          orginContent: '',
          content: {
            substance: JSON.stringify({
              task_description: 'Compatibility plan',
              steps: [
                {
                  sub_steps: [
                    { id: '1', step_description: 'Compatibility task', tool_metadata: { status: 'pending' } },
                  ],
                },
              ],
            }),
          },
        },
      ],
    });

    expect(selectLatestTaskPlan([message])?.title).toBe('Native latest plan');
  });

  it('prefers a newer streamed 2008 plan over the reconnect baseline', () => {
    const message = createAssistantMessage({
      taskPlan: {
        planId: 'reconnect-baseline',
        version: 2,
        title: 'Plan B',
        status: 'ACTIVE',
        sessionId: 'session-1',
        messageId: 'message-1',
        updatedAt: '2026-08-29T02:18:02.015Z',
        tasks: [{ taskId: '1', position: 1, title: 'Verify', status: 'IN_PROGRESS' }],
      },
      thinkList: [
        {
          uuid: 'plan-after-resume',
          contentType: SSEMessageType.taskOutline,
          status: SSEEventStatus.done,
          orginContent: '',
          seq: 20,
          content: {
            substance: JSON.stringify({
              planId: 'completed-plan',
              updatedAt: '2026-08-29T02:20:49.000Z',
              task_description: 'Plan B complete',
              steps: [
                {
                  sub_steps: [{ id: '1', step_description: 'Verify', tool_metadata: { status: 'completed' } }],
                },
              ],
            }),
          },
        },
      ],
    });

    expect(selectLatestTaskPlan([message])?.planId).toBe('completed-plan');
  });
});
