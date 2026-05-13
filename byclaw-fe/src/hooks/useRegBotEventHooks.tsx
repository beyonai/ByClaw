import { get, isEmpty, set, unset, pick } from 'lodash';
import { useCallback, useState } from 'react';
import { useSelector, useDispatch, useNavigate, getIntl } from '@umijs/max';
import { message as antdMessage } from 'antd';

import useGlobal from '@/hooks/useGlobal';
import useAppStore from '@/models/common/useAppStore';
import { createTaskConversation, updateResCom, updateTask, approveTask } from '@/service/task';

import useResourceDetail from './useResourceDetail';

import { SSEMessageType } from '@/constants/message';
import { agentTypeMap } from '@/constants/agent';

import { getModelState, getRootPagePath } from '@/utils';
import { ssoLoginByIframe } from '@/utils/bot';

import type { IAgentCache, IAgentType } from '@/typescript/agent.d';
import type { IMessage } from '@/typescript/message';

import { ITask } from '@/typescript/task';

const useRegBotEventHooks = (props: {
  loadSsoIframeUrl?: string;
  taskId?: string;
  stepId?: string;
  stepTaskId?: string;
  setSpinning?: React.Dispatch<React.SetStateAction<boolean>>;
  message?: Partial<IMessage>;
  messageIdx?: number;
  submitBtnInfo?: {
    submitBtnBId?: string;
  };
  getTodoItem?: () => ITask;
}): any => {
  const { taskId, stepId, stepTaskId, loadSsoIframeUrl, setSpinning, message, messageIdx, submitBtnInfo, getTodoItem } =
    props;
  const { metadata } = message || {};

  const { setAgentId, setSessionId, EventEmitter } = useGlobal();
  const { setSiderCollapsed } = useAppStore();

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { employeesList, agentList } = useSelector(({ employees }) => pick(employees, ['employeesList', 'agentList']));

  const [PortalComp, setPortalComp] = useState<React.ReactNode>(null);

  const { handleResourceDetail } = useResourceDetail({ setPortalComp });

  const sendChatMessage = useCallback(
    async (data: {
      content: string; // 对话内容
      params: {
        toResCode: string; // 填写百应的agent、插件的编码
        extParam: {
          // 扩展参数，透传给agent或工作流
          systemCode: string;
          taskExtId: string;
          pageUrl: string;
          common?: any;
          chat_type?: string; // 是否需要填表
        };
      };
    }) => {
      if (!data || isEmpty(data)) return;

      try {
        setSpinning?.(true);

        await ssoLoginByIframe(loadSsoIframeUrl);

        const content = get(data, 'content');
        const { extParam } = data.params || {};
        const { toResCode } = data.params || {};

        let agentType: IAgentType = agentTypeMap.botAgent;
        let agentId = toResCode;

        if (!Number(agentId)) {
          agentId = [...agentList, ...employeesList].find(
            (agent: IAgentCache) => agent.resourceCode === agentId || `${agent.id}` === agentId
          )?.agentId;
        }

        const messageItemAgentId =
          get(message, `messageList.${messageIdx}.agentId`) || get(message, `thinkList.${messageIdx}.agentId`);
        if (messageItemAgentId) {
          agentId = messageItemAgentId;
        } else if (metadata) {
          try {
            const metadataObj = JSON.parse(metadata);
            if (metadataObj?.agentId) {
              agentId = metadataObj?.agentId;
            }
          } catch (e) {
            console.error('metadataObj is not a valid JSON string.');
          }
        }

        if (!taskId) {
          EventEmitter.emit('beyond-chat-on-send-msg', {
            sendProps: {
              queryQuestion: content,
              payload: {
                agentId,
                extParams: extParam,
              },
              msgOpt: {
                answerMsg: {
                  agentId,
                  agentType,
                },
              },
            },
          });
          setSpinning?.(false);
          return;
        }

        // 请求sessionId
        const sessionInfo = await createTaskConversation({
          taskId,
        });

        if (!sessionInfo) {
          setSpinning?.(false);
          return;
        }

        const { sessionId, sessionName } = sessionInfo;

        await dispatch({
          type: 'session/saveExtParamsBySessionId',
          payload: {
            sessionId: `${sessionId}`,
            extParams: {
              beyondTaskId: taskId,
              ...extParam,
            },
          },
        });

        await dispatch({
          type: 'session/addSession',
          payload: {
            ...sessionInfo,
            sessionId: `${sessionId}`,
            sessionName: sessionName || content,
          },
        });

        // 获取所有mesages
        const sessionCacheInfo = await dispatch({
          type: 'messageStore/getSessionMessage',
          payload: {
            sessionId,
          },
        });

        navigate(getRootPagePath());
        setAgentId?.(agentId);
        setSessionId?.(sessionId);
        EventEmitter.emit('beyond-input-change-agenttype', agentType);

        const { list = [] } = sessionCacheInfo || {};
        if (!isEmpty(list)) {
          setSpinning?.(false);
          return;
        }

        setTimeout(async () => {
          EventEmitter.emit('beyond-chat-on-send-msg', {
            sendProps: {
              queryQuestion: content,
              payload: {
                agentId,
                extParams: extParam,
              },
              msgOpt: {
                answerMsg: {
                  // agentId,
                  agentType,
                },
              },
            },
          });

          setSpinning?.(false);
        }, 1000);
      } catch (e) {
        antdMessage.error(`${e}`);
        console.log(e);
        setSpinning?.(false);
      }
    },
    [setAgentId, taskId, loadSsoIframeUrl, employeesList, message, metadata, messageIdx, agentList]
  );

  const pageFunc = (
    pageInfo: { url?: string; pageId?: string; param: any; approvalContent?: string },
    clickInfo: {
      value: 'openByaiAppPage' | 'openByaiCard' | 'closeByaiCard' | 'byaiLoadSsoIframUrl' | 'authPass' | 'authNotPass';
      bId?: string;
    }
  ) => {
    const { value, bId } = clickInfo;
    if (value === 'authPass' || value === 'authNotPass') {
      const taskState = getModelState('task');

      const { tohandleList } = taskState || {};
      const target = tohandleList.find((item: ITask) => `${item.taskId}` === `${taskId}`) || getTodoItem?.();
      if (!target) return;

      const { resPageObj } = target;

      let { resPage } = target;
      let approvalStatus = '';

      if (value === 'authPass') {
        unset(resPageObj, 'authNotPassParam');
        approvalStatus = 'PASS';
      }
      if (value === 'authNotPass') {
        unset(resPageObj, 'authPassParam');
        approvalStatus = 'REJECT';
      }
      // set(target, 'authPassParam.disabled', false);
      // set(resPageObj, 'disabledBIds', [bId]);

      try {
        resPage = JSON.stringify(resPageObj);
        set(target, 'resPage', resPage);
      } catch (e) {
        console.error(e);
      }

      setSpinning?.(true);
      approveTask({
        taskId,
        approvalStatus,
        approvalContent: pageInfo?.approvalContent,
        messageId: message?.messageId ? Number(message?.messageId) : undefined,
      })
        .then(() => {
          updateResCom({
            resComId: target.resComId,
            resPage,
            taskId,
            messageId: message?.messageId ? Number(message?.messageId) : undefined,
          });

          dispatch({
            type: 'task/updateTohanleItem',
            payload: {
              taskId,
              statusCd: 'Completed',
              targetTask: target,
            },
          });

          EventEmitter.emit('beyond-update-task', {
            taskId,
            statusCd: 'Completed',
            targetTask: target,
          });
        })
        .finally(() => {
          setSpinning?.(false);
        });
    }
    if (value === 'byaiLoadSsoIframUrl') {
      ssoLoginByIframe(pageInfo?.url);
    }
    if (value === 'openByaiAppPage' && pageInfo.url) {
      setSiderCollapsed(true);
      EventEmitter.emit('beyond-minor-driver-open-type', {
        drawerType: 'iframe',
        canClose: true,
        canFullScreen: true,
      });
      EventEmitter.emit('beyond-minor-driver-message', { url: pageInfo.url });
    }

    if (value === 'openByaiCard') {
      EventEmitter.emit('beyond-operatepopup-set-compconent', {
        messageListItem: {
          contentType: SSEMessageType.botCard,
        },
        messageListItemContent: {
          substance: {
            ...pageInfo,
          },
          submitBtnInfo: {
            submitBtnBId: bId,
          },
          stepId,
          stepTaskId,
        },
        message,
        messageIdx,
      });
    }

    // 点击提交成功后回调
    if (value === 'closeByaiCard') {
      const parentMessageListItemContent = get(message, `messageList.${messageIdx}.content`);
      if (parentMessageListItemContent) {
        const controlBtns = get(parentMessageListItemContent, 'substance.data.pageContent.controlBtns');
        const targetBtn = controlBtns?.find?.((item) => item.bId === submitBtnInfo?.submitBtnBId);
        if (targetBtn) {
          set(targetBtn, 'display', false);

          EventEmitter.emit('beyond-update-message', {
            message: { ...message },
            opt: {
              isAssign: true,
            },
          });
        }
      }

      EventEmitter.emit('beyond-operatepopup-set-compconent', {});
      setSpinning?.(true);
      let updateList: Promise<any>[] = [];
      // 如果是待办才会走updateTask接口
      if (taskId) {
        updateList = [
          updateTask({
            taskId,
            statusCd: 'Completed',
          }),
        ];
      }

      if (parentMessageListItemContent) {
        const resComId = get(message, 'resComIds.0.resComId');
        try {
          updateList.push(
            updateResCom({
              resComId,
              resPage: JSON.stringify(get(parentMessageListItemContent, 'substance')),
            })
          );
        } catch (e) {
          console.error(e);
        }
      }

      Promise.race(updateList)
        .then(() => {
          dispatch({
            type: 'task/updateTohanleItem',
            payload: {
              taskId,
              statusCd: 'Completed',
            },
          });

          if (stepId) {
            // todo: 若是stepId存在，则请求流程sse
            const intl = getIntl();
            EventEmitter.emit('beyond-chat-on-send-msg', {
              sendProps: {
                queryQuestion: intl.formatMessage({ id: 'common.approve' }),
                payload: {
                  taskOperateType: 'FEEDBACK',
                  llmMessageId: message?.messageId || '',
                  taskStepId: stepId,
                },
                msgOpt: {
                  answerMsg: {
                    ...message,
                  },
                },
              },
              sendConf: {
                onlyQuery: true,
              },
            });
          }
        })
        .finally(() => {
          setSpinning?.(false);
        });
    }
  };

  const byaiCustom = useCallback(
    (
      pageInfo: {
        substance: Omit<ITask, 'resPage'>;
      },
      clickInfo: {
        type: string;
        value: string;
        bId: string;
      }
    ) => {
      const { substance } = pageInfo;

      if (clickInfo.value === 'resourceDetail') {
        handleResourceDetail(substance);
      }
    },
    [handleResourceDetail]
  );

  return {
    sendChatMessage,
    pageFunc,
    byaiCustom,
    PortalComp,
  };
};

export default useRegBotEventHooks;
