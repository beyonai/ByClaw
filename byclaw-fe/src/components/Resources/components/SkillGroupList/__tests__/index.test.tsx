jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) =>
      values ? `${id}:${Object.values(values).join(',')}` : id,
  }),
}));

const mockPageSkillGroups = jest.fn();
const mockEmit = jest.fn();

jest.mock('@/pages/manager/service/resources', () => ({
  pageSkillGroups: (...args: any[]) => mockPageSkillGroups(...args),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: mockEmit }, agentId: 'global-agent' }),
}));

jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: ({ children, next, hasMore, dataLength }: any) => (
    <div data-testid="infinite-scroll" data-has-more={String(hasMore)} data-length={dataLength}>
      <button type="button" onClick={() => next()} disabled={!hasMore}>
        load-more
      </button>
      {children}
    </div>
  ),
}));

jest.mock('antd', () => ({
  ...jest.requireActual('antd'),
  Dropdown: ({ children, menu }: any) => (
    <div>
      {children}
      {menu?.items?.map((item: any) => (
        <button key={item.key} type="button" aria-label={item.label} onClick={() => item.onClick({ domEvent: { stopPropagation: jest.fn() } })}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SkillGroupCard from '../../SkillGroupCard';
import SkillGroupList, { isSkillGroupRequestActive } from '..';
import type { SkillGroup } from '@/pages/manager/service/resources';

const createGroup = (overrides: Partial<SkillGroup> = {}): SkillGroup => ({
  resourceId: 'group-1',
  resourceName: 'Group One',
  resourceDesc: 'A useful group',
  avatar: '',
  catalogId: 'catalog-1',
  ownerType: 'PERSONAL',
  resourceStatus: 1,
  createBy: 'Alice',
  createTime: '',
  updateTime: '',
  memberCount: 2,
  members: [
    { resourceId: 'skill-1', resourceName: 'First', avatar: '' } as any,
    { resourceId: 'skill-2', resourceName: 'Second', avatar: '' } as any,
  ],
  ...overrides,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

describe('SkillGroupList', () => {
  let originalResizeObserver: typeof window.ResizeObserver;

  beforeEach(() => {
    mockPageSkillGroups.mockReset();
    mockEmit.mockReset();
    originalResizeObserver = window.ResizeObserver;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    });
  });

  it('fetches and renders the first page', async () => {
    mockPageSkillGroups.mockResolvedValue({ data: { pageNum: 1, pageSize: 20, total: 1, list: [createGroup()] } });

    render(
      <SkillGroupList keyword="sales" activeDigitalEmployeeId={42 as any} ownerType="enterprise" resourceStatus={1} />
    );

    await waitFor(() => expect(screen.getByText('Group One')).toBeTruthy());
    expect(mockPageSkillGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNum: 1,
        pageSize: 20,
        keyword: 'sales',
        ownerType: 'enterprise',
        resourceStatus: 1,
      })
    );
  });

  it('shows an empty state when the first page has no groups', async () => {
    mockPageSkillGroups.mockResolvedValue({ data: { pageNum: 1, pageSize: 20, total: 0, list: [] } });

    render(<SkillGroupList />);

    expect(await screen.findByTestId('skill-group-empty')).toHaveClass('ant-empty');
  });

  it('shows loading and error states for the first page request', async () => {
    const request = deferred<unknown>();
    mockPageSkillGroups.mockReturnValue(request.promise);

    render(<SkillGroupList />);
    expect(screen.getByTestId('skill-group-loading')).toBeTruthy();

    request.reject(new Error('network error'));
    expect(await screen.findByTestId('skill-group-error')).toBeTruthy();
  });

  it('appends the next page without replacing the first page', async () => {
    mockPageSkillGroups
      .mockResolvedValueOnce({ data: { pageNum: 1, pageSize: 1, total: 2, totalPages: 2, list: [createGroup()] } })
      .mockResolvedValueOnce({
        data: {
          pageNum: 2,
          pageSize: 1,
          total: 2,
          totalPages: 2,
          rows: [createGroup({ resourceId: 'group-2', resourceName: 'Group Two' })],
        },
      });

    render(<SkillGroupList />);
    await screen.findByText('Group One');
    fireEvent.click(screen.getByRole('button', { name: 'load-more' }));

    await waitFor(() => expect(screen.getByText('Group Two')).toBeTruthy());
    expect(screen.getByText('Group One')).toBeTruthy();
    expect(mockPageSkillGroups).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 2, pageSize: 20 }));
  });

  it('keeps the first group when the next page repeats its resource ID', async () => {
    mockPageSkillGroups
      .mockResolvedValueOnce({
        data: { pageNum: 1, total: 2, totalPages: 2, list: [createGroup({ resourceId: 7 as any })] },
      })
      .mockResolvedValueOnce({
        data: {
          pageNum: 2,
          total: 2,
          totalPages: 2,
          list: [createGroup({ resourceId: '7', resourceName: 'Duplicate Group' })],
        },
      });

    render(<SkillGroupList />);
    await screen.findByText('Group One');
    fireEvent.click(screen.getByRole('button', { name: 'load-more' }));

    await waitFor(() => expect(screen.queryByText('Duplicate Group')).toBeNull());
    expect(screen.getByText('Group One')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Group/ })).toHaveLength(1);
  });

  it('filters groups without a valid resource ID before rendering', async () => {
    mockPageSkillGroups.mockResolvedValue({
      data: {
        pageNum: 1,
        total: 3,
        list: [
          createGroup({ resourceId: undefined as any, resourceName: 'Missing ID' }),
          createGroup({ resourceId: null as any, resourceName: 'Null ID' }),
          createGroup({ resourceId: '', resourceName: 'Empty ID' }),
          createGroup({ resourceId: 'valid-id', resourceName: 'Valid Group' }),
        ],
      },
    });

    render(<SkillGroupList />);

    expect(await screen.findByText('Valid Group')).toBeTruthy();
    expect(screen.queryByText('Missing ID')).toBeNull();
    expect(screen.queryByText('Null ID')).toBeNull();
    expect(screen.queryByText('Empty ID')).toBeNull();
  });

  it('keeps the first page visible when an append request fails', async () => {
    mockPageSkillGroups
      .mockResolvedValueOnce({ data: { pageNum: 1, total: 2, totalPages: 2, list: [createGroup()] } })
      .mockRejectedValueOnce(new Error('append failed'));

    render(<SkillGroupList />);
    await screen.findByText('Group One');
    fireEvent.click(screen.getByRole('button', { name: 'load-more' }));

    expect(await screen.findByTestId('skill-group-error')).toBeTruthy();
    expect(screen.getByText('Group One')).toBeTruthy();
  });

  it('invalidates request results after unmount', async () => {
    const request = deferred<any>();
    mockPageSkillGroups.mockReturnValue(request.promise);
    const view = render(<SkillGroupList />);
    view.unmount();

    await act(async () => {
      request.resolve({ data: { pageNum: 1, total: 1, list: [createGroup()] } });
      await request.promise;
    });

    expect(isSkillGroupRequestActive(false, 1, 1)).toBe(false);
    expect(isSkillGroupRequestActive(true, 1, 2)).toBe(false);
    expect(isSkillGroupRequestActive(true, 1, 1)).toBe(true);
  });

  it('does not issue duplicate page loads while an append request is pending', async () => {
    const firstPage = deferred<any>();
    const secondPage = deferred<any>();
    mockPageSkillGroups.mockReturnValueOnce(firstPage.promise).mockReturnValueOnce(secondPage.promise);

    render(<SkillGroupList />);
    firstPage.resolve({ data: { pageNum: 1, total: 2, totalPages: 2, list: [createGroup()] } });
    await screen.findByText('Group One');

    const loadMore = screen.getByRole('button', { name: 'load-more' });
    fireEvent.click(loadMore);
    fireEvent.click(loadMore);
    expect(mockPageSkillGroups).toHaveBeenCalledTimes(2);

    secondPage.resolve({
      data: {
        pageNum: 2,
        total: 2,
        totalPages: 2,
        list: [createGroup({ resourceId: 'group-2', resourceName: 'Group Two' })],
      },
    });
    await screen.findByText('Group Two');
  });

  it('ignores a stale first-page response after the query changes', async () => {
    const firstRequest = deferred<any>();
    const secondRequest = deferred<any>();
    mockPageSkillGroups.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);

    const view = render(<SkillGroupList keyword="old" />);
    await waitFor(() => expect(mockPageSkillGroups).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'old' })));
    view.rerender(<SkillGroupList keyword="new" />);
    await waitFor(() => expect(mockPageSkillGroups).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'new' })));

    secondRequest.resolve({
      data: { pageNum: 1, total: 1, list: [createGroup({ resourceId: 'new-group', resourceName: 'New Group' })] },
    });
    await screen.findByText('New Group');
    firstRequest.resolve({
      data: { pageNum: 1, total: 1, list: [createGroup({ resourceId: 'old-group', resourceName: 'Old Group' })] },
    });

    await waitFor(() => expect(screen.queryByText('Old Group')).toBeNull());
    expect(screen.getByText('New Group')).toBeTruthy();
  });

  it('emits the exact detail events when a card is clicked', async () => {
    mockPageSkillGroups.mockResolvedValue({ data: { total: 1, list: [createGroup()] } });
    render(<SkillGroupList activeDigitalEmployeeId={42 as any} />);

    fireEvent.click(await screen.findByRole('button', { name: /Group One/ }));

    expect(mockEmit).toHaveBeenNthCalledWith(1, 'beyond-absolute-driver-message', {
      groupId: 'group-1',
      digitalEmployeeId: '42',
    });
    expect(mockEmit).toHaveBeenNthCalledWith(2, 'beyond-absolute-driver-open-type', {
      drawerType: 'skillGroupDetail',
      title: 'Group One',
    });
  });

  it('reflows the masonry columns when the list width grows', async () => {
    let resizeCallback!: ResizeObserverCallback;
    const observe = jest.fn();
    const disconnect = jest.fn();
    const resizeObserver = { observe, disconnect, unobserve: jest.fn() } as unknown as ResizeObserver;

    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: jest.fn((callback: ResizeObserverCallback) => {
        resizeCallback = callback;
        return resizeObserver;
      }),
    });
    mockPageSkillGroups.mockResolvedValue({
      data: {
        total: 5,
        list: Array.from({ length: 5 }, (_, index) =>
          createGroup({ resourceId: `group-${index + 1}`, resourceName: `Group ${index + 1}` })
        ),
      },
    });

    const view = render(<SkillGroupList />);
    await screen.findByText('Group 5');

    expect(observe).toHaveBeenCalledWith(screen.getByTestId('skill-group-grid'));

    act(() => {
      resizeCallback([{ contentRect: { width: 1086 } } as ResizeObserverEntry], resizeObserver);
    });
    expect(screen.getAllByTestId('skill-group-column')).toHaveLength(3);

    act(() => {
      resizeCallback([{ contentRect: { width: 1488 } } as ResizeObserverEntry], resizeObserver);
    });
    expect(screen.getAllByTestId('skill-group-column')).toHaveLength(5);

    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to the window resize event when ResizeObserver is unavailable', async () => {
    let gridWidth = 1086;
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth() {
      return this.dataset.testid === 'skill-group-grid' ? gridWidth : 0;
    });
    mockPageSkillGroups.mockResolvedValue({
      data: {
        total: 5,
        list: Array.from({ length: 5 }, (_, index) =>
          createGroup({ resourceId: `group-${index + 1}`, resourceName: `Group ${index + 1}` })
        ),
      },
    });

    render(<SkillGroupList />);
    await screen.findByText('Group 5');
    expect(screen.getAllByTestId('skill-group-column')).toHaveLength(3);

    gridWidth = 1488;
    act(() => window.dispatchEvent(new Event('resize')));

    expect(screen.getAllByTestId('skill-group-column')).toHaveLength(5);
  });
});

