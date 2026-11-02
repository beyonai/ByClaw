import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
import { bindMemberAgent, listProjectMembers, unbindMemberAgent } from '@/service/devloop';
import ProjectMemberList from '@/layout/sider/components/ProjectSpaceList/ProjectMemberList';
import ProjectMembers from '.';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
let mockUserId = 1;
const members = [
  { memberId: 1, userId: 1, userName: 'Creator', role: 'owner' },
  { memberId: 2, userId: 2, userName: 'Member', role: 'member', agentId: 20, agentName: 'Old agent' },
];
const project = {
  projectId: '11',
  projectName: 'Project',
  projectType: 'normal',
  createBy: 1,
  isShare: 'N',
  sharedFlag: false,
} as const;

jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl, useSelector: () => ({ userId: mockUserId }) }));
jest.mock('antd', () => ({
  ...jest.requireActual('antd'),
  Dropdown: ({ children, menu, disabled }: any) => (
    <div>
      {children}
      {!disabled &&
        menu.items.map((item: any) => (
          <button type="button" key={item.key} onClick={() => menu.onClick({ key: item.key })}>
            {item.label}
          </button>
        ))}
    </div>
  ),
}));
jest.mock('@/service/devloop', () => ({
  listProjectMembers: jest.fn(),
  saveProjectMembers: jest.fn(),
  bindMemberAgent: jest.fn(),
  unbindMemberAgent: jest.fn(),
}));
jest.mock('@/pages/manager/components/AuthListDrawer/AddAuthModal', () => () => null);
jest.mock('@/pages/manager/components/PersonnelModel', () => ({ dataItemTypeMap: { user: 'user' } }));
jest.mock('@/utils/chat', () => ({ getDisplayUserNameInChat: (name: string) => name.slice(-2) }));
jest.mock('../../hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => ({ current: null }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 1;
  jest.mocked(listProjectMembers).mockResolvedValue(members);
  jest.spyOn(Modal, 'confirm').mockReturnValue({ destroy: jest.fn() } as any);
});
afterEach(() => jest.restoreAllMocks());

const views = ['sidebar', 'compact', 'expanded'] as const;
const memberView = (view: (typeof views)[number]) =>
  view === 'sidebar' ? (
    <ProjectMemberList projectId={11} creatorId={1} />
  ) : (
    <ProjectMembers project={project} compact={view === 'compact'} />
  );

it.each(views)('removes agent binding and keeps member removal in the %s view', async (view) => {
  render(memberView(view));
  const member = await screen.findByText('Member');
  if (view === 'sidebar') fireEvent.mouseEnter(member.closest('.project-member-row')!);
  const remove = screen.getByRole('button', {
    name: view === 'sidebar' ? 'projectSpace.members.remove' : 'projectSpace.members.removeMember',
  });
  fireEvent.click(remove);
  expect(Modal.confirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/projectSpace\.members\.(bindAgent|changeAgent|unbindAgent|unboundAgent)/)).toBeNull();
  expect(screen.queryByText('Old agent')).toBeNull();
  expect(bindMemberAgent).not.toHaveBeenCalled();
  expect(unbindMemberAgent).not.toHaveBeenCalled();
});

it.each(views)('does not expose an empty self-service menu to ordinary members in the %s view', async (view) => {
  mockUserId = 2;
  render(memberView(view));
  const member = await screen.findByText('Member');
  if (view === 'sidebar') fireEvent.mouseEnter(member.closest('.project-member-row')!);
  expect(screen.queryByRole('button', { name: /projectSpace\.members\.(remove|bindAgent|changeAgent)/ })).toBeNull();
  expect(screen.queryByText(/projectSpace\.members\.(bindAgent|changeAgent|unbindAgent|unboundAgent)/)).toBeNull();
});
