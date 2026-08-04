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
  beforeEach(() => {
    mockPageSkillGroups.mockReset();
    mockEmit.mockReset();
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

    expect(await screen.findByTestId('skill-group-empty')).toBeTruthy();
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
});

describe('SkillGroupCard', () => {
  it('renders a deterministic fallback collage and activates from the keyboard', () => {
    const onClick = jest.fn();
    render(<SkillGroupCard group={createGroup()} onClick={onClick} />);

    expect(screen.getByTestId('skill-group-fallback-cover')).toBeTruthy();
    expect(screen.getByText('FI')).toBeTruthy();
    expect(screen.getByText('SE')).toBeTruthy();

    const card = screen.getByRole('button', { name: /Group One/ });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('is focusable and keeps the waterfall card contract in CSS', () => {
    const card = render(<SkillGroupCard group={createGroup()} onClick={jest.fn()} />).getByRole('button', {
      name: /Group One/,
    });
    expect(card).toHaveAttribute('tabindex', '0');

    const listStyles = readFileSync(resolve(__dirname, '../index.module.less'), 'utf8');
    const cardStyles = readFileSync(resolve(__dirname, '../../SkillGroupCard/index.module.less'), 'utf8');
    expect(listStyles).toMatch(/column-count:\s*4/);
    expect(listStyles).toMatch(/column-gap:/);
    expect(listStyles).toMatch(/column-count:\s*3/);
    expect(listStyles).toMatch(/column-count:\s*2/);
    expect(listStyles).toMatch(/column-count:\s*1/);
    expect(cardStyles).toMatch(/break-inside:\s*avoid/);
  });

  it('does not expose button semantics when no click handler is provided', () => {
    render(<SkillGroupCard group={createGroup()} />);

    expect(screen.queryByRole('button', { name: /Group One/ })).toBeNull();
    expect(screen.getByText('Group One').closest('[tabindex]')).toBeNull();
  });
});
