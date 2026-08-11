import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSandboxInfo, removeSandbox, launchSandboxByUserCode, type SandboxInfo } from '@/service/sandbox';

type SandboxStatus = 'running' | 'transitioning' | 'stopped';

// 稳定态（RUNNING/stopped）30 秒足够；过渡态（RELEASING）压到 5 秒，否则状态点最长要等 30 秒才跟上。
// 过渡态由后端同一请求内闭环，且元数据缓存 TTL 兜底，不会长期停在快档。
const POLL_INTERVAL_STABLE = 30000;
const POLL_INTERVAL_TRANSITIONING = 5000;

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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sandboxStatus', userCode],
    queryFn: () => getSandboxInfo({ userCode }),
    refetchInterval: (latest) =>
      calculateStatus(latest ?? []) === 'transitioning' ? POLL_INTERVAL_TRANSITIONING : POLL_INTERVAL_STABLE,
    enabled: !!userCode,
  });

  useEffect(() => {
    if (data) {
      const calculatedStatus = calculateStatus(data);
      setStatus(calculatedStatus);
    } else {
      setStatus('stopped');
    }
  }, [data]);

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
    isLoading,
    sandboxes: data || [],
    refetch,
    restartSandbox,
  };
}
