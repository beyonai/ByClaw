import React, { useCallback } from 'react';
import { Modal, message } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import ResourceDetail from '@/components/Resources/components/ResourceDetail';
import {
  checkWorkspaceSkillShareConflicts,
  deleteSkill,
  queryResourceMembers,
  queryWorkspaceSkillDetail,
  resourceizeWorkspaceSkill,
} from '@/pages/manager/service/resources';
import { ResourceTypeMap } from '@/constants/resource';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import { getCurrentUserDisplayName, type WorkspaceSkillItem } from './utils';

interface UseWorkspaceSkillActionsParams {

  /** 当前数字员工 ID，用于定位工作空间路径。 */
  resourceId?: string | number;

  /** 当前数字员工展示名，详情里展示“已被哪些数字员工使用”。 */
  agentName?: string;
  setDetailPanel?: (panel: React.ReactNode, options?: DetailPanelOptions) => void;
  clearDetailPanel?: () => void;

  /** 资源化成功后回调，宿主据此打开使用授权弹窗。 */
  onShareAuth?: (resourceItem: WorkspaceSkillItem) => void;

  /** 列表发生变化（资源化 / 删除）后回调，宿主据此刷新列表。 */
  onChanged?: () => void;
}

const buildImportRangeText = (items: any[] = []) =>
  items
    .map((item) => {
      const catalogSuffix = item.catalogName ? `（${item.catalogName}）` : '';
      return `${item.resourceCode || ''}：${item.resourceName || ''}${catalogSuffix}`;
    })
    .join('、');

const firstImportSuccessItem = (result: any) => {
  const data = result?.data || result;
  return (data?.items || []).find((item: any) => item?.success && item?.resourceId);
};

