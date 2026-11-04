import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import {
  AuthorizationTask,
  cancelAuthorizationTask,
  getAuthorizationTask,
  listAuthorizationTasks,
  retryAuthorizationTask,
  submitAuthorizationTask,
} from '../service/authorizationTasks';

export const taskIsActive = (task?: AuthorizationTask) =>
  !!task && ['QUEUED', 'RUNNING', 'RETRYING'].includes(task.status);

export default function useAuthorizationTask({ enabled, resourceId, onCompleted }) {
  const [task, setTask] = useState<AuthorizationTask>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(enabled);
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const request = useRef<{ body: string; requestId: string }>();
  const callback = useRef<{ requestId: string; done: () => void }>();
  const completed = useRef<string>();
  const completing = useRef(onCompleted);
  completing.current = onCompleted;

  const accept = useCallback((value: AuthorizationTask) => {
    setTask(value);
    setError('');
    if (value?.status === 'SUCCEEDED' && completed.current !== value.taskId) {
      completed.current = value.taskId;
      completing.current?.();
      if (callback.current?.requestId === value.requestId) {
        const done = callback.current.done;
        callback.current = undefined;
        message.success('授权成功，已同步生效');
        done();
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !resourceId) return;
    const current = generation.current;
    setChecking(true);
    try {
      const response = await listAuthorizationTasks(resourceId);
      if (current !== generation.current) return;
      if (response.code !== 0) throw new Error(response.msg || '任务查询失败');
      // A failed unfinished task still holds the resource until retried or explicitly abandoned.
      const latest =
        response.data?.find((item) => taskIsActive(item) || item.status === 'FAILED') || response.data?.[0];
      accept(latest);
      return latest;
    } catch {
      if (current === generation.current) setError('暂时无法查询授权任务，请点击刷新进度后再提交。');
    } finally {
      if (current === generation.current) setChecking(false);
    }
  }, [enabled, resourceId, accept]);

  useEffect(() => {
    generation.current++;
    setTask(undefined);
    setError('');
    request.current = undefined;
    callback.current = undefined;
    refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);

  useEffect(() => {
    if (!taskIsActive(task)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 2000;
      try {
        const response = await getAuthorizationTask(task.taskId);
        if (stopped) return;
        if (response.code !== 0) throw new Error(response.msg);
        accept(response.data);
        if (!taskIsActive(response.data)) return;
      } catch {
        if (stopped) return;
        delay = 5000;
        setError('暂时无法获取进度，正在重连；后台任务仍继续，请勿重复提交。');
      }
      timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [task?.taskId, task?.status, accept]);

  const submit = useCallback(
    async (setting, operation, done) => {
      const current = generation.current;
      const body = JSON.stringify({ setting, operation });
      if (request.current?.body !== body) {
        request.current = {
          body,
          requestId: globalThis.crypto?.randomUUID?.() || `auth_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        };
      }
      setSubmitting(true);
      callback.current = { requestId: request.current.requestId, done };
      try {
        const response = await submitAuthorizationTask({ setting, operation, requestId: request.current.requestId });
        if (current !== generation.current) return;
        if (response.code !== 0) throw new Error(response.msg || '提交失败');
        accept(response.data);
      } catch (failure) {
        if (current === generation.current) {
          // Resolve a potentially accepted request after transport failure without resubmitting changes.
          const latest = await refresh();
          if (current === generation.current && latest?.requestId !== request.current?.requestId) {
            setError(
              `未能确认提交结果：${failure?.message || '网络异常'}。请刷新进度确认；重试提交会复用同一请求标识。`
            );
          }
        }
      } finally {
        if (current === generation.current) setSubmitting(false);
      }
    },
    [accept, refresh]
  );

  const action = useCallback(
    async (cancel = false) => {
      if (!task) return;
      const current = generation.current;
      setSubmitting(true);
      try {
        const response = await (cancel ? cancelAuthorizationTask : retryAuthorizationTask)(task.taskId);
        if (current !== generation.current) return;
        if (response.code !== 0) throw new Error(response.msg || '操作失败');
        accept(response.data);
      } catch (failure) {
        if (current === generation.current) setError(failure?.message || '操作失败，请刷新进度确认');
      } finally {
        if (current === generation.current) setSubmitting(false);
      }
    },
    [task, accept]
  );

  return {
    task,
    taskError: error,
    taskChecking: checking,
    taskSubmitting: submitting,
    taskBlocked: enabled && (checking || submitting || !!error || taskIsActive(task) || task?.status === 'FAILED'),
    submitTask: submit,
    refreshTask: refresh,
    retryTask: () => action(false),
    cancelTask: () => action(true),
  };
}
