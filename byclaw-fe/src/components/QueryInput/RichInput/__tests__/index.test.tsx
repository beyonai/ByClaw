import React, { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { chatModeMap } from '@/constants/query';
import RichInput, { RichInputRef } from '../index';
import { ResourceType } from '../utils/constants';

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
jest.mock('../useDefaultAgentElement', () => () => undefined);
jest.mock('../useDefaultAgentPlaceholder', () => () => ({ agentPlaceholder: null, isComposing: { current: false } }));

describe('RichInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
