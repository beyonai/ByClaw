import { useCallback } from 'react';
import { useSelector } from '@umijs/max';
import { pick } from 'lodash';
import { message as antdMessage } from 'antd';

import EmployeesDrawer from '@/pages/employees/components/EmployeesDrawer';
import SkillDetailDrawer from '@/pages/employees/components/SkillDetailDrawer/SkillDetailDrawer';

import { getRuntimeActualUrl } from '@/utils';
import { getResponseAgentInfo } from '@/components/MessageList/utils';
import useGlobal from '@/hooks/useGlobal';

import { ITask } from '@/typescript/task';
import { ResourceTypeMap } from '@/constants/resource';

function useResourceDetail({ setPortalComp }: { setPortalComp: (container: React.ReactNode) => void }) {
  const { agentList, employeesList } = useSelector(({ employees }) => pick(employees, ['agentList', 'employeesList']));

  const { EventEmitter } = useGlobal();

  const handleResourceDetail = useCallback(
    (substance: Omit<ITask, 'resPage'>) => {
      const { resourceBizType, resourceId } = substance;
      if (resourceBizType === ResourceTypeMap.digitalEmployee) {
        const agentInfo = getResponseAgentInfo(
          { agentList, employeesList },
          JSON.stringify({ agentId: `${resourceId}` })
        );
        setPortalComp?.(
          <EmployeesDrawer
            readOnly
            agentInfo={{
              ...(agentInfo || {}),
              resourceId,
            }}
            defaultOpen
            onClose={() => {
              setPortalComp?.(null);
            }}
          >
            <></>
          </EmployeesDrawer>
        );

        return;
      }

      if (
        resourceBizType &&
        [ResourceTypeMap.MCP, ResourceTypeMap.TOOL, ResourceTypeMap.TOOLKIT, ResourceTypeMap.Agent].includes(
          resourceBizType
        )
      ) {
        setPortalComp?.(
          <SkillDetailDrawer
            resourceId={substance?.resourceId}
            open
            onClose={() => {
              setPortalComp?.(null);
            }}
          />
        );

        return;
      }

      if (!substance?.taskId) {
        antdMessage.error('缺少taskId');
        return;
      }

      EventEmitter.emit('beyond-fullscreen-modal-open-type', {
        canClose: true,
        drawerType: 'iframe',
      });

      // 传递iframe数据
      EventEmitter.emit('beyond-fullscreen-modal-message', {
        url: `${window.location.origin}${getRuntimeActualUrl(`/manager/todoList/taskDetail?hideCloseBack=1&taskId=${substance?.taskId}`)}`,
      });
    },
    [agentList, employeesList]
  );

  return {
    handleResourceDetail,
  };
}

export default useResourceDetail;
