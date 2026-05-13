/* eslint-disable no-nested-ternary */
/**
 * 将 OpenClaw chat.history 返回的 messages 转为「历史消息行」结构，
 * 再由 fetchMessageHandler 统一转换为 IMessage，供 ChatLayoutComp 展示。
 */
import { getModelState } from '@/utils';
import { IMessageState, SSEMessageType } from '@/constants/message';
import { getDownloadOpenClawFileUrl, parseFilePrompt } from './utils';

function transferFileDownloadPath(text: string) {
  // 提取特定格式的下载URL并进行处理，支持HTTP和HTTPS
  const urlRegex = /(https?):\/\/[^/\s:]+(?::\d+)?\/download-file\?path=[^"\s)<>]*/gi;
  return text.replace(urlRegex, (fullUrl: string, protocol: string) => {
    // 解析URL并提取path参数
    let newFullUrl = fullUrl;
    const pathMatch = fullUrl.match(/[?&]path=([^&\s]*)/);
    if (pathMatch) {
      const encodedPath = pathMatch[1];
      const decodedPath = decodeURIComponent(encodedPath);

      console.log('Found download URL:', fullUrl);
      console.log('Protocol:', protocol);
      console.log('Encoded path:', encodedPath);
      console.log('Decoded path:', decodedPath);

      // 这里可以添加URL转换逻辑，例如修改路径参数等
      newFullUrl = getDownloadOpenClawFileUrl(decodedPath);
      console.log(newFullUrl);
    }

    return newFullUrl; // 返回完整的URL，可能已转换
  });
}

export type OpenClawHistoryItem = {
  role: 'user' | 'assistant';
  content: unknown;
  timestamp?: number | string;
  [key: string]: unknown;
};

function extractTextFromContent(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        if (entry.type === 'text' && typeof entry.text === 'string') return entry.text;
        return null;
      })
      .filter((s): s is string => Boolean(s));
    return parts.join('');
  }
  if (typeof content === 'object' && content !== null && 'text' in content) {
    const t = (content as { text?: unknown }).text;
    return typeof t === 'string' ? t : '';
  }
  return '';
}

/**
 * 将 OpenClaw 历史消息列表转为 IMessage[]。
 * @param history chat.history 返回的 messages 数组
 * @param sessionId 会话 ID
 * @param agentId 智能体 ID（可选）
 */
export function convertOpenClawToIMessage(history: OpenClawHistoryItem[], sessionId: string, agentId?: string): any[] {
  const userState = getModelState<{ userInfo?: { userId?: string; userName?: string } }>('user');
  const creatorId = userState?.userInfo?.userId ?? '';

  if (!Array.isArray(history)) return [];

  return history
    .map((msg, index) => {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return null;
      const isUser = msg.role === 'user';
      const rawText = extractTextFromContent(msg.content);
      const ts = msg.timestamp;
      const createTime =
        ts !== null && ts !== undefined ? (typeof ts === 'string' ? ts : String(ts)) : String(Date.now());
      if (!rawText) return null;

      let text = rawText;
      let relatedResources: string | undefined;

      // 用户消息：尝试从 prompt 中解析出真正的问题与文件信息
      if (isUser) {
        const { userQuestion, fileInfo } = parseFilePrompt(rawText);
        text = userQuestion || rawText;
        if (fileInfo) {
          relatedResources = JSON.stringify({
            files: [
              {
                ...fileInfo,
                fileId: 1,
                fileType: 'file',
                fileUrl: fileInfo.filePath,
                downloadUrl: getDownloadOpenClawFileUrl(fileInfo.filePath),
              },
            ],
          });
        }
      }

      let metadata: string | undefined;
      let messageStruct: string | undefined;
      if (!isUser) {
        metadata = JSON.stringify({ agentId });
        // 处理文本中的URL，进行转换
        const processedText = transferFileDownloadPath(text);
        messageStruct = JSON.stringify([
          {
            choices: [
              {
                delta: {
                  content: processedText,
                  finish_reason: '',
                  index: '0',
                },
              },
            ],
            contentType: SSEMessageType.text,
          },
        ]);
      }
      const m: any = {
        metadata,
        creatorId,
        createTime,
        messageStruct,
        fromBeyond: !isUser,
        messageState: IMessageState.Done,
        messageId: Date.now() + index,
        messageContent: text,
        usage: isUser ? '1' : '2',
        sessionId,
        agentId,
        messageList: [],
        thinkList: [],
        thinkDone: false,
        thinkCollapse: false,
      };
      if (relatedResources) {
        m.relatedResources = relatedResources;
      }
      return m;
    })
    .filter(Boolean);
}
