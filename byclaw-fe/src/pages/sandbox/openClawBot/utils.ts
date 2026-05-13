import { POST } from '@/service/common/request';

/** 按 agent 查询会话列表接口出参中的单条会话 */
export interface IQuerySessionByAgentItem {
  sessionName: string;
  sessionType: string;
  sessionId: number;
}

/** 按 agent 查询会话列表接口出参 */
export interface IQuerySessionByAgentResult {
  list: IQuerySessionByAgentItem[];
  pageNum: number;
  pageSize: number;
  rows: unknown;
  total: number;
  totalPages: number;
}

/** 按 agent 查询会话列表（请求层返回 data） */
export const querySessionByAgent = (params: { objectId: string | number }) =>
  POST<IQuerySessionByAgentResult>('/byaiService/assiman/querySessionByAgent', { objectId: params.objectId });

/** 创建会话（OpenClaw）入参 */
export interface ICreateSessionParams {
  objectId: string | number;
  objectType: string;
  sessionContent: string;
  sessionName: string;
}

/** 创建会话接口出参（按通用 data 结构假定） */
export interface ICreateSessionResult {
  sessionId?: number | string;
  sessionName?: string;
  sessionType?: string;
  objectId?: number | string;
  objectType?: string;
  createTime?: string | number;
  [key: string]: unknown;
}

/** 创建 OpenClaw 会话（请求层返回 data） */
export const createOpenClawSession = (params: ICreateSessionParams) =>
  POST<ICreateSessionResult>('/byaiService/open/api/v1/createSession', params);
