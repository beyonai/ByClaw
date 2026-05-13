import React, { useEffect } from 'react';
import { Spin } from 'antd';
import { useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { isOpenClawAgent } from '@/utils/openClaw/utils';
import { IAgentCache } from '@/typescript/agent';
import Sandbox from '@/pages/sandbox';
import styles from '../../employees/index.module.less';
import classNames from 'classnames';
import Auth from '@/layout/auth';

/**
 * 移动端 OpenClaw 页面
 * 监听 employeesList，自动选中 openClaw 类型数字员工并渲染 Sandbox
 */
function MobileOpenClaw() {
  const globalContext = useGlobal();
  const { agentId, setAgentId } = globalContext;

  const employeesList = useSelector(({ employees }) => employees.employeesList || []);

  useEffect(() => {
    if (!setAgentId) return;
    const openClawAgent = employeesList.find((item: IAgentCache) => isOpenClawAgent(item));
    if (openClawAgent) {
      setAgentId(String(openClawAgent.agentId));
    }
  }, [employeesList, setAgentId]);

  if (!agentId) {
    return <Spin spinning className={classNames(styles.spinningWrapper, 'ub ub-ac ub-pc')} />;
  }

  return <Sandbox />;
}

export default function MobileOpenClawPage() {
  return (
    <Auth>
      <MobileOpenClaw />
    </Auth>
  );
}
