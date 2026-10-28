import { GET, POST } from '@/service/common/request';
import { getChatFileArtifactPath, getRelativeChatFileArtifactPath } from '@/utils/chatFileArtifact';

export type ChatFileArtifact = {
  imageId?: string;
  parentImageId?: string;
  title?: string;
  width?: number;
  height?: number;
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

export async function downloadRelativeChatFileArtifact(params: {
  href: string;
  sessionId?: string;
  messageId?: string;
}) {
  const path = getRelativeChatFileArtifactPath(params.href, params.sessionId);
  if (!path || !params.sessionId) throw new Error('Invalid session file link');
  const artifacts = await resolveChatFileArtifacts({
    sessionId: params.sessionId,
    messageId: params.messageId,
    paths: [path],
  });
  const artifact = artifacts.find(
    (item) => getChatFileArtifactPath(item.path) === path && getChatFileArtifactPath(item.sourcePath) === path
  );
  if (!artifact) throw new Error('Session file not found');
  return {
    ...(await downloadChatFileArtifact({ sessionId: params.sessionId, path: artifact.path })),
    path: artifact.path,
  };
}
