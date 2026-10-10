import { Button, Modal } from 'antd';
import { getIntl } from '@umijs/max';
import { getSkillPublicationPermissions } from '@/pages/manager/service/resources';
import type { EnterpriseSkillPublishResult, SkillPublicationSummary } from '@/pages/manager/service/resources';

export const skillPublicationEntryLabel = (publication?: SkillPublicationSummary, failed = false) => {
  if (publication?.resourceStatus === 4) return 'resource.skillPublicationProgress';
  if (publication?.resourceStatus === 5) return 'resource.skillPublicationReviewResult';
  if (publication) return 'resource.skillPublicationResult';
  return failed ? 'resource.retrySkillPublication' : 'resource.publishToEnterprise';
};

/** 卡片和侧栏共用只读结果入口；每次打开重新查询，避免把过期状态当作发布成功。 */
export const showSkillPublication = async ({
  sourceId,
  onChange,
  onPublish,
  onDetail,
}: {
  sourceId: string;
  onChange: (publication?: SkillPublicationSummary) => void;
  onPublish: () => Promise<void> | void;
  onDetail?: (resource: EnterpriseSkillPublishResult['resource']) => void;
}) => {
  const intl = getIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const permissions = await getSkillPublicationPermissions(sourceId);
  if (!permissions.canPublishToEnterprise) throw new Error(t('resource.skillPublicationUnavailable'));
  const publication = permissions.skillPublication;
  onChange(publication);
  const status = publication?.resourceStatus;
  const canResubmit = !publication || status === 5 || status === -1;
  const description =
    status === 4
      ? 'resource.skillPublicationPendingDescription'
      : status === 5
        ? 'resource.skillPublicationRejectedDescription'
        : status === 2
          ? 'resource.skillPublicationPublishedDescription'
          : status === 3
            ? 'resource.skillPublicationOffShelfDescription'
            : canResubmit
              ? 'resource.skillPublicationRemovedDescription'
              : 'resource.skillPublicationUnknownDescription';
  Modal.confirm({
    title: t(skillPublicationEntryLabel(publication)),
    content: (
      <div>
        {publication && <p>{publication.resourceName}</p>}
        <p>{t(description)}</p>
        {status === 2 && publication && onDetail && (
          <Button
            type="link"
            onClick={() => onDetail({ ...publication, ownerType: 'enterprise', resourceBizType: 'SKILL' })}
          >
            {t('resource.viewEnterpriseSkill')}
          </Button>
        )}
      </div>
    ),
    okText: t(canResubmit ? 'resource.skillPublicationResubmit' : 'common.confirm'),
    cancelText: t('common.cancel'),
    cancelButtonProps: { style: canResubmit ? undefined : { display: 'none' } },
    // 重新提交仍走原有确认与写接口，审核状态不会在查看时改变。
    onOk: canResubmit ? onPublish : undefined,
  });
};
