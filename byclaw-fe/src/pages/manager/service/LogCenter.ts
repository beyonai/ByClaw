import { POST } from '@/service/common/request';

export type LogSearch = {
  from: number;
  to: number;
  sandboxId?: string;
  keyword?: string;
  level?: string;
  pageSize: number;
  pageToken?: string;
};

export type LogEntry = {
  timestamp: number;
  message: string;
  level?: string;
  source?: string;
  attributes: Record<string, string>;
};

export type LogPage = {
  items: LogEntry[];
  complete: boolean;
  limitReached: boolean;
  nextPageToken?: string;
};

export const searchLogs = (query: LogSearch) =>
  POST<LogPage>('/byaiService/admin-console/logs/search', query, {
    timeout: 140000,
    responseCfg: { hideErrorTips: true },
  });
