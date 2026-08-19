import React, { useEffect, useMemo, useRef, useState } from 'react';

import { LeftOutlined } from '@ant-design/icons';
// @ts-ignore
import { history, useLocation, useNavigate, useSearchParams, useIntl, useDispatch } from '@umijs/max';
import { Space, Typography, Spin, message } from 'antd';
import classnames from 'classnames';
import { isEmpty, set, get } from 'lodash';

import EmployeesDrawer from '@/pages/employees/components/EmployeesDrawer';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import { agentTypeMap } from '@/constants/agent';
import useGlobal from '@/hooks/useGlobal';
import { queryResourceDetail } from '@/pages/manager/service/DigitalResourceMgr';
import { queryResourceOperationPermissions } from '@/pages/manager/service/resources';
import { IAgentCache } from '@/typescript/agent';
import { getAgentChatAvatar, agentHandler, isSandboxAgent } from '@/utils/agent';
import { AgentInfo } from '@/pages/digitalEmployees/components/AllDigitalEmployees/components/AvatarCardItem';
// import useAppStore from '@/models/common/useAppStore';
import { getAllDigitalEmployeesV2 } from '@/service/digitalEmployees';
import { getStoredProjectScopeId } from '@/pages/projectSpace/constants';

import RenderRightTop from '../digitalEmployees/components/AllDigitalEmployees/RenderRightTop';
import RenderRightBottom from '../digitalEmployees/components/AllDigitalEmployees/RenderRightBottom';
import AgentIframe from './components/AgentIframe';
import { canShowEmployeeChat, type EmployeeUsePermission } from './chatPermission';
// import ScheduleTaskModal from './components/ScheduleTaskModal';
// import ScheduleTaskList from './components/ScheduleTaskList';

import styles from './index.module.less';

const { Paragraph } = Typography;
const DEFAULT_PROJECT_ID = -1;

type ProjectChatContext = {
  projectId?: number;
  projectName?: string;
};

const isValidProjectContextId = (projectId: number) =>
  Number.isFinite(projectId) && (projectId === DEFAULT_PROJECT_ID || projectId > 0);

const getStoredProjectChatContext = (): ProjectChatContext => {
  const projectId = Number(getStoredProjectScopeId());
  return isValidProjectContextId(projectId) ? { projectId } : {};
};

