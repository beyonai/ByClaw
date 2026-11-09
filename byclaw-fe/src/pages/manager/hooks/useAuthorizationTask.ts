import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { getRequestErrorMessage } from '@/utils/requestError';
import {
  AuthorizationTask,
  cancelAuthorizationTask,
  findAuthorizationTaskRequest,
  listAuthorizationTasks,
  retryAuthorizationTask,
  submitAuthorizationTask,
} from '../service/authorizationTasks';

export const taskIsActive = (task?: AuthorizationTask) =>
  !!task && ['QUEUED', 'RUNNING', 'RETRYING'].includes(task.status);

export const taskBlocksResource = (task?: AuthorizationTask) =>
  taskIsActive(task) || (task?.status === 'FAILED' && task.blocksResource !== false);

export default function useAuthorizationTask({ enabled, resourceId, operation = 'USE', contextKey = '', onCompleted }) {
  const [task, setTask] = useState<AuthorizationTask>();
  const [blockingTask, setBlockingTask] = useState<AuthorizationTask>();
  const [historicalTask, setHistoricalTask] = useState<AuthorizationTask>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(enabled);
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const request = useRef<{ body: string; requestId: string; operation: string }>();
  const refreshSequence = useRef(0);
  const callback = useRef<{ requestId: string; done: () => void }>();
  const completed = useRef<string>();
  const completing = useRef(onCompleted);
  completing.current = onCompleted;

  const matchesRequest = useCallback(
    (value?: AuthorizationTask) =>
      !!value &&
      !!request.current &&
      value.requestId === request.current.requestId &&
      value.operation === request.current.operation &&
      value.submittedByCurrentUser !== false,
    []
  );

  // Only this request can acknowledge submission; blockers and history are independent.
  const accept = useCallback(
    (value: AuthorizationTask) => {
      if (!matchesRequest(value)) return;
      setTask(value);
      if (value.status === 'CANCELLED') {
        request.current = undefined;
        callback.current = undefined;
      }
      if (value.status === 'SUCCEEDED' && completed.current !== value.taskId) {
        completed.current = value.taskId;
        completing.current?.();
        if (callback.current?.requestId === value.requestId) {
          const done = callback.current.done;
          callback.current = undefined;
          message.success('授权成功，已同步生效');
          done();
        }
      }
    },
    [matchesRequest]
  );

  const refresh = useCallback(async () => {
    if (!enabled || !resourceId) return;
    const current = generation.current;
    const sequence = ++refreshSequence.current;
    const submitted = request.current;
    setChecking(true);
    // A failed request lookup must not hide a successfully queried resource blocker.
    const [historyResult, exactResult] = await Promise.allSettled([
      Promise.resolve().then(() => listAuthorizationTasks(resourceId)),
      submitted
        ? Promise.resolve().then(() => findAuthorizationTaskRequest(resourceId, submitted.requestId))
        : Promise.resolve(undefined),
    ]);
    if (
      current !== generation.current ||
      sequence !== refreshSequence.current ||
      submitted?.requestId !== request.current?.requestId
    )
      return;
    let queryFailed = false;
    let matching: AuthorizationTask;
    if (exactResult.status === 'fulfilled' && (!exactResult.value || exactResult.value.code === 0)) {
      const value = exactResult.value?.data;
      if (value && !matchesRequest(value)) {
        queryFailed = true;
      } else {
        matching = value || undefined;
        setTask(matching);
      }
    } else {
      queryFailed = true;
    }
    if (historyResult.status === 'fulfilled' && historyResult.value?.code === 0) {
      const records = historyResult.value.data || [];
      setBlockingTask(records.find(taskBlocksResource));
      setHistoricalTask(records.find((item) => item.status === 'SUCCEEDED' && !matchesRequest(item)));
    } else {
      queryFailed = true;
    }
    setError(queryFailed ? '暂时无法查询授权任务，请点击刷新进度后再提交。' : '');
    setChecking(false);
    if (matching) accept(matching);
    return matching;
  }, [enabled, resourceId, operation, contextKey, accept, matchesRequest]);

  useEffect(() => {
    generation.current++;
    setTask(undefined);
    setSubmitting(false);
    setChecking(enabled);
    setBlockingTask(undefined);
    setHistoricalTask(undefined);
    setError('');
    request.current = undefined;
    callback.current = undefined;
    refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);

  useEffect(() => {
    if (!taskIsActive(task) && !taskIsActive(blockingTask)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [task?.taskId, task?.status, blockingTask?.taskId, blockingTask?.status, refresh]);

  const submit = useCallback(
    async (setting, operation, done) => {
      const current = generation.current;
      const body = JSON.stringify({ setting, operation });
      if (request.current?.body !== body) {
        request.current = {
          body,
          operation,
          requestId: globalThis.crypto?.randomUUID?.() || `auth_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        };
      }
      setSubmitting(true);
      setTask(undefined);
      setError('');
      refreshSequence.current++;
      setChecking(false);
      callback.current = { requestId: request.current.requestId, done };
      try {
        const response = await submitAuthorizationTask({ setting, operation, requestId: request.current.requestId });
        if (current !== generation.current) return;
        if (response.code !== 0) throw new Error(response.msg || '提交失败');
        if (!matchesRequest(response.data)) throw new Error('提交结果与当前请求不匹配');
        accept(response.data);
        setBlockingTask((previous) => {
          if (taskBlocksResource(response.data)) return response.data;
          return previous?.taskId === response.data.taskId ? undefined : previous;
        });
      } catch (failure) {
        if (current === generation.current) {
          const matching = await refresh();
          if (current === generation.current && !matching) {
            setError(
              `未能确认提交结果：${getRequestErrorMessage(
                failure,
                '网络异常'
              )}。请刷新进度确认；重试提交会复用同一请求标识。`
            );
          }
        }
      } finally {
        if (current === generation.current) setSubmitting(false);
      }
    },
    [accept, refresh, matchesRequest]
  );

  const action = useCallback(
    async (cancel = false, target = blockingTask || task) => {
      if (!target) return;
      const current = generation.current;
      setSubmitting(true);
      refreshSequence.current++;
      setChecking(false);
      try {
        if (cancel ? target.canCancel === false : target.canRetry === false) return;
        const response = await (cancel ? cancelAuthorizationTask : retryAuthorizationTask)(target.taskId);
        if (current !== generation.current) return;
        if (response.code !== 0) throw new Error(response.msg || '操作失败');
        if (response.data.taskId !== target.taskId || response.data.operation !== target.operation) {
          throw new Error('任务操作结果不匹配，请刷新进度确认');
        }
        accept(response.data);
        setBlockingTask(taskBlocksResource(response.data) ? response.data : undefined);
        setError('');
        if (cancel && response.data.status === 'CANCELLED') {
          request.current = undefined;
          callback.current = undefined;
        }
      } catch (failure) {
        if (current === generation.current) setError(getRequestErrorMessage(failure, '操作失败，请刷新进度确认'));
      } finally {
        if (current === generation.current) setSubmitting(false);
      }
    },
    [task, blockingTask, accept]
  );

  return {
    task,
    blockingTask,
    historicalTask,
    taskError: error,
    taskChecking: checking,
    taskSubmitting: submitting,
    taskBlocked:
      enabled && (checking || submitting || !!error || taskBlocksResource(task) || taskBlocksResource(blockingTask)),
    submitTask: submit,
    refreshTask: refresh,
    retryTask: (target?: AuthorizationTask) => action(false, target),
    cancelTask: (target?: AuthorizationTask) => action(true, target),
  };
}
