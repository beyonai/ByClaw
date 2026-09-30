import { Modal } from 'antd';
import { getSkillPublicationPermissions, publishSkillToEnterprise } from '@/pages/manager/service/resources';
import { showSkillPublication, skillPublicationEntryLabel } from '../skillPublication';

jest.mock('@umijs/max', () => ({ getIntl: () => ({ formatMessage: ({ id }: any) => id }) }));
jest.mock('antd', () => ({ Button: () => null, Modal: { confirm: jest.fn() } }));
jest.mock('@/pages/manager/service/resources', () => ({
  getSkillPublicationPermissions: jest.fn(),
  publishSkillToEnterprise: jest.fn(),
}));

const copy = { resourceId: 'copy', resourceName: 'Enterprise skill', resourceStatus: 4 };
beforeEach(() => jest.clearAllMocks());

it.each<[number, string]>([
  [4, 'resource.skillPublicationProgress'],
  [5, 'resource.skillPublicationReviewResult'],
  [2, 'resource.skillPublicationResult'],
  [3, 'resource.skillPublicationResult'],
  [-1, 'resource.skillPublicationResult'],
])('maps persisted status %s to its entry label', (resourceStatus, label) => {
  expect(skillPublicationEntryLabel({ ...copy, resourceStatus })).toBe(label);
});

it('distinguishes a failed request from an existing persisted request', () => {
  expect(skillPublicationEntryLabel()).toBe('resource.publishToEnterprise');
  expect(skillPublicationEntryLabel(undefined, true)).toBe('resource.retrySkillPublication');
  expect(skillPublicationEntryLabel(copy, true)).toBe('resource.skillPublicationProgress');
});

it.each([2, 3, 4, 5, -1])('reads current status without submitting: %s', async (resourceStatus) => {
  const publication = { ...copy, resourceStatus };
  (getSkillPublicationPermissions as jest.Mock).mockResolvedValue({
    canPublishToEnterprise: true,
    skillPublication: publication,
  });
  const onChange = jest.fn();
  const onPublish = jest.fn();
  await showSkillPublication({ sourceId: 'source', onChange, onPublish });
  expect(getSkillPublicationPermissions).toHaveBeenCalledWith('source');
  expect(onChange).toHaveBeenCalledWith(publication);
  expect(onPublish).not.toHaveBeenCalled();
  expect(publishSkillToEnterprise).not.toHaveBeenCalled();
  const dialog = (Modal.confirm as jest.Mock).mock.calls[0][0];
  if (resourceStatus === 5 || resourceStatus === -1) {
    expect(dialog.okText).toBe('resource.skillPublicationResubmit');
    await dialog.onOk();
    expect(onPublish).toHaveBeenCalledTimes(1);
  } else {
    expect(dialog.onOk).toBeUndefined();
  }
});

it('offers a new request when the former copy has been physically removed', async () => {
  (getSkillPublicationPermissions as jest.Mock).mockResolvedValue({ canPublishToEnterprise: true });
  const onChange = jest.fn();
  const onPublish = jest.fn();
  await showSkillPublication({ sourceId: 'source', onChange, onPublish });
  expect(onChange).toHaveBeenCalledWith(undefined);
  await (Modal.confirm as jest.Mock).mock.calls[0][0].onOk();
  expect(onPublish).toHaveBeenCalledTimes(1);
});

it('does not display stale results or submit when loading fails or permission is revoked', async () => {
  const onChange = jest.fn();
  const onPublish = jest.fn();
  (getSkillPublicationPermissions as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
  await expect(showSkillPublication({ sourceId: 'source', onChange, onPublish })).rejects.toThrow('Offline');
  (getSkillPublicationPermissions as jest.Mock).mockResolvedValueOnce({ canPublishToEnterprise: false });
  await expect(showSkillPublication({ sourceId: 'source', onChange, onPublish })).rejects.toThrow(
    'resource.skillPublicationUnavailable'
  );
  expect(Modal.confirm).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(onPublish).not.toHaveBeenCalled();
});
