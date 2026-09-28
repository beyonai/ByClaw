import { useEffect, useRef, useState } from 'react';
import { Button, message, Modal } from 'antd';
import { useIntl } from '@umijs/max';
import { publishSkillToEnterprise } from '@/pages/manager/service/resources';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { isWorkspaceSkill } from '@/components/Resources/workspaceSkill/utils';
import type { ResourceItem } from './ResourceSiderListItem';

export const useEnterpriseSkillPublication = ({
  enabled,
  onPublished,
  onDetail,
}: {
  enabled: boolean;
  onPublished: (resourceId: string) => void;
  onDetail: (item: ResourceItem) => void;
}) => {
  const intl = useIntl();
  const [brandEnabled, setBrandEnabled] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const pendingIds = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setBrandEnabled(false);
    if (enabled) {
      // 与资源中心一致：商业版隐藏入口，配置查询失败时按开源版处理。
      getDcSystemConfig({ paramCode: 'BYAI_BRAND_VERSION' })
        .then((res: any) => {
          if (active) setBrandEnabled(res?.paramValue !== 'commercial');
        })
        .catch(() => {
          if (active) setBrandEnabled(true);
        });
    }
    return () => {
      active = false;
    };
  }, [enabled]);

  const canPublish = (item: ResourceItem) =>
    enabled &&
    brandEnabled &&
    item.resourceBizType === 'SKILL' &&
    !isWorkspaceSkill(item) &&
    ['personal', 'personal_default'].includes(`${item.ownerType || ''}`.toLowerCase()) &&
    String(item.resourceStatus) !== '-1' &&
    Boolean(item.resourceId) &&
    item.canPublishToEnterprise === true;

  const publish = (item: ResourceItem) => {
    const resourceId = String(item.resourceId);
    if (!canPublish(item) || pendingIds.current.has(resourceId)) return;
    // 从确认阶段开始锁定，避免连续点击弹出多个确认框或重复提交。
    pendingIds.current.add(resourceId);
    const release = () => pendingIds.current.delete(resourceId);
    Modal.confirm({
      title: intl.formatMessage({ id: 'resource.publishToEnterpriseConfirm' }),
      okText: intl.formatMessage({ id: 'common.confirm' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      onCancel: release,
      async onOk() {
        setPublishingId(resourceId);
        const key = `publish-enterprise-${resourceId}`;
        message.loading({ key, content: intl.formatMessage({ id: 'common.processing' }), duration: 0 });
        try {
          const result = await publishSkillToEnterprise(resourceId);
          onPublished(resourceId);
          if (result.personalDependencies?.length) {
            Modal.warning({
              title: intl.formatMessage({ id: 'resource.enterprisePersonalDependenciesTitle' }),
              content: (
                <div>
                  <p>{intl.formatMessage({ id: 'resource.enterprisePersonalDependenciesWarning' })}</p>
                  <ul>
                    {result.personalDependencies.map((dependency) => (
                      <li key={dependency.resourceId}>{dependency.resourceName}</li>
                    ))}
                  </ul>
                </div>
              ),
              okText: intl.formatMessage({ id: 'common.confirm' }),
            });
          }
          message.success({
            key,
            content: (
              <span>
                {intl.formatMessage({
                  id:
                    result.resource.resourceStatus === 4
                      ? 'resource.enterpriseSkillPending'
                      : result.alreadyExists
                        ? 'resource.enterpriseSkillExists'
                        : 'resource.publishToEnterpriseSuccess',
                })}
                {result.resource.resourceStatus !== 4 && (
                  <Button type="link" onClick={() => onDetail(result.resource)}>
                    {intl.formatMessage({ id: 'resource.viewEnterpriseSkill' })}
                  </Button>
                )}
              </span>
            ),
            duration: 6,
          });
        } catch (error) {
          const fallback = intl.formatMessage({ id: 'resource.publishToEnterpriseFailed' });
          message.error({
            key,
            content: typeof error === 'string' ? error : error instanceof Error ? error.message : fallback,
          });
        } finally {
          release();
          setPublishingId(null);
        }
      },
    });
  };

  return { canPublish, publishingId, publish };
};
