import { useState } from 'react';
import { useRequest } from '@umijs/max';
import { getSandboxInfo, removeSandbox, launchSandboxByUserCode, type SandboxInfo } from '@/service/sandbox';

type SandboxStatus = 'running' | 'transitioning' | 'stopped';

const POLL_INTERVAL = 10000; // 10秒轮询一次

function calculateStatus(sandboxes: SandboxInfo[]): SandboxStatus {
  if (!sandboxes || sandboxes.length === 0) {
    return 'stopped';
  }

  const hasRunning = sandboxes.some((s) => s.status === 'RUNNING');
  const hasTransitioning = sandboxes.some((s) => ['STARTING', 'RELEASING'].includes(s.status || ''));

  if (hasTransitioning) {
    return 'transitioning';
  }

  if (hasRunning) {
    return 'running';
  }

  return 'stopped';
}

export default function useSandboxStatus(userCode: string) {
  const [status, setStatus] = useState<SandboxStatus>('stopped');

  const {
    data,
    loading,
    run: refetch,
  } = useRequest(() => getSandboxInfo({ userCode, sandboxType: 'openclaw' }), {
    pollingInterval: POLL_INTERVAL,
    ready: !!userCode,
    onSuccess: (sandboxes: SandboxInfo[]) => {
      const calculatedStatus = calculateStatus(sandboxes);
      setStatus(calculatedStatus);
    },
    onError: () => {
      setStatus('stopped');
    },
  });

  const restartSandbox = async () => {
    // 1. 释放当前沙箱
    await removeSandbox({ userCode, resourceId: null });

    // 等待 2 秒确保释放完成
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 2000);
    });

    // 2. 重新启动沙箱
    await launchSandboxByUserCode({ userCode, serviceKey: 'openclaw' });

    // 3. 立即刷新状态
    await refetch();
  };

  return {
    status,
    isLoading: loading,
    sandboxes: data || [],
    refetch,
    restartSandbox,
  };
}
