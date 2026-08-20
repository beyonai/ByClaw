import React, { useEffect, useMemo, useState } from 'react';

import FileRender from '@/components/MessageList/components/FileRender';
import { createRelativePathResourceResolver } from '@/components/MessageList/components/FileRender/components/Previewer/relativeResource';
import getDisplayAnswer from '@/components/QueryInput/getDisplayAnswer';
import { ChatFileArtifact, downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
import { IMessageState } from '@/constants/message';
import type { IFile } from '@/typescript/file';
import type { IMessage } from '@/typescript/message';
import { extractChatFileArtifactPaths } from '@/utils/chatFileArtifact';

const resolveCache = new Map<string, Promise<ChatFileArtifact[]>>();

const MAX_RESOLVE_CACHE_SIZE = 200;

const getCachedArtifacts = (cacheKey: string, message: IMessage, paths: string[], sessionId: string) => {
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  const request = resolveChatFileArtifacts({
    sessionId,
    messageId: message.messageId || message.msgId,
    paths,
  }).catch((error) => {
    resolveCache.delete(cacheKey);
    throw error;
  });
  if (resolveCache.size >= MAX_RESOLVE_CACHE_SIZE) {
    const oldestKey = resolveCache.keys().next().value;
    if (oldestKey) resolveCache.delete(oldestKey);
  }
  resolveCache.set(cacheKey, request);
  return request;
};

const getExistingFileKeys = (message: IMessage) => {
  const keys = new Set<string>();
  message.fileList?.forEach((item) => {
    const path = item.queryFile?.filePath || item.queryFile?.fileUrl || item.downloadUrl;
    const fileName = item.queryFile?.fileName || item.file?.name;
    if (path) keys.add(`path:${path}`);
    if (fileName) keys.add(`name:${fileName}`);
  });
  return keys;
};

function ReplyFileArtifacts({ message, sessionId }: { message: IMessage; sessionId?: string }) {
  const [artifacts, setArtifacts] = useState<ChatFileArtifact[]>([]);
  const answerText = useMemo(
    () => [message.text, getDisplayAnswer(message.messageList)].filter(Boolean).join('\n'),
    [message.messageList, message.text, message.updateKey]
  );
  const paths = useMemo(() => extractChatFileArtifactPaths(answerText), [answerText]);
  const resolvedSessionId = message.sessionId || sessionId;
  const canResolve =
    message.fromBeyond && message.messageState === IMessageState.Done && Boolean(resolvedSessionId) && paths.length > 0;

  useEffect(() => {
    if (!canResolve || !resolvedSessionId) {
      setArtifacts([]);
      return undefined;
    }

    let active = true;
    const cacheKey = `${resolvedSessionId}:${message.messageId || message.msgId}:${paths.join('|')}`;
    getCachedArtifacts(cacheKey, message, paths, resolvedSessionId)
      .then((items) => {
        if (active) setArtifacts(items || []);
      })
      .catch(() => {
        if (active) setArtifacts([]);
      });

    return () => {
      active = false;
    };
  }, [canResolve, message, paths, resolvedSessionId]);

  const files = useMemo(() => {
    if (!resolvedSessionId) return [];
    const existingKeys = getExistingFileKeys(message);
    return artifacts
      .filter(
        (artifact) =>
          !existingKeys.has(`path:${artifact.path}`) &&
          !existingKeys.has(`path:${artifact.sourcePath}`) &&
          !existingKeys.has(`name:${artifact.fileName}`)
      )
      .map<IFile>((artifact) => ({
        uid: `reply-artifact:${artifact.path}`,
        status: 'done',
        fileType: 'file',
        downloadRequest: () => downloadChatFileArtifact({ sessionId: resolvedSessionId, path: artifact.path }),
        resolvePreviewResource: createRelativePathResourceResolver(artifact.path, async (path) => {
          const response = await downloadChatFileArtifact({ sessionId: resolvedSessionId, path });
          return response.file;
        }),
        queryFile: {
          fileName: artifact.fileName,
          filePath: artifact.path,
          fileType: artifact.fileName.split('.').pop()?.toLowerCase(),
          length: artifact.fileSize,
          contentType: artifact.contentType,
        },
      }));
  }, [artifacts, message, resolvedSessionId]);

  if (!files.length) return null;

  return (
    <div className="ub ub-wrap full-width gap8">
      {files.map((fileItem) => (
        <FileRender fileItem={fileItem} key={fileItem.uid} message={message} />
      ))}
    </div>
  );
}

export default ReplyFileArtifacts;