const Employees = () => {
  // const { ENV } = useAppStore();
  // const isScheduleTaskEnabled = !ENV?.includes?.('scheduleTask');

  const intl = useIntl();
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const globalContext = useGlobal();
  const { sessionId, agentId, EventEmitter, setAgentId, setSessionId, agentInfo } = globalContext;

  const [searchParams] = useSearchParams();
  const routeAgentIdRef = useRef('');
  const syncedRouteAgentIdRef = useRef('');

  const [isBottom, setIsBottom] = useState(!!sessionId);
  const [isLoading, setIsLoading] = useState(true);
  // 员工页首次打开时从已恢复的项目选择读取归属，避免首条消息回退到默认项目。
  const [projectChatContext, setProjectChatContext] = useState<ProjectChatContext>(getStoredProjectChatContext);

  const [appInfo, setAppInfo] = useState<Record<string, any>>({});
  const [coreCompetencies, setCoreCompetencies] = useState<any[]>([]);
  const [employeeUsePermission, setEmployeeUsePermission] = useState<EmployeeUsePermission | null>(null);

  // const [scheduleTaskVisible, setScheduleTaskVisible] = useState(false);
  // const [editTask, setEditTask] = useState<any>(null);
  // const [taskListRefreshKey, setTaskListRefreshKey] = useState(0);

  const searchParamAgentId = searchParams.get('agentId') || '';
  const routeState = location.state as {
    selectedAgentId?: string;
    selectedEmployee?: IAgentCache;
    keepSiderActiveKey?: string;
  } | null;
  const routeStateAgentId = `${routeState?.selectedAgentId || ''}`;
  const routeStateEmployee = routeState?.selectedEmployee;
  const previousRouteSelectionRef = useRef('');
  const staleEmployeeSessionIdRef = useRef('');
  if (routeStateAgentId && previousRouteSelectionRef.current !== routeStateAgentId) {
    previousRouteSelectionRef.current = routeStateAgentId;
    // 从右侧列表打开新员工时，当前 sessionId 可能由浏览器历史恢复自上一员工，先标记为待隔离旧会话。
    staleEmployeeSessionIdRef.current = sessionId || '';
  }
  const employeeSessionId =
    staleEmployeeSessionIdRef.current && sessionId === staleEmployeeSessionIdRef.current ? '' : sessionId;
  if (searchParamAgentId) routeAgentIdRef.current = searchParamAgentId;
  // 卡片点击路由状态优先于浏览器历史中的全局 agentId，避免返回列表后旧员工覆盖本次新选择。
  const myAgentId = searchParamAgentId || routeStateAgentId || agentId || routeAgentIdRef.current;
  const detailAgentInfo = useMemo(() => {
    const selectedEmployee = routeStateEmployee || agentInfo;
    if (!selectedEmployee) {
      return selectedEmployee;
    }

    // 左侧小列表只返回员工摘要；将资源详情的创建者补回，保证两个入口展示一致。
    return {
      ...selectedEmployee,
      creatorName: selectedEmployee.creatorName || appInfo?.creatorName || appInfo?.createUserName,
      createUserName: selectedEmployee.createUserName || appInfo?.createUserName || appInfo?.creatorName,
    };
  }, [agentInfo, appInfo?.createUserName, appInfo?.creatorName, routeStateEmployee]);
  const employeeTab = searchParams.get('tab');
  const employeeResourceId = `${detailAgentInfo?.resourceId || detailAgentInfo?.id || ''}`;

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
    return canShowEmployeeChat(employeeTab, employeeResourceId, employeeUsePermission);
  }, [employeeResourceId, employeeTab, employeeUsePermission]);

  const disableActionList = React.useMemo(() => {
    const list: ('delete' | 'apply' | 'unapply')[] = [];

    return list;
  }, []);

  const myQueryResourceDetail = React.useCallback(
    (payload: { resourceCode?: string; resourceId?: string }) => {
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
    },
    [dispatch]
  );

  useEffect(() => {
    // 同一路由连续切换数字员工时重置为详情展示态，不能复用上一员工已经进入的会话态。
    setIsBottom(!!employeeSessionId);
  }, [employeeSessionId, myAgentId]);

  useEffect(() => {
    if (!routeStateAgentId || !sessionId || sessionId !== staleEmployeeSessionIdRef.current) return;
    // 清除上一员工的旧会话；后续当前员工发送首条消息生成的新 sessionId 不会被拦截。
    setSessionId?.('');
  }, [routeStateAgentId, sessionId, setSessionId]);

  useEffect(() => {
    const handleActiveProjectChange = (payload: { projectId?: string | number; projectName?: string }) => {
      const projectId = Number(payload?.projectId);
      if (!isValidProjectContextId(projectId)) {
        setProjectChatContext({});
        return;
      }
      setProjectChatContext({
        projectId,
        projectName: payload?.projectName,
      });
    };

    // 项目下拉切换后同步员工页，保证尚未创建的会话使用新的项目归属。
    EventEmitter.on('projectSpace-active-project-change', handleActiveProjectChange);
    return () => {
      EventEmitter.off('projectSpace-active-project-change', handleActiveProjectChange);
    };
  }, [EventEmitter]);

  const projectChatExtraParams = useMemo(() => {
    // 已存在会话不应因左侧项目切换而改变归属，仅新会话首条消息携带项目。
    if (employeeSessionId || !projectChatContext.projectId) {
      return {};
    }
    return projectChatContext;
  }, [employeeSessionId, projectChatContext]);

  useEffect(() => {
    if (employeeTab !== 'enterprise' || !employeeResourceId) {
      setEmployeeUsePermission(null);
      return undefined;
    }

    let cancelled = false;
    setEmployeeUsePermission(null);

    queryResourceOperationPermissions({ resourceId: employeeResourceId })
      .then((res: any) => {
        if (cancelled) {
          return;
        }

        const permissions = res?.data || res || {};
        setEmployeeUsePermission({
          resourceId: employeeResourceId,
          hasUsePermission: permissions?.hasUsePermission === true,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setEmployeeUsePermission(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [employeeResourceId, employeeTab]);

  useEffect(() => {
    if (!searchParamAgentId || syncedRouteAgentIdRef.current === searchParamAgentId) return;
    // 仅兼容外部直达链接并同步一次，不能持续用 URL 覆盖详情页内部的员工状态。
    syncedRouteAgentIdRef.current = searchParamAgentId;
    if (searchParamAgentId !== agentId) {
      setAgentId?.(searchParamAgentId);
    }
  }, [agentId, searchParamAgentId, setAgentId]);

  useEffect(() => {
    if (!routeStateAgentId || routeStateAgentId === agentId) return;
    // 浏览器返回可能恢复上一条 history.state，这里以当前卡片显式传入的员工为准重新同步全局状态。
    setAgentId?.(routeStateAgentId);
  }, [agentId, routeStateAgentId, setAgentId]);

  useEffect(() => {
    if (!myAgentId) {
      setIsLoading(false);
      if (!employeeSessionId) {
        navigate('/digitalEmployees', {
          replace: true,
          state: { keepSiderActiveKey: 'agent' },
        });
      }

      return;
    }

    if (detailAgentInfo) return;

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
          navigate('/digitalEmployees', {
            replace: true,
            state: { keepSiderActiveKey: 'agent' },
          });
        }
      })
      .catch(() => {
        message.error(intl.formatMessage({ id: 'common.networkError' }));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [detailAgentInfo, dispatch, employeeSessionId, intl, myAgentId, navigate, setAgentId]);

  const agentResourceCode = detailAgentInfo?.resourceCode;
  const agentResourceId = detailAgentInfo?.resourceId || detailAgentInfo?.id;

  useEffect(() => {
    if (!agentResourceCode && !agentResourceId) return;

    setAppInfo({});

    setIsLoading(true);
    myQueryResourceDetail(
      agentResourceCode ? { resourceCode: agentResourceCode } : { resourceId: `${agentResourceId}` }
    ).finally(() => {
      setIsLoading(false);
    });
    // 只在员工业务标识变化时刷新详情；列表轮询产生的新对象不能让详情页反复进入 loading。
  }, [agentResourceCode, agentResourceId, myQueryResourceDetail]);

  if (isLoading && !employeeSessionId) {
    return <Spin spinning className={classnames(styles.spinningWrapper, 'ub ub-ac ub-pc')} />;
  }

  if (detailAgentInfo?.agentHomeUrl) {
    return <AgentIframe agent={detailAgentInfo as IAgentCache} />;
  }

  return (
    <>
      <div className="full-width full-height ub" id="employees_wrapper">
        <div
          className={classnames(styles.homePage, 'ub ub-ver overflow-hidden ub-f1 minW550')}
          data-isbottom={isBottom}
        >
          {!employeeSessionId && (
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
                  <EmployeesDrawer coreCompetencies={coreCompetencies} agentInfo={detailAgentInfo}>
                    <div className={classnames(styles.agentAvatar)}>
                      {getAgentChatAvatar(detailAgentInfo?.chatAvatar)}
                    </div>
                  </EmployeesDrawer>
                  <div className="ub ub-ver ub-pj ub-f1">
                    <div className={styles.agentName}>{detailAgentInfo?.name}</div>
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
                      <AgentInfo employee={detailAgentInfo as IAgentCache} className={styles.agentInfo} />
                    </div>
                    <div className={styles.agentAction}>
                      <Space>
                        <RenderRightTop employee={detailAgentInfo as IAgentCache} size={undefined} />
                        <RenderRightBottom
                          employee={detailAgentInfo as IAgentCache}
                          disableActionList={disableActionList}
                        />
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
                // 员工变化时重建聊天实例，清理上一员工遗留的消息与输入布局状态。
                key={`employee-chat-${myAgentId || 'empty'}`}
                sessionId={employeeSessionId || ''}
                getContainer={() => document.getElementById('employees_wrapper')}
                agentType={detailAgentInfo?.agentType || agentTypeMap.agent}
                queryInputProps={{
                  placeholder: '',
                }}
                queryInputWrapperClassName={styles.employeeQueryInputWrapper}
                // 员工详情固定与当前数字员工聊天，不显示 @ 入口，也不恢复任何历史输入草稿。
                cannotAt
                disableInputDraft
                isBottom={isBottom}
                setIsBottom={setIsBottom}
                // 打开或切换员工时保持详情态；只有当前员工发送成功后才进入聊天态。
                autoEnterBottomOnMessage={false}
                sendExtraParams={projectChatExtraParams}
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
