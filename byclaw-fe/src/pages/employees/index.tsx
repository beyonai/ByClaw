import React, { useEffect, useMemo, useState } from 'react';

import { LeftOutlined } from '@ant-design/icons';
// @ts-ignore
import { useSelector, history, useNavigate, useSearchParams, useIntl, useDispatch } from '@umijs/max';
import { Space, Typography, Spin, message } from 'antd';
import classnames from 'classnames';
import { isEmpty, set, get } from 'lodash';

import EmployeesDrawer from '@/pages/employees/components/EmployeesDrawer';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import { agentTypeMap } from '@/constants/agent';
import useGlobal from '@/hooks/useGlobal';
import { queryResourceDetail } from '@/pages/manager/service/DigitalResourceMgr';
import { IAgentCache } from '@/typescript/agent';
import { getAgentChatAvatar, agentHandler, isSandboxAgent } from '@/utils/agent';
import { AgentInfo } from '@/pages/digitalEmployees/components/AllDigitalEmployees/components/AvatarCardItem';
// import useAppStore from '@/models/common/useAppStore';
import { getAllDigitalEmployeesV2 } from '@/service/digitalEmployees';

import RenderRightTop from '../digitalEmployees/components/AllDigitalEmployees/RenderRightTop';
import RenderRightBottom from '../digitalEmployees/components/AllDigitalEmployees/RenderRightBottom';
import AgentIframe from './components/AgentIframe';
// import ScheduleTaskModal from './components/ScheduleTaskModal';
// import ScheduleTaskList from './components/ScheduleTaskList';

import styles from './index.module.less';

const { Paragraph } = Typography;

