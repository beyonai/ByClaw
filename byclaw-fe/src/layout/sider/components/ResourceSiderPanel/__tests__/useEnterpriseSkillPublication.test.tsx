import { act, renderHook, waitFor } from '@testing-library/react';
import { Modal, message } from 'antd';
import { publishSkillToEnterprise } from '@/pages/manager/service/resources';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { useEnterpriseSkillPublication } from '../useEnterpriseSkillPublication';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: any) => id }) }));
jest.mock('antd', () => ({
  Button: () => null,
  Modal: { confirm: jest.fn(), warning: jest.fn() },
  message: { loading: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/pages/manager/service/resources', () => ({ publishSkillToEnterprise: jest.fn() }));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));

const skill = {
  resourceId: 'personal-skill',
  resourceName: 'Personal skill',
  resourceBizType: 'SKILL',
  ownerType: 'personal',
  resourceBacked: true,
  resourceStatus: 2,
  canPublishToEnterprise: true,
};

const setup = () => {
  const onPublished = jest.fn();
  const onDetail = jest.fn();
  return {
    ...renderHook(() => useEnterpriseSkillPublication({ enabled: true, onPublished, onDetail })),
    onPublished,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDcSystemConfig as jest.Mock).mockResolvedValue({ paramValue: 'openSource' });
});

it('requires explicit publication permission on a resource-backed personal skill', async () => {
  const { result } = setup();
  expect(result.current.canPublish(skill)).toBe(false);
  await waitFor(() => expect(result.current.canPublish(skill)).toBe(true));
  for (const overrides of [
    { canPublishToEnterprise: false },
    { canPublishToEnterprise: undefined },
    { ownerType: 'enterprise' },
    { resourceStatus: -1 },
    { resourceBizType: 'TOOL' },
    { resourceBacked: false, skillPath: '/skills/local' },
  ]) {
    expect(result.current.canPublish({ ...skill, ...overrides })).toBe(false);
  }
  expect(result.current.canPublish({ ...skill, ownerType: 'personal_default' })).toBe(true);
});

it('hides publication in the commercial edition', async () => {
  (getDcSystemConfig as jest.Mock).mockResolvedValue({ paramValue: 'commercial' });
  const { result } = setup();
  await act(async () => {});
  expect(result.current.canPublish(skill)).toBe(false);
});

it.each([false, true])('confirms once and updates only the source item (existing=%s)', async (alreadyExists) => {
  (publishSkillToEnterprise as jest.Mock).mockResolvedValue({ resource: { resourceId: 'copy' }, alreadyExists });
  const { result, onPublished } = setup();
  await waitFor(() => expect(result.current.canPublish(skill)).toBe(true));
  act(() => {
    result.current.publish(skill);
    result.current.publish(skill);
  });
  expect(Modal.confirm).toHaveBeenCalledTimes(1);
  expect(publishSkillToEnterprise).not.toHaveBeenCalled();
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());
  expect(publishSkillToEnterprise).toHaveBeenCalledWith('personal-skill');
  expect(onPublished).toHaveBeenCalledWith('personal-skill');
  expect(message.success).toHaveBeenCalled();
  expect(result.current.publishingId).toBeNull();
});

it('allows retry after cancellation or request failure without updating the item', async () => {
  (publishSkillToEnterprise as jest.Mock).mockRejectedValue(new Error('Denied'));
  const { result, onPublished } = setup();
  await waitFor(() => expect(result.current.canPublish(skill)).toBe(true));
  act(() => result.current.publish(skill));
  act(() => (Modal.confirm as jest.Mock).mock.calls[0][0].onCancel());
  act(() => result.current.publish(skill));
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[1][0].onOk());
  expect(onPublished).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalledWith(expect.objectContaining({ content: 'Denied' }));
  act(() => result.current.publish(skill));
  expect(Modal.confirm).toHaveBeenCalledTimes(3);
});

it.each(['string', 'error'])('shows manifest rejection without marking the skill published (%s)', async (kind) => {
  const reason = '无法发布到官方推荐：个人工具「订单查询」（ID：2001）；个人知识「产品资料」（ID：3001）。';
  (publishSkillToEnterprise as jest.Mock).mockRejectedValue(kind === 'string' ? reason : new Error(reason));
  const { result, onPublished } = setup();
  await waitFor(() => expect(result.current.canPublish(skill)).toBe(true));
  act(() => result.current.publish(skill));
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());

  expect(message.error).toHaveBeenCalledWith(expect.objectContaining({ content: reason }));
  expect(message.success).not.toHaveBeenCalled();
  expect(Modal.warning).not.toHaveBeenCalled();
  expect(onPublished).not.toHaveBeenCalled();
  expect(result.current.publishingId).toBeNull();
  act(() => result.current.publish(skill));
  expect(Modal.confirm).toHaveBeenCalledTimes(2);
});

it('submits successfully before showing personal dependency warning', async () => {
  const { result, onPublished } = setup();
  await waitFor(() => expect(result.current.canPublish(skill)).toBe(true));
  (publishSkillToEnterprise as jest.Mock).mockResolvedValue({
    resource: { resourceId: 'copy', resourceStatus: 4 },
    personalDependencies: [{ resourceId: 'personal-tool', resourceName: 'Personal tool', resourceBizType: 'MCP' }],
  });
  act(() => result.current.publish(skill));
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());
  expect(onPublished).toHaveBeenCalledWith('personal-skill');
  expect(Modal.warning).toHaveBeenCalledTimes(1);
  expect(message.success).toHaveBeenCalled();
});