describe('SkillGroupCard', () => {
  it('uses the default cover while the group cover is unavailable and activates from the keyboard', () => {
    const onClick = jest.fn();
    render(<SkillGroupCard group={createGroup()} onClick={onClick} />);

    expect(screen.getByTestId('skill-group-default-cover')).toHaveAttribute(
      'src',
      '/assets/skill-groups/default-skill-group-cover-3x4.png'
    );

    const card = screen.getByRole('button', { name: /Group One/ });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default cover when the group cover fails to load', () => {
    render(<SkillGroupCard group={createGroup({ avatar: '/invalid-cover.png' })} />);

    fireEvent.error(screen.getByRole('img', { name: '' }));

    expect(screen.getByTestId('skill-group-default-cover')).toBeTruthy();
  });

  it('resolves backend preview paths before rendering the group cover', () => {
    render(
      <SkillGroupCard group={createGroup({ avatar: '/commonFile/preview?style=file&filePath=/covers/group.png' })} />
    );

    expect(screen.getByRole('img', { name: '' })).toHaveAttribute(
      'src',
      '/byaiService/commonFile/preview?style=file&filePath=/covers/group.png'
    );
  });

  it('is focusable and keeps the waterfall card contract in CSS', () => {
    const card = render(<SkillGroupCard group={createGroup()} onClick={jest.fn()} />).getByRole('button', {
      name: /Group One/,
    });
    expect(card).toHaveAttribute('tabindex', '0');

    const listStyles = readFileSync(resolve(__dirname, '../index.module.less'), 'utf8');
    const cardStyles = readFileSync(resolve(__dirname, '../../SkillGroupCard/index.module.less'), 'utf8');
    expect(listStyles).toMatch(/\.grid\s*{[\s\S]*?display:\s*grid/);
    expect(listStyles).toMatch(/\.column\s*{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
    expect(listStyles).not.toMatch(/column-count:/);
    expect(listStyles).not.toMatch(/@container/);
    expect(cardStyles).toMatch(/break-inside:\s*avoid/);
    expect(cardStyles).toMatch(/\.cover\s*{[\s\S]*aspect-ratio:\s*3\s*\/\s*4/);
    expect(cardStyles).toMatch(/max-width:\s*360px/);
    expect(cardStyles).toMatch(/max-height:\s*480px/);
    expect(cardStyles).toMatch(/\.coverImage[\s\S]*object-fit:\s*cover/);
    expect(cardStyles).toMatch(/\.content\s*{[\s\S]*border-right:/);
    expect(cardStyles).toMatch(/\.content\s*{[\s\S]*border-bottom:/);
    expect(cardStyles).toMatch(/\.content\s*{[\s\S]*border-left:/);
    expect(cardStyles).toMatch(/var\(~'--@\{antPrefix\}-color-border-secondary'\)/);
    expect(cardStyles).not.toMatch(/var\(--ant-color-border\)/);
    expect(cardStyles).toMatch(/\.card:hover \.coverImage[\s\S]*transform:\s*scale\(1\.3\)/);
    expect(cardStyles).toMatch(/\.card:hover \.defaultCoverImage[\s\S]*transform:\s*scale\(1\.3\)/);
    expect(cardStyles).not.toMatch(/transform:\s*translateY/);
  });

  it('does not expose button semantics when no click handler is provided', () => {
    render(<SkillGroupCard group={createGroup()} />);

    expect(screen.queryByRole('button', { name: /Group One/ })).toBeNull();
    expect(screen.getByText('Group One').closest('[tabindex]')).toBeNull();
  });

  it('shows edit and delete actions together only when group management is allowed', () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const { rerender } = render(
      <SkillGroupCard group={createGroup()} canDelete onEdit={onEdit} onDelete={onDelete} />
    );

    expect(screen.getByRole('button', { name: 'resource.skillGroup.edit' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'resource.skillGroup.delete' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'resource.skillGroup.edit' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'group-1' }));

    rerender(<SkillGroupCard group={createGroup()} />);
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.delete' })).toBeNull();
  });
});