const Employees = () => {
  // const { ENV } = useAppStore();
  // const isScheduleTaskEnabled = !ENV?.includes?.('scheduleTask');

  const intl = useIntl();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const globalContext = useGlobal();
  const { sessionId, agentId, EventEmitter, setAgentId, agentInfo } = globalContext;

  const [searchParams, setSearchParams] = useSearchParams();

  const { employeesList } = useSelector(({ employees }) => ({
    employeesList: employees.employeesList,
  }));

  const [isBottom, setIsBottom] = useState(!!sessionId);
  const [isLoading, setIsLoading] = useState(true);

  const [appInfo, setAppInfo] = useState<Record<string, any>>({});
  const [coreCompetencies, setCoreCompetencies] = useState<any[]>([]);

  // const [scheduleTaskVisible, setScheduleTaskVisible] = useState(false);
  // const [editTask, setEditTask] = useState<any>(null);
  // const [taskListRefreshKey, setTaskListRefreshKey] = useState(0);

  const myAgentId = agentId || searchParams.get('agentId');

  // const handleScheduleTaskOk = (values: any) => {
  //   // 创建/更新成功后刷新任务列表
  //   console.log('定时任务操作成功:', values);
  //   setTaskListRefreshKey((prev) => prev + 1);
  //   setEditTask(null); // 清空编辑任务
  // };

  // const handleRefreshTaskList = () => {
  //   // 刷新任务列表的回调
  //   setTaskListRefreshKey((prev) => prev + 1);
  // };

  // const handleEditTask = (task: any) => {
  //   setEditTask(task);
  //   setScheduleTaskVisible(true);
  // };

  // const handleAddTask = () => {
  //   setEditTask(null); // 清空编辑任务
  //   setScheduleTaskVisible(true);
  // };

  const { descText, sampleQuestionList, prologueText } = useMemo(() => {
    const payload = {
      descText: appInfo?.resourceDesc,
      sampleQuestionList: [],
      prologueText: '',
    };

    if (isEmpty(appInfo) || !appInfo?.param?.prologue) return payload;

    try {
      const { openingQuestion, descText } = JSON.parse(appInfo.param.prologue);

      const openingQuestionObj = JSON.parse(openingQuestion);

      set(payload, 'sampleQuestionList', openingQuestionObj);
      set(payload, 'prologueText', descText);
    } catch (e) {
      console.error(e);
    }

    return payload;
  }, [appInfo]);

  const canChat = useMemo(() => {
    if (isBottom) return true;
    const { grantType } = agentInfo || {};
    console.log('grantType', grantType);
    return !!grantType;
  }, [agentInfo, isBottom]);

  const disableActionList = React.useMemo(() => {
    const list: ('delete' | 'apply' | 'unapply')[] = [];

    return list;
  }, []);

  const myQueryResourceDetail = React.useCallback((payload: { resourceCode?: string; resourceId?: string }) => {
    // 普通数字员工
    return queryResourceDetail(payload)
      .then((res: any) => {
        if (!res) return;

        setAppInfo(res);

        // 解析 coreCompetencies
        try {
          const coreCompetenciesStr = res?.param?.coreCompetencies;
          if (coreCompetenciesStr) {
            const parsed = JSON.parse(coreCompetenciesStr);
            setCoreCompetencies(Array.isArray(parsed) ? parsed : []);
          } else {
            setCoreCompetencies([]);
          }
          if (res?.param?.agentHomeUrl) {
            if (isSandboxAgent(res?.param)) {
              dispatch({
                type: 'employees/updateEmployee',
                payload: {
                  employee: {
                    agentId: res?.param?.resourceId,
                    agentHomeUrl: res?.param?.agentHomeUrl,
                  },
                },
              });
            }
          }
        } catch (error) {
          console.error('解析 coreCompetencies 失败:', error);
          setCoreCompetencies([]);
        }
      })
      .catch((e) => {
        console.error(e);
      });
  }, []);

  useEffect(() => {
    setIsBottom(!!sessionId);
  }, [sessionId]);

  useEffect(() => {
    // 当redirectUrl中带有agentId，pclayout中的searchParams获取不到agentId
    const newSearchParams = new URLSearchParams(window.location.search);
    const searchParamAgentId = newSearchParams.get('agentId');

    if (searchParamAgentId) {
      setAgentId?.(searchParamAgentId);

      newSearchParams.delete('agentId');
      setSearchParams(newSearchParams);
    }
  }, [setAgentId]);

  useEffect(() => {
    if (!myAgentId) {
      setIsLoading(false);
      if (!sessionId) {
        navigate('/chat', {
          replace: true,
        });
      }

      return;
    }

    if (agentInfo || isEmpty(employeesList)) {
      return;
    }

    setIsLoading(true);

    getAllDigitalEmployeesV2({
      resourceId: myAgentId,
    })
      .then((res: any) => {
        const target = get(res, 'list.0');
        if (target) {
          dispatch({
            type: 'employees/updateEmployee',
            payload: {
              employee: agentHandler(target),
            },
          });
        } else {
          message.error('The digital employee does not exist!');
          setAgentId?.('');
          navigate('/chat', {
            replace: true,
          });
        }
      })
      .catch(() => {
        message.error(intl.formatMessage({ id: 'common.networkError' }));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [myAgentId, agentInfo, employeesList]);

  useEffect(() => {
    if (isEmpty(agentInfo)) return;

    if (agentInfo?.resourceCode) {
      setAppInfo({});

      const payload = {
        resourceCode: agentInfo.resourceCode,
      };

      setIsLoading(true);
      myQueryResourceDetail(payload).finally(() => {
        setIsLoading(false);
      });
    }
  }, [agentInfo]);

  if (isLoading && !sessionId) {
    return <Spin spinning className={classnames(styles.spinningWrapper, 'ub ub-ac ub-pc')} />;
  }

  if (agentInfo?.agentHomeUrl) {
    return <AgentIframe agent={agentInfo as IAgentCache} />;
  }

  return (
    <>
      <div className="full-width full-height ub" id="employees_wrapper">
        <div
          className={classnames(styles.homePage, 'ub ub-ver overflow-hidden ub-f1 minW550')}
          data-isbottom={isBottom}
        >
          {!sessionId && (
            <div className="ub ub-ac" style={{ padding: '12px 16px', justifyContent: 'space-between' }}>
              <LeftOutlined
                className="pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  history.back();
                }}
              />
              {/* {isScheduleTaskEnabled && canChat && (
                <ScheduleTaskList
                  agentInfo={agentInfo as IAgentCache}
                  onAddTask={handleAddTask}
                  onEditTask={handleEditTask}
                  onRefresh={handleRefreshTaskList}
                  refreshKey={taskListRefreshKey}
                />
              )} */}
            </div>
          )}
          {!isBottom && (
            <div className="ub-f2 overflow-auto">
              <div className={classnames(styles.agentCard, 'mW800')}>
                <div className={classnames(styles.agentCardHeader, 'ub')}>
                  <EmployeesDrawer coreCompetencies={coreCompetencies} agentInfo={agentInfo}>
                    <div className={classnames(styles.agentAvatar)}>{getAgentChatAvatar(agentInfo?.chatAvatar)}</div>
                  </EmployeesDrawer>
                  <div className="ub ub-ver ub-pj ub-f1">
                    <div className={styles.agentName}>{agentInfo?.name}</div>
                    <Paragraph
                      className={styles.agentDescription}
                      ellipsis={{
                        rows: 2,
                        expandable: true,
                        symbol: intl.formatMessage({ id: 'common.expand' }),
                      }}
                    >
                      {descText}
                    </Paragraph>
                    <div className={styles.agentDescriptionMore}>
                      <AgentInfo employee={agentInfo as IAgentCache} className={styles.agentInfo} />
                    </div>
                    <div className={styles.agentAction}>
                      <Space>
                        <RenderRightTop employee={agentInfo as IAgentCache} size={undefined} />
                        <RenderRightBottom employee={agentInfo as IAgentCache} disableActionList={disableActionList} />
                      </Space>
                    </div>
                  </div>
                </div>
                {prologueText && <div className={styles.prologueText}>{prologueText}</div>}
                {!isEmpty(sampleQuestionList) && (
                  <div className={styles.commonQuestionList}>
                    {sampleQuestionList.map((item: any, idx: number) => {
                      return (
                        <div
                          key={idx}
                          className={classnames(styles.commonQuestion, 'ub ub-ac pointer')}
                          onClick={() => {
                            EventEmitter.emit('queryInput-set-value', item);
                          }}
                        >
                          {item}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {canChat && (
            <div className={classnames({ 'ub-f1': isBottom })}>
              <ChatLayoutComp
                sessionId={sessionId || ''}
                getContainer={() => document.getElementById('employees_wrapper')}
                agentType={agentTypeMap.agent}
                queryInputProps={{
                  placeholder: '',
                }}
                isBottom={isBottom}
                setIsBottom={setIsBottom}
              />
            </div>
          )}
        </div>
      </div>

      {/* 添加/编辑定时任务弹窗 */}
      {/* <ScheduleTaskModal
        open={scheduleTaskVisible}
        onClose={() => {
          setScheduleTaskVisible(false);
          setEditTask(null); // 关闭时清空编辑任务
        }}
        agentInfo={agentInfo as IAgentCache}
        onOk={handleScheduleTaskOk}
        editTask={editTask}
      /> */}
    </>
  );
};

export default Employees;
