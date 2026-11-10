import { GET, POST } from '@/service/common/request';
import { downloadFile } from '@/service/fileBrowser';
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

export type ProjectSharedFileScope = {
  resourceId: string;
  rootPath: string;
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
  sharedScope?: ProjectSharedFileScope;
}): Promise<{ file: Blob; fileName: string; path: string; loadResource?: (path: string) => Promise<Blob> }> {
  const { href, sessionId, messageId, sharedScope } = params;
  const path = getRelativeChatFileArtifactPath(href, sessionId);
  if (!path || !sessionId) throw new Error('Invalid session file link');
  const artifacts = await resolveChatFileArtifacts({
    sessionId,
    messageId,
    paths: [path],
  });
  const artifact = artifacts.find(
    (item) => getChatFileArtifactPath(item.path) === path && getChatFileArtifactPath(item.sourcePath) === path
  );
  if (artifact) {
    return {
      ...(await downloadChatFileArtifact({ sessionId, path: artifact.path })),
      path: artifact.path,
    };
  }
  if (!sharedScope) throw new Error('Session file not found');

  // DSH 项目任务以共享目录为工作目录。会话内无文件时，保留原相对路径到当前项目查找。
  const { resourceId, rootPath } = sharedScope;
  const relativePath = path.slice(`/.sessions/${sessionId}/`.length);
  const sharedPath = `${rootPath}${relativePath}`;
  return {
    ...(await downloadFile(resourceId, sharedPath)),
    path: sharedPath,
    loadResource: async (resourcePath) => {
      const decodedPath = decodeURIComponent(resourcePath).replace(/\\/g, '/');
      if (!decodedPath.startsWith(rootPath) || decodedPath.split('/').includes('..')) {
        throw new Error('Resource outside project shared directory');
      }
      return (await downloadFile(resourceId, decodedPath)).file;
    },
  };
}
