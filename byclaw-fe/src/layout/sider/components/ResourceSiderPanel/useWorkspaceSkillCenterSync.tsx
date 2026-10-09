import { useEffect, useRef, useState } from 'react';
import { Modal, message } from 'antd';
import { useIntl } from '@umijs/max';
import {
  queryWorkspaceSkillCenterStatus,
  syncWorkspaceSkillToCenter,
  type WorkspaceSkillCenterStatus,
} from '@/pages/manager/service/resources';
import { isWorkspaceSkill, type WorkspaceSkillItem } from '@/components/Resources/workspaceSkill/utils';

type State = { loading?: boolean; error?: boolean; status?: WorkspaceSkillCenterStatus };

const responseData = (response: any) => {
  if (response?.success === false || (response?.code !== undefined && ![0, 200].includes(Number(response.code)))) {
    throw new Error(response.msg || response.message);
  }
  return response?.data ?? response;
};

/** 仅在展开技能菜单时查询中心状态，避免列表加载时逐条下载中心技能包。 */
export const useWorkspaceSkillCenterSync = ({
  employeeId,
  enabled,
  rows,
  onChanged,
}: {
  employeeId?: string;
  enabled: boolean;
  rows: WorkspaceSkillItem[];
  onChanged: (item: WorkspaceSkillItem, sourceDeleted: boolean) => void;
}) => {
  const intl = useIntl();
  const [states, setStates] = useState<Record<string, State>>({});
  const [busyPath, setBusyPath] = useState<string>();
  const generation = useRef(0);
  const inFlight = useRef(new Set<string>());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    generation.current += 1;
    setStates({});
    setBusyPath(undefined);
    inFlight.current.clear();
    return () => {
      generation.current += 1;
    };
  }, [employeeId, enabled]);

  useEffect(() => {
    // 翻页或刷新只清空菜单缓存，不取消当前员工已经提交的操作及其完成回调。
    setStates({});
  }, [rows]);

  const skillKey = (item: WorkspaceSkillItem) =>
    isWorkspaceSkill(item) ? item.skillPath! : `resource:${item.resourceId}`;
  // 已绑定资源由服务端验证关联并定位目录，前端不拼接工作空间路径。
  const targetParams = (item: WorkspaceSkillItem) =>
    isWorkspaceSkill(item) ? { skillPath: item.skillPath! } : { targetResourceId: item.resourceId! };
  const eligible = (item: WorkspaceSkillItem) =>
    // 更新不按来源标签过滤；目录技能传路径，已绑定技能传真实资源 ID，由后端定位并比较完整技能包。
    enabled &&
    employeeId &&
    item.resourceBizType === 'SKILL' &&
    (isWorkspaceSkill(item) ? !!item.skillPath : !!item.resourceId && String(item.resourceId) !== '-1');

  const load = async (item: WorkspaceSkillItem) => {
    if (!eligible(item)) return;
    const path = skillKey(item);
    const requestGeneration = generation.current;
    const requestKey = `${requestGeneration}:${path}`;
    if (inFlight.current.has(requestKey)) return;
    inFlight.current.add(requestKey);
    setStates((current) => ({ ...current, [path]: { loading: true } }));
    try {
      const status = responseData(
        await queryWorkspaceSkillCenterStatus({ resourceId: employeeId!, ...targetParams(item) })
      );
      if (!status?.revision || !['INSTALL', 'UPDATE', 'NONE'].includes(status.action)) throw new Error();
      if (requestGeneration === generation.current) {
        setStates((current) => ({ ...current, [path]: { status } }));
      }
    } catch {
      if (requestGeneration === generation.current) {
        setStates((current) => ({ ...current, [path]: { error: true } }));
      }
    } finally {
      inFlight.current.delete(requestKey);
    }
  };

  const sync = (item: WorkspaceSkillItem, status: WorkspaceSkillCenterStatus) => {
    if (!eligible(item)) return;
    const path = skillKey(item);
    const sourceEmployeeId = employeeId!;
    const key = `${sourceEmployeeId}:${path}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    const requestGeneration = generation.current;
    const action = intl.formatMessage({
      id: `resource.workspaceCenter.${status.action === 'INSTALL' ? 'install' : 'update'}`,
    });
    Modal.confirm({
      title: action,
      content: intl.formatMessage(
        {
          id: isWorkspaceSkill(item)
            ? 'resource.workspaceCenter.confirm'
            : 'resource.workspaceCenter.updateInstalledConfirm',
        },
        {
          action,
          name: item.resourceName,
          scope: intl.formatMessage({ id: `resource.workspaceCenter.${status.ownerType}` }),
        }
      ),
      okText: intl.formatMessage({ id: 'common.confirm' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      onCancel: () => pending.current.delete(key),
      async onOk() {
        if (requestGeneration !== generation.current) {
          pending.current.delete(key);
          return;
        }
        setBusyPath(path);
        try {
          const result = responseData(
            await syncWorkspaceSkillToCenter({
              resourceId: sourceEmployeeId,
              ...targetParams(item),
              revision: status.revision,
            })
          );
          if (!result?.resourceId || typeof result.sourceDeleted !== 'boolean') throw new Error();
          if (!isWorkspaceSkill(item)) {
            message.success(intl.formatMessage({ id: 'resource.workspaceCenter.updatedInstalled' }));
            if (requestGeneration === generation.current) {
              setStates((current) => ({ ...current, [path]: { status: { ...status, action: 'NONE' } } }));
            }
          } else if (result.sourceDeleted)
            message.success(intl.formatMessage({ id: 'resource.workspaceCenter.success' }));
          else message.warning(intl.formatMessage({ id: 'resource.workspaceCenter.cleanupFailed' }));
          // 中心保存已成功，即使目录清理失败也刷新状态，避免再次覆盖已同步的内容。
          if (requestGeneration === generation.current) onChanged(item, result.sourceDeleted);
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'resource.workspaceCenter.failed' }));
          if (requestGeneration === generation.current) {
            setStates((current) => ({ ...current, [path]: { error: true } }));
          }
        } finally {
          pending.current.delete(key);
          if (requestGeneration === generation.current) setBusyPath(undefined);
        }
      },
    });
  };

  const menuItem = (item: WorkspaceSkillItem) => {
    if (!eligible(item)) return undefined;
    const state = states[skillKey(item)];
    if (!state || state.loading) {
      return {
        key: 'workspaceCenter',
        label: intl.formatMessage({ id: 'resource.workspaceCenter.checking' }),
        disabled: true,
      };
    }
    if (state.error) {
      return { key: 'workspaceCenter', label: intl.formatMessage({ id: 'resource.workspaceCenter.retry' }) };
    }
    if (state.status?.action === 'NONE') return undefined;
    return {
      key: 'workspaceCenter',
      label: intl.formatMessage({
        id: `resource.workspaceCenter.${state.status?.action === 'INSTALL' ? 'install' : 'update'}`,
      }),
      disabled: busyPath === skillKey(item),
    };
  };

  return {
    menuItem,
    onOpen: (item: WorkspaceSkillItem) => {
      if (!busyPath) void load(item);
    },
    onClick: (item: WorkspaceSkillItem) => {
      const state = states[skillKey(item)];
      if (state?.error) void load(item);
      else if (state?.status && state.status.action !== 'NONE') sync(item, state.status);
    },
  };
};
