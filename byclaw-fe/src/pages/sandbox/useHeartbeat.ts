import { useEffect } from 'react';

import useGlobal from '@/hooks/useGlobal';
import { POST } from '@/service/common/request';
import { isSandboxAgent } from '@/utils/agent';

const SANDBOX_HEARTBEAT_INTERVAL = 1 * 60 * 1000; // 1 分钟

/**
 * 沙箱数字员工心跳上报
 *
 * 获取当前全局的 agentInfo，如果是沙箱数字员工，则每隔 15 分钟
 * 向 `/byaiService/sandbox/heartbeat` 上报一次心跳。
 *
 * 注意：需要在 GlobalProvider 范围内调用该 Hook。
 */
const useSandboxHeartbeat = (): void => {
  const { agentInfo } = useGlobal();

  useEffect(() => {
    if (!agentInfo || !isSandboxAgent(agentInfo) || !agentInfo.id) {
      return () => {};
    }

    const { id } = agentInfo;
    let timer: number | null = null;

    const sendHeartbeat = () => {
      POST(
        '/byaiService/sandbox/heartbeat',
        {
          resourceId: id,
        },
        {
          responseCfg: {
            hideErrorTips: true,
          },
        }
      ).catch((error) => {
        // 心跳失败无需打断页面逻辑，仅在控制台打印即可
        // eslint-disable-next-line no-console
        console.error('sandbox heartbeat error: ', error);
      });
    };

    const startTimer = () => {
      if (!timer) {
        timer = window.setInterval(sendHeartbeat, SANDBOX_HEARTBEAT_INTERVAL);
      }
    };

    const stopTimer = () => {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 页面隐藏时停止定时器
        stopTimer();
      } else {
        // 页面重新可见时启动定时器并立即发送一次心跳
        // TODO: 理论上需要查询当前沙箱是否可用，如果不可用应该退出这个数字员工页面
        startTimer();
        sendHeartbeat();
      }
    };

    // 初始启动：如果页面可见则启动定时器
    if (!document.hidden) {
      startTimer();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [agentInfo]);
};

export default useSandboxHeartbeat;
