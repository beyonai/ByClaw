import React, { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { chatModeMap } from '@/constants/query';
import RichInput, { RichInputRef } from '../index';
import { ResourceType } from '../utils/constants';
import getElementData from '../utils/getElementData';
import type { MentionElementType } from '../elements/mention';
import type { DefaultValueSchema } from '../types';

let mockDefaultAgentElement: MentionElementType | undefined;

const mockEventEmitter = {
  emit: jest.fn(),
  off: jest.fn(),
  on: jest.fn(),
};
const mockIntl = {
  formatMessage: ({ id }: { id: string }) => id,
};

jest.mock('@umijs/max', () => ({
  getIntl: () => mockIntl,
  useIntl: () => mockIntl,
}));

jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: mockEventEmitter }));
jest.mock('../mentionPopover', () => () => null);
jest.mock('../useDefaultAgentElement', () => () => mockDefaultAgentElement);
jest.mock('../useDefaultAgentPlaceholder', () => () => ({ agentPlaceholder: null, isComposing: { current: false } }));

describe('RichInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDefaultAgentElement = undefined;
  });

  const historyEmployee = (agentId = 'history-agent'): MentionElementType => ({
    ...(getElementData(ResourceType.digitalEmployee, {
      agentId,
      agentType: '001',
      name: 'History Employee',
    }) as MentionElementType),
    isDefaultAgent: true,
    children: [{ text: '' }],
  });

  it.each<DefaultValueSchema>([
    { text: 'Unsent text', resourceList: [] },
    {
      text: '{{draft-employee}} Unsent text {{draft-reference}}',
      resourceList: [
        {
          id: 'draft-employee',
          resourceType: ResourceType.digitalEmployee,
          resourceId: 'draft-agent',
          resourceName: 'Draft Employee',
          agentType: '001',
        },
        {
          id: 'draft-reference',
          resourceType: ResourceType.dataSource,
          resourceId: '17',
          resourceName: 'Analytics',
        },
      ],
    },
  ])('restores only the draft without adding an existing or late history employee: %j', async (draft) => {
    mockDefaultAgentElement = historyEmployee();
    const inputRef = createRef<RichInputRef>();
    const view = render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote inputDraft={draft} />);
    await act(async () => inputRef.current?.setText(draft));
    const expectedIds = (draft.resourceList || []).map((resource) => resource.resourceId);
    expect(inputRef.current?.getPayload().resourceList.map((resource) => resource.resourceId)).toEqual(expectedIds);
    expect(view.container.textContent).not.toContain('History Employee');

    // 会话详情和员工信息可能晚于草稿恢复，不能在异步更新后补入历史员工。
    mockDefaultAgentElement = historyEmployee('late-history-agent');
    view.rerender(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote inputDraft={draft} />);
    expect(inputRef.current?.getPayload().resourceList.map((resource) => resource.resourceId)).toEqual(expectedIds);
    expect(view.container.textContent).not.toContain('History Employee');

    await act(async () => inputRef.current?.setText(''));
    view.rerender(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote inputDraft={{ text: '' }} />);
    expect(inputRef.current?.getPayload().resourceList).toEqual([]);
  });

  it.each<DefaultValueSchema>([
    { text: 'Saved task prompt', resourceList: [] },
    { text: '', resourceList: [] },
  ])('keeps explicit task content free of existing and late history employees: %j', async (initialInputValue) => {
    mockDefaultAgentElement = historyEmployee();
    const inputRef = createRef<RichInputRef>();
    const view = render(
      <RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote initialInputValue={initialInputValue} />
    );
    await act(async () => inputRef.current?.setText(initialInputValue));
    expect(inputRef.current?.getPayload()).toMatchObject(initialInputValue);
    mockDefaultAgentElement = historyEmployee('late-history-agent');
    view.rerender(
      <RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote initialInputValue={initialInputValue} />
    );
    expect(inputRef.current?.getPayload()).toMatchObject(initialInputValue);
    expect(view.container.textContent).not.toContain('History Employee');
  });

  it.each([undefined, { text: '', resourceList: [] }])(
    'automatically mentions the history employee when there is no draft: %j',
    async (draft) => {
      const inputRef = createRef<RichInputRef>();
      const view = render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote inputDraft={draft} />);
      // 无草稿时仍等待并展示异步返回的历史会话员工。
      mockDefaultAgentElement = historyEmployee();
      view.rerender(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote inputDraft={draft} />);
      await waitFor(() => {
        expect(inputRef.current?.getPayload().resourceList.map((resource) => resource.resourceId)).toEqual([
          'history-agent',
        ]);
        expect(view.container.textContent).toContain('History Employee');
      });
    }
  );

  it('does not carry an automatically restored employee into the next history session or a new session', async () => {
    const onDraftChange = jest.fn();
    const inputRef = createRef<RichInputRef>();
    mockDefaultAgentElement = historyEmployee('history-a');
    const view = render(
      <RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote onDraftChange={onDraftChange} />
    );
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith({ text: '', resourceList: [] }));
    expect(inputRef.current?.getPersistentMentionDraft(true)).toEqual({ text: '', resourceList: [] });
    expect(inputRef.current?.getPersistentMentionDraft()).toEqual({ text: '', resourceList: [] });
    view.unmount();

    mockDefaultAgentElement = historyEmployee('history-b');
    const next = render(
      <RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote inputDraft={{ text: '', resourceList: [] }} />
    );
    await waitFor(() => {
      expect(inputRef.current?.getPayload().resourceList.map((resource) => resource.resourceId)).toEqual(['history-b']);
    });
    next.unmount();
    mockDefaultAgentElement = undefined;
    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);
    expect(inputRef.current?.getPayload().resourceList).toEqual([]);
  });

  it('saves a draft after typing and clears it when only the automatic employee remains', async () => {
    mockDefaultAgentElement = historyEmployee();
    const inputRef = createRef<RichInputRef>();
    const onDraftChange = jest.fn();
    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote onDraftChange={onDraftChange} />);
    await act(async () => inputRef.current?.appendText('My question'));
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: expect.stringContaining('My question') })
    );
    expect(inputRef.current?.getPersistentMentionDraft(true).resourceList).toEqual([
      expect.objectContaining({ resourceId: 'history-agent' }),
    ]);
    await act(async () => inputRef.current?.setText(''));
    expect(onDraftChange).toHaveBeenLastCalledWith({ text: '', resourceList: [] });
    expect(inputRef.current?.getPayload().resourceList).toEqual([
      expect.objectContaining({ resourceId: 'history-agent' }),
    ]);
  });

  it('treats a manually selected employee without question text as a draft', async () => {
    mockDefaultAgentElement = historyEmployee();
    const inputRef = createRef<RichInputRef>();
    const onDraftChange = jest.fn();
    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote onDraftChange={onDraftChange} />);
    await act(async () => {
      inputRef.current?.insertItem(
        { agentId: 'manual-agent', agentType: '001', name: 'Selected Employee' },
        ResourceType.digitalEmployee
      );
    });
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resourceList: expect.arrayContaining([expect.objectContaining({ resourceId: 'manual-agent' })]),
      })
    );
    // 发送后保留手选员工，自动员工不成为跨会话草稿。
    expect(inputRef.current?.getPersistentMentionDraft().resourceList.map((resource) => resource.resourceId)).toEqual([
      'manual-agent',
    ]);
  });

  it('serializes a data source reference into the actual send payload without connection fields', async () => {
    const inputRef = createRef<RichInputRef>();
    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);
    const listener = mockEventEmitter.on.mock.calls.find(([eventName]) => eventName === 'queryInput-insert-item')?.[1];
    await act(async () => {
      listener({
        item: {
          resourceId: '17',
          resourceName: 'Analytics',
          password: 'must-not-leak',
          config: { host: 'must-not-leak' },
        },
        type: ResourceType.dataSource,
      });
    });
    await waitFor(() => {
      expect(inputRef.current?.getPayload().text).toContain('{{DATA_SOURCE_17}}');
      expect(inputRef.current?.getPayload().resourceList).toEqual([
        expect.objectContaining({ resourceType: 'DATA_SOURCE', resourceId: '17', resourceName: 'Analytics' }),
      ]);
    });
    expect(JSON.stringify(inputRef.current?.getPayload())).not.toContain('must-not-leak');
  });

  it.each([
    [ResourceType.digitalEmployee, { agentId: 'agent-1', agentType: '001', name: 'Employee One' }],
    [ResourceType.dataSource, { resourceId: '17', resourceName: 'Analytics' }],
  ] as const)('appends text immediately after inserting a %s reference', async (resourceType, resource) => {
    const inputRef = createRef<RichInputRef>();
    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);

    await act(async () => {
      inputRef.current?.insertItem(resource, resourceType);
      inputRef.current?.appendText('Immediate question');
      // 必须在光标定时器执行前读取，验证连续调用不会静默丢字。
      expect(inputRef.current?.getPersistentMentionDraft(true).text).toContain('Immediate question');
    });
    expect(inputRef.current?.getPayload().text).toContain('Immediate question');
    expect(inputRef.current?.getPayload().resourceList).toHaveLength(1);
  });

  it('saves the latest unsent text and references and restores them into a new editor', async () => {
    const inputRef = createRef<RichInputRef>();
    const onDraftChange = jest.fn();
    const view = render(
      <RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote onDraftChange={onDraftChange} />
    );
    await act(async () => {
      inputRef.current?.insertItem(
        { agentId: 'agent-1', agentType: '001', name: 'Employee One' },
        ResourceType.digitalEmployee
      );
      inputRef.current?.insertItem({ resourceId: '17', resourceName: 'Analytics' }, ResourceType.dataSource);
      inputRef.current?.appendText('First line\nLast unsent input');
      expect(inputRef.current?.getPersistentMentionDraft(true).text).toContain('Last unsent input');
    });
    const draft = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0];
    expect(draft.text).toContain('Last unsent input');
    expect(draft.resourceList.map((item: { resourceId: string }) => item.resourceId)).toEqual(['agent-1', '17']);
    view.unmount();

    const restoredRef = createRef<RichInputRef>();
    render(<RichInput ref={restoredRef} chatMode={chatModeMap.expert} canQuote />);
    await act(async () => restoredRef.current?.setText(draft));
    expect(restoredRef.current?.getPayload().text).toBe(draft.text);
    // 发送 payload 不携带仅用于草稿恢复的员工状态字段，但必须保留所有引用。
    const restoredResources = restoredRef.current?.getPayload().resourceList || [];
    expect(restoredResources).toEqual(
      draft.resourceList.map(({ agentType, isInactiveAgentSelection, ...resource }) => resource)
    );

    await act(async () => restoredRef.current?.clearAfterSend());
    const retained = restoredRef.current?.getPersistentMentionDraft(true);
    expect(retained?.text).not.toContain('Last unsent input');
    expect(retained?.resourceList.map((item) => item.resourceId)).toEqual(['agent-1']);
  });

  it('keeps the resource quote listener stable while the input rerenders', async () => {
    const inputRef = createRef<RichInputRef>();
    const view = render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);
    const listener = mockEventEmitter.on.mock.calls.find(([eventName]) => eventName === 'queryInput-insert-item')?.[1];

    expect(listener).toEqual(expect.any(Function));
    expect(mockEventEmitter.on).toHaveBeenCalledTimes(1);

    view.rerender(
      <RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote defaultPlaceholder="Answering..." />
    );

    expect(mockEventEmitter.on).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.off).not.toHaveBeenCalled();

    await act(async () => {
      listener({ item: { agentId: 'agent-1', name: 'Employee One' }, type: ResourceType.digitalEmployee });
    });

    await waitFor(() => {
      expect(inputRef.current?.getPayload().resourceList).toEqual([
        expect.objectContaining({ resourceId: 'agent-1', resourceName: 'Employee One' }),
      ]);
    });
  });

  it('inserts a selected employee skill without switching or duplicating the employee', async () => {
    const inputRef = createRef<RichInputRef>();

    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);

    await waitFor(() => {
      expect(inputRef.current).not.toBeNull();
    });

    await act(async () => {
      inputRef.current?.insertItem(
        {
          agentId: '10000713',
          agentType: '001',
          chatAvatar: 'employee.png',
          name: 'Article Assistant',
        },
        ResourceType.digitalEmployee
      );
    });

    await waitFor(() => {
      expect(inputRef.current?.getPayload().resourceList).toHaveLength(1);
    });

    await act(async () => {
      inputRef.current?.insertItem(
        {
          agentId: '10000713',
          agentName: 'Article Assistant',
          agentType: '001',
          chatAvatar: 'employee.png',
          resourceBizType: 'SKILL',
          resourceCode: 'file-path-format',
          resourceId: '10000632',
          resourceName: 'file-path-format',
        },
        ResourceType.agentTool
      );
    });

    await waitFor(() => {
      const payload = inputRef.current?.getPayload();

      expect(payload?.resourceList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ resourceId: '10000713', resourceName: 'Article Assistant' }),
          expect.objectContaining({ resourceId: '10000632', resourceName: 'file-path-format' }),
        ])
      );
      expect(payload?.displayText).toContain('#file-path-format');
      expect(payload?.displayText).not.toContain('{{');
    });

    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('queryInput-set-schema', expect.anything());
  });

  it('keeps all mentioned digital employees after sending and clears only the question text', async () => {
    const inputRef = createRef<RichInputRef>();

    render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);

    await act(async () => {
      inputRef.current?.insertItem({ agentId: 'agent-1', name: 'Employee One' }, ResourceType.digitalEmployee);
      inputRef.current?.insertItem({ agentId: 'agent-2', name: 'Employee Two' }, ResourceType.digitalEmployee);
      inputRef.current?.appendText('Please handle this task');
    });

    await waitFor(() => {
      expect(inputRef.current?.getPayload().resourceList).toHaveLength(2);
    });

    await act(async () => {
      inputRef.current?.clearAfterSend();
    });

    await waitFor(() => {
      const payload = inputRef.current?.getPayload();
      expect(payload?.resourceList.map((item) => item.resourceId)).toEqual(['agent-1', 'agent-2']);
      expect(payload?.displayText).toContain('@Employee One');
      expect(payload?.displayText).toContain('@Employee Two');
      expect(payload?.displayText).not.toContain('Please handle this task');
    });
  });

  it('keeps replaced employees visible but sends only the active digital employee group', async () => {
    const inputRef = createRef<RichInputRef>();
    const { container } = render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);

    await act(async () => {
      inputRef.current?.insertItem(
        { agentId: 'agent-1', agentType: '001', name: 'Employee One' },
        ResourceType.digitalEmployee
      );
      inputRef.current?.insertItem(
        { agentId: 'group-1', agentType: '017', name: 'Employee Group' },
        ResourceType.digitalEmployee
      );
    });

    await waitFor(() => {
      const payload = inputRef.current?.getPayload();
      expect(payload?.resourceList.map((item) => item.resourceId)).toEqual(['group-1']);
      expect(payload?.resourceList[0]).not.toHaveProperty('isInactiveAgentSelection');
      expect(payload?.displayText).toContain('@Employee Group');
      expect(payload?.displayText).not.toContain('@Employee One');

      const inactiveNode = container.querySelector('[data-inactive-agent-selection="true"]');
      expect(inactiveNode).not.toBeNull();
      expect(inactiveNode?.textContent).toContain('Employee One');
    });

    const draft = inputRef.current?.getPersistentMentionDraft();
    expect(draft).toBeDefined();
    expect(draft?.resourceList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: 'agent-1', isInactiveAgentSelection: true }),
        expect.objectContaining({ resourceId: 'group-1', isInactiveAgentSelection: false }),
      ])
    );

    await act(async () => {
      inputRef.current?.clearAfterSend();
    });

    await waitFor(() => {
      expect(container.querySelector('[data-inactive-agent-selection="true"]')?.textContent).toContain('Employee One');
      expect(inputRef.current?.getPayload().resourceList.map((item) => item.resourceId)).toEqual(['group-1']);
    });

    const restoredRef = createRef<RichInputRef>();
    const restored = render(<RichInput ref={restoredRef} chatMode={chatModeMap.expert} canQuote />);
    await act(async () => {
      restoredRef.current?.setText(draft!);
    });

    await waitFor(() => {
      expect(restoredRef.current?.getPayload().resourceList.map((item) => item.resourceId)).toEqual(['group-1']);
      expect(restored.container.querySelector('[data-inactive-agent-selection="true"]')?.textContent).toContain(
        'Employee One'
      );
    });
  });

  it('deactivates an active group when an ordinary employee is selected', async () => {
    const inputRef = createRef<RichInputRef>();
    const { container } = render(<RichInput ref={inputRef} chatMode={chatModeMap.expert} canQuote />);

    await act(async () => {
      inputRef.current?.insertItem(
        { agentId: 'group-1', agentType: '017', name: 'Employee Group' },
        ResourceType.digitalEmployee
      );
      inputRef.current?.insertItem(
        { agentId: 'agent-1', agentType: '001', name: 'Employee One' },
        ResourceType.digitalEmployee
      );
    });

    await waitFor(() => {
      const payload = inputRef.current?.getPayload();
      expect(payload?.resourceList.map((item) => item.resourceId)).toEqual(['agent-1']);
      expect(payload?.displayText).toContain('@Employee One');
      expect(payload?.displayText).not.toContain('@Employee Group');
      expect(container.querySelector('[data-inactive-agent-selection="true"]')?.textContent).toContain(
        'Employee Group'
      );
    });
  });
});
