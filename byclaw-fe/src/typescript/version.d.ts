export type IVersionNotification = {
  id: string | number;
  title: string;
  content: string;
  bizType: 2;
  priority?: string | number;
  isRead: string; // 0 | 1
  resourceBizType: null;
  resourceId: null;
  isDeleted: string; // 0 | 1
  senderId: string;
  targetId: null;
  createTime: string;
  readTime: string | null; // 读取时间
  expireTime: string | null; // 过期时间
  extraInfo: string;
  contentType: string | null; // 内容类型
};

export type IVersionInfo = {
  version: string;
  branch: string;
  commit: string;
  commitFull: string;
  buildTime: string;
  module: string;
  commitMsg: string;
};