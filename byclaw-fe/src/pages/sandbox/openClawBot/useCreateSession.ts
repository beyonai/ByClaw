import { useCallback } from 'react';
import { useDispatch } from '@umijs/max';
import type { ISession } from '@/typescript/session';
import { SessionType } from '@/constants/session';
import usePersistFn from '@/hooks/usePersistFn';
import { querySessionByAgent, createOpenClawSession } from './utils';

/**
 * OpenClaw 创建/获取会话 hook
 * 1. 先按 agent 查询会话列表，若列表为空则调用创建会话接口
 * 2. 创建成功后执行 addSession，与 ChatLayoutComp 中 addSession 行为一致
 */
export default function useCreateSession() {
  const dispatch = useDispatch();

  const addSession = useCallback(
    (newSession: ISession) => {
      dispatch({
        type: 'session/addSession',
        payload: newSession,
      });
    },
    [dispatch]
  );

  const createSession = useCallback(
    async (agentId?: string) => {
      if (!agentId) {
        return null;
      }
      const objectId = agentId;
      const res = await querySessionByAgent({ objectId });
      const list = res?.list ?? [];
      if (list.length > 0) {
        return list[0];
      }
      const createRes = await createOpenClawSession({
        objectId,
        objectType: 'OpenClaw',
        sessionContent: '',
        sessionName: 'OpenClaw',
      });
      if (!createRes?.sessionId) {
        return null;
      }
      const newSession: Omit<ISession, 'updateTime'> = {
        sessionId: `${createRes.sessionId}`,
        sessionName: createRes.sessionName ?? 'OpenClaw',
        parentSessionId: 0,
        createTime:
          createRes.createTime !== null && createRes.createTime !== undefined
            ? String(createRes.createTime)
            : String(Date.now()),
        sessionType: SessionType.basic,
        objectType: 'OpenClaw',
        objectId: typeof objectId === 'number' ? objectId : Number(objectId) || undefined,
      };
      addSession(newSession as ISession);
      return createRes;
    },
    [addSession]
  );

  return usePersistFn(createSession);
}
