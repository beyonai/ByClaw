/**
 * 卡片操作处理Hook
 * 负责处理各种操作类型：chat、iframe、fetch、link、custom
 */
import { useCallback } from 'react';
import useGlobal from '@/hooks/useGlobal';
import useAppStore from '@/models/common/useAppStore';
import { ICardAction, CardActionType } from './types';
import { message } from 'antd';
import { getResponseAgentInfo } from '@/components/MessageList/utils';
import useResourceDetail from '@/hooks/useResourceDetail';
import { useSelector } from '@umijs/max';
import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';
import { get } from 'lodash';

function sleep(time = 0) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, time);
  });
}

export function useCardAction({ setPortalContainer }: { setPortalContainer: (container: React.ReactNode) => void }) {
  const { EventEmitter, setSessionId } = useGlobal();
  const { setSiderCollapsed } = useAppStore();
  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const { handleResourceDetail } = useResourceDetail({ setPortalComp: setPortalContainer });

  /**
   * 处理聊天操作
   */
  const handleChatAction = useCallback(
    async (action: Extract<ICardAction, { type: CardActionType.CHAT }>) => {
      const { agentId, message: chatMessage, isNewSession = true, extParams } = action;
      if (!chatMessage) {
        console.error('chatMessage is required');
        return;
      }
      const agentInfo = getResponseAgentInfo({ agentList, employeesList }, JSON.stringify({ agentId }));
      if (!agentInfo) {
        console.error(`agent: ${agentId} not found`);
        return;
      }
      const { agentType } = agentInfo;

      if (isNewSession) {
        setSessionId?.('');
        await sleep();
      }
      EventEmitter.emit('queryInput-set-schema', {
        agentId,
        agentType,
      });
      await sleep();

      let sessionExts: undefined | Array<{ extParamCode: string; extParamName: string; extParamValue: string }>;
      if (extParams) {
        sessionExts = Object.entries(extParams).map(([key, value]) => ({
          extParamCode: key,
          extParamValue: value,
          extParamName: key,
        }));
      }

      // 发送消息
      EventEmitter.emit('beyond-chat-on-send-msg', {
        sendProps: {
          queryQuestion: chatMessage,
          payload: {
            agentType,
            agentId,
            sessionExts,
            extParams,
          },
        },
      });
    },
    [EventEmitter, setSessionId, agentList, employeesList]
  );

  /**
   * 处理iframe操作
   */
  const handleIframeAction = useCallback(
    (action: Extract<ICardAction, { type: CardActionType.IFRAME }>) => {
      const { url, ...rest } = action;

      if (!url) {
        message.error('url is required');
        return;
      }

      EventEmitter.emit('beyond-minor-driver-open-type', {
        canClose: true,
        canCloseContent: true,
        ...rest,
        drawerType: 'iframe',
      });

      // 传递iframe数据
      EventEmitter.emit('beyond-minor-driver-message', {
        url,
      });
      // 收起侧边栏
      setSiderCollapsed(true);
    },
    [EventEmitter, setSiderCollapsed]
  );

  /**
   * 处理fetch操作
   */
  const handleFetchAction = useCallback(async (action: Extract<ICardAction, { type: CardActionType.FETCH }>) => {
    const { url, method = 'POST', headers = {}, params, body, toast, successExpression } = action;

    if (!url) {
      console.error('Fetch action requires url');
      return;
    }

    try {
      // 构建请求配置
      const requestOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      // 处理请求参数
      let requestUrl = url;
      if (method === 'GET' && params) {
        const queryParams = new URLSearchParams(params as Record<string, string>).toString();
        requestUrl = `${url}${queryParams ? `?${queryParams}` : ''}`;
      } else if (body) {
        requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      } else if (params) {
        requestOptions.body = JSON.stringify(params);
      }

      // 发送请求
      const response = await fetch(requestUrl, requestOptions);
      const result = await response.json();

      // 计算接口是否成功
      let isSuccess = response.ok;
      if (successExpression) {
        const expr = successExpression.trim();

        // 仅支持非常简单的「路径 (= 或 ==) 值」形式
        const match = expr.match(/^(.+?)(=)(.+)$/);
        if (match) {
          const [, rawPath, , rawExpected] = match;
          const path = rawPath.trim().replace(/^result\./, ''); // 兼容 'result.xxx' 和 'xxx'
          const expectedRaw = rawExpected.trim();

          let expected: any = expectedRaw;
          // 去掉首尾引号
          if (expectedRaw === 'true' || expectedRaw === 'false') {
            expected = expectedRaw === 'true';
          }

          const actual = get(result, path);
          // eslint-disable-next-line eqeqeq
          isSuccess = actual == expected;
        }
      }

      if (isSuccess && toast?.success) {
        message.success(toast.success);
      }
      if (!isSuccess && toast?.fail) {
        message.error(toast.fail);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        message.error(error.message);
      }
    }
  }, []);

  /**
   * 处理链接操作
   */
  const handleLinkAction = useCallback((action: Extract<ICardAction, { type: CardActionType.LINK }>) => {
    const { url, target = '_blank' } = action;

    if (!url) {
      console.error('Link action requires url');
      return;
    }

    window.open(url, target);
  }, []);

  const handlePopupAction = useCallback((action: Extract<ICardAction, { type: CardActionType.POPUP }>) => {
    const { url, ...rest } = action;

    if (!url) {
      message.error('url is required');
      return;
    }

    EventEmitter.emit('beyond-fullscreen-modal-open-type', {
      canClose: true,
      ...rest,
      drawerType: 'iframe',
    });

    // 传递iframe数据
    EventEmitter.emit('beyond-fullscreen-modal-message', {
      url,
    });
  }, []);

  const handleCustomAction = useCallback((action: Extract<ICardAction, { type: CardActionType.CUSTOM }>) => {
    console.log('handleCustomAction', action);

    if (action.resourceBizType) {
      handleResourceDetail({
        resourceBizType: action.resourceBizType,
        resourceId: action.resourceId,
      });
    }
  }, []);

  /**
   * 执行卡片操作
   */
  const executeAction = useCallback(
    async (action: ICardAction) => {
      switch (action.type) {
        case CardActionType.CHAT:
          await handleChatAction(action);
          break;
        case CardActionType.IFRAME:
          handleIframeAction(action);
          break;
        case CardActionType.FETCH:
          await handleFetchAction(action);
          break;
        case CardActionType.LINK:
          handleLinkAction(action);
          break;
        case CardActionType.POPUP:
          handlePopupAction(action);
          break;
        case CardActionType.CUSTOM:
          handleCustomAction(action);
          break;
        default: {
          break;
        }
      }
    },
    [handleChatAction, handleIframeAction, handleFetchAction, handleLinkAction, handlePopupAction]
  );

  return {
    executeAction,
  };
}
