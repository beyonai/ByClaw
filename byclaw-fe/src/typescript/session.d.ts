import { IChatModeType } from "@/constants/query";
import { SessionType } from "@/constants/session";


export interface ISession {
  sessionContent?: ReactNode;
  sessionName: string; // 列表中的会话名称
  parentSessionId: number; // 列表中的父会话ID
  creatorId?: number; // 列表中的创建者ID
  createTime: string; // 会话的创建时间
  updateTime: string; // 会话的创建时间
  sessionId: string; // 列表中的会话ID
  enterpriseId?: number; // 列表中的企业ID
  objectId?: number; // 列表中的对象ID
  objectType?: string; // 列表中的对象类型
  showEditName?: boolean; // 控制编辑名称的
  sessionType?: SessionType;
  agentType?: string;
  id?: string;

  unreadCount?: number;
  mentionCount?: number; // @我的数量
  enterpriseId?: number;
  avatar?: string;
  theme?: string;

  citeMsgIdList?: string[];
  participants?: Array<{
    participantName: string;
    participantType: string;
    participantId: string | number;
  }>;

  defaultChatMode?: IChatModeType;
  sessionExts?: Array<{ extParamName: string; extParamCode: string; extParamValue: string }>;
}
