import useGlobal from '@/hooks/useGlobal';
import { queryResourceDetail } from '@/service/knowledgeCenter';
import { isSandboxAgent } from '@/utils/agent';
import { DOWNLOAD_PATH } from '@/utils/openClaw/const';
import { isOpenClawAgent } from '@/utils/openClaw/utils';
import { setSandboxDynamicUrl } from '@/utils/sandboxDynamicUrl';
import { useDispatch, useNavigate, useIntl } from '@umijs/max';
import { Spin } from 'antd';
import classNames from 'classnames';
import { noop } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import AgentIframe from '../employees/components/AgentIframe';
import styles from '../employees/index.module.less';
import OpenClawBot from './openClawBot';
import useSandboxHeartbeat from './useHeartbeat';
import { isDevelopment } from '@/utils/common';

const SANDBOX_HEARTBEAT_INTERVAL = 5 * 1000;
const SANDBOX_HEARTBEAT_MAX_COUNT = 10;

function getOpenClawDynamicLinkFn(agentHomeUrl: string) {
  const { port: realPort, hostname: realHost } = new URL(agentHomeUrl);
  return (url: string) => {
    const newUrl = url
      .replace(/\{\{sandbox_dynamic_url\}\}/g, isDevelopment() ? URI_TARGET : window.location.origin)
      .replace(/\/download-file/, DOWNLOAD_PATH);
    const newUrlObj = new URL(newUrl);
    newUrlObj.searchParams.append('port', realPort);
    newUrlObj.searchParams.append('ip', realHost);
    return newUrlObj.toString();
  };
}

export default function Sandbox() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const globalContext = useGlobal();
  const { agentId, agentInfo, sessionId } = globalContext;
  const [isLoading, setIsLoading] = useState(true);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const counterRef = useRef(0);

  const intl = useIntl();

  useSandboxHeartbeat();

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 管理沙箱动态 URL 全局 map：sessionId -> 基础 URL(协议+域名+端口)
  // 用于 Markdown 中 {{sandbox_dynamic_url}} 占位符的替换
  useEffect(() => {
    const agentHomeUrl = agentInfo?.agentHomeUrl;
    if (sessionId && agentHomeUrl) {
      let currentUrl: string | ((url: string) => string) = window.location.origin;
      if (isDevelopment()) {
        currentUrl = URI_TARGET;
      }
      if (isOpenClawAgent(agentInfo)) {
        setSandboxDynamicUrl(sessionId, getOpenClawDynamicLinkFn(agentHomeUrl));
      } else {
        setSandboxDynamicUrl(sessionId, currentUrl);
      }
    }
  }, [sessionId, agentInfo?.agentHomeUrl]);

  const getResourceDetail = useCallback(() => {
    if (!agentId) return;
    setIsLoading(true);
    queryResourceDetail({ resourceId: agentId })
      .then((res) => {
        if (!res) return;
        try {
          if (res?.param?.agentHomeUrl) {
            if (isSandboxAgent(res?.param)) {
              const { agentHomeUrl } = res.param;

              if (!agentHomeUrl.includes('token=')) {
                return;
              }

              clearTimer();

              // 沙箱数字员工的url是动态获取的，需要更新一下employeesList中的agentHomeUrl
              dispatch({
                type: 'employees/updateEmployee',
                payload: {
                  employee: {
                    agentId: res?.param?.resourceId,
                    agentHomeUrl,
                  },
                },
              });
            }
          }
          setTimeout(() => {
            setIsLoading(false);
          });
        } catch (error) {
          //
        }
      })
      .catch((e) => {
        console.error(e);
        clearTimer();
      });
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      navigate('/chat', {
        replace: true,
      });
      return noop;
    }

    getResourceDetail();

    timerRef.current = setInterval(() => {
      counterRef.current += 1;
      if (counterRef.current >= SANDBOX_HEARTBEAT_MAX_COUNT) {
        clearTimer();
        return;
      }
      getResourceDetail();
    }, SANDBOX_HEARTBEAT_INTERVAL);

    return () => {
      clearTimer();
    };
  }, [agentId]);

  if (isLoading) {
    return (
      <Spin
        spinning
        tip={intl.formatMessage({ id: 'sandbox.waitTips' })}
        wrapperClassName={classNames(styles.spinningWrapper, 'ub ub-ac ub-pc')}
      >
        <></>
      </Spin>
    );
  }

  if (isOpenClawAgent(agentInfo)) {
    return <OpenClawBot onReload={getResourceDetail} />;
  }

  if (agentInfo?.agentHomeUrl) {
    return <AgentIframe agent={agentInfo} />;
  }

  return null;
}