/** 按 授权对象类型 + 标识 去重成员，避免“我”与管理人列表里的同一人重复展示。 */
const dedupeMembers = (members: any[]) => {
  const seen = new Set<string>();
  return members.filter((member) => {
    if (!member) {
      return false;
    }
    const key = `${member.grantToObjType || 'USER'}:${String(member.grantToObjId ?? member.grantToObjName ?? '')}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * 工作空间（用户开发）技能的详情 / 分享(资源化) / 删除 操作，左右两侧列表共用。
 * 非工作空间技能不在此 hook 处理范围内。
 */
export const useWorkspaceSkillActions = (params: UseWorkspaceSkillActionsParams) => {
  const { resourceId, agentName, setDetailPanel, clearDetailPanel, onShareAuth, onChanged } = params;
  const intl = useIntl();
  const { userInfo } = useSelector(({ user }: any) => ({ userInfo: user?.userInfo }));
  const userCode = userInfo?.userCode;

  const openDetail = useCallback(
    async (item: WorkspaceSkillItem) => {
      if (!item.skillPath) {
        message.error(intl.formatMessage({ id: 'resource.skillDownload.noSkillPath' }));
        return;
      }
      try {
        const detail = await queryWorkspaceSkillDetail({ skillPath: item.skillPath, resourceId, userCode });
        const detailData = (detail as any)?.data || detail;

        // 工作空间技能没有独立授权记录，管理人/使用人按所属数字员工口径展示：
        // 管理人 = 该数字员工的管理人；使用人 = 当前登录用户 + 该数字员工的管理人。
        // 同时从该接口拿数字员工名称（权威、无前端列表晚加载导致显示编码的时序问题）。
        let employeeManagerList: any[] = [];
        let employeeName = '';
        if (resourceId) {
          try {
            const members = await queryResourceMembers({ resourceId });
            const membersData = (members as any)?.data ?? members;
            employeeManagerList = Array.isArray(membersData?.managerList) ? membersData.managerList : [];
            employeeName = membersData?.resourceName || '';
          } catch {
            employeeManagerList = [];
          }
        }
        const currentUserMember = {
          grantToObjType: 'USER',
          grantToObjId: userInfo?.userId || userInfo?.id || userInfo?.userCode,
          grantToObjName: getCurrentUserDisplayName(userInfo),
        };
        // 管理人取数字员工管理人；若员工无显式授权（如个人超级助手），回退为当前用户（即所有者本人）。
        const managerList = employeeManagerList.length ? employeeManagerList : [currentUserMember];

        const currentDigitalEmployeeName =
          employeeName || agentName || intl.formatMessage({ id: 'resource.currentDigitalEmployee' });
        const usedDigitalEmployees = [];
        if (resourceId) {
          usedDigitalEmployees.push({
            resourceId,
            resourceName: currentDigitalEmployeeName,
            useStartTime: detailData?.useStartTime || item.useStartTime,
          });
        }
        const detailItem = {
          ...item,
          resourceName: detailData?.skillName || item.resourceName,
          resourceCode: detailData?.skillName || item.resourceCode,
          resourceDesc: detailData?.skillDesc || item.resourceDesc,
          description: detailData?.skillDesc || item.description,
          useList: dedupeMembers([currentUserMember, ...employeeManagerList]),
          managerList,
          usedDigitalEmployees,
        };
        setDetailPanel?.(
          <ResourceDetail
            visible
            panel
            item={detailItem}
            resourceName={intl.formatMessage({ id: 'common.skill' })}
            onCancel={() => clearDetailPanel?.()}
            onEdit={() => {}}
          />,
          { width: 350 }
        );
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
      }
    },
    [agentName, clearDetailPanel, intl, resourceId, setDetailPanel, userCode, userInfo]
  );

  const confirmOverwrite = useCallback(
    (updatedItems: any[] = []) =>
      new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: intl.formatMessage({ id: 'resource.import.skillOverwriteConfirmTitle' }),
          content: (
            <div>
              <div>{intl.formatMessage({ id: 'resource.import.skillOverwriteConfirmDesc' })}</div>
              <div>{buildImportRangeText(updatedItems)}</div>
            </div>
          ),
          okText: intl.formatMessage({ id: 'common.confirm' }),
          cancelText: intl.formatMessage({ id: 'common.cancel' }),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [intl]
  );

  const shareSkill = useCallback(
    async (item: WorkspaceSkillItem) => {
      if (!item.skillPath) {
        message.error(intl.formatMessage({ id: 'resource.skillDownload.noSkillPath' }));
        return;
      }
      try {
        const baseParams = { skillPath: item.skillPath, resourceId, userCode };
        const conflictResult = await checkWorkspaceSkillShareConflicts(baseParams);
        const conflictData = (conflictResult as any)?.data || conflictResult;
        const updatedItems = conflictData?.updatedItems || [];
        let overwriteConfirmed = false;
        if (updatedItems.length) {
          overwriteConfirmed = await confirmOverwrite(updatedItems);
          if (!overwriteConfirmed) {
            return;
          }
        }
        const importResult = await resourceizeWorkspaceSkill({ ...baseParams, overwriteConfirmed });
        const successItem = firstImportSuccessItem(importResult);
        if (!successItem?.resourceId) {
          message.error(intl.formatMessage({ id: 'common.operationFailed' }));
          return;
        }
        const resourceItem: WorkspaceSkillItem = {
          ...item,
          resourceId: successItem.resourceId,
          resourceCode: successItem.resourceCode || item.resourceCode,
          resourceName: successItem.resourceName || item.resourceName,
          resourceDesc: successItem.resourceDesc || item.resourceDesc,
          resourceBizType: ResourceTypeMap.SKILL,
          displaySourceType: undefined,
          resourceBacked: true,
        };
        onChanged?.();
        onShareAuth?.(resourceItem);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
      }
    },
    [confirmOverwrite, intl, onChanged, onShareAuth, resourceId, userCode]
  );

  const removeSkill = useCallback(
    (item: WorkspaceSkillItem) => {
      if (!item.skillPath) {
        message.error(intl.formatMessage({ id: 'resource.skillDownload.noSkillPath' }));
        return;
      }
      Modal.confirm({
        title: intl.formatMessage({ id: 'common.deleteResource' }),
        content: intl.formatMessage({ id: 'resource.deleteWorkspaceSkillConfirm' }, { skillName: item.resourceName }),
        okText: intl.formatMessage({ id: 'common.confirm' }),
        cancelText: intl.formatMessage({ id: 'common.cancel' }),
        async onOk() {
          try {
            await deleteSkill({ skillPath: item.skillPath as string, resourceId, userCode });
            message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
            onChanged?.();
          } catch (error: any) {
            message.error(error?.message || error || intl.formatMessage({ id: 'common.operationFailed' }));
          }
        },
      });
    },
    [intl, onChanged, resourceId, userCode]
  );

  return { openDetail, shareSkill, removeSkill };
};
