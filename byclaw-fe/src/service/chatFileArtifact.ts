import { GET, POST } from '@/service/common/request';

export type ChatFileArtifact = {
  sourcePath: string;
  path: string;
  fileName: string;
  fileSize?: number;
  contentType?: string;
};

export type ChatFileArtifactResolveRequest = {
  sessionId: string | number;
  messageId?: string;
  paths: string[];
};

export function resolveChatFileArtifacts(params: ChatFileArtifactResolveRequest) {
  return POST<ChatFileArtifact[]>('/byaiService/chat/file-artifacts/resolve', params);
}

export function downloadChatFileArtifact(params: { sessionId: string | number; path: string }) {
  return GET<{ fileName: string; file: Blob }>('/byaiService/chat/file-artifacts/download', params, {
    responseType: 'blob',
  });
}
