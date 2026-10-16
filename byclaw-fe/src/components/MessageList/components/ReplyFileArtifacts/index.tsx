import ImageArtifactGallery from '../ImageArtifactGallery';
import { structuredImagePaths } from '@/utils/imageArtifacts';
import React, { useEffect, useMemo, useState } from 'react';

import VoiceMessage from '../VoiceMessage';
import FileRender from '@/components/MessageList/components/FileRender';
import { createRelativePathResourceResolver } from '@/components/MessageList/components/FileRender/components/Previewer/relativeResource';
import getDisplayAnswer from '@/components/QueryInput/getDisplayAnswer';
import { ChatFileArtifact, downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
import { transcribeVoice } from '@/service/voice';
import { IMessageState } from '@/constants/message';
import type { IFile } from '@/typescript/file';
import type { IMessage } from '@/typescript/message';
import { extractChatFileArtifactPaths, normalizeChatFileArtifactPath } from '@/utils/chatFileArtifact';

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

function ReplyFileArtifacts({
  message,
  sessionId,
  previewInDetailPanel = false,
}: {
  message: IMessage;
  sessionId?: string;
  previewInDetailPanel?: boolean;
}) {
  const [artifacts, setArtifacts] = useState<ChatFileArtifact[]>([]);
  const answerText = useMemo(
    () => [message.text, message.finalContent, getDisplayAnswer(message.messageList)].filter(Boolean).join('\n'),
    [message.finalContent, message.messageList, message.text, message.updateKey]
  );
  const resolvedSessionId = message.sessionId || sessionId;
  const paths = useMemo(() => {
    const extracted = [...structuredImagePaths(message), ...extractChatFileArtifactPaths(answerText)];
    if (!resolvedSessionId) return extracted;
    return Array.from(new Set(extracted.map((path) => normalizeChatFileArtifactPath(path, resolvedSessionId))));
  }, [answerText, resolvedSessionId, message.messageList, message.thinkList, message.updateKey]);
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
  const audioFiles = files.filter((file) => /\.(mp3|wav|m4a|ogg)$/i.test(file.queryFile?.fileName || ''));
  const imageArtifacts = artifacts.filter((artifact) => /\.(png|jpe?g|webp)$/i.test(artifact.fileName));
  const regularFiles = files.filter(
    (file) => !audioFiles.includes(file) && !/\.(png|jpe?g|webp)$/i.test(file.queryFile?.fileName || '')
  );

  return (
    <>
      {imageArtifacts.length > 0 && resolvedSessionId && (
        <div data-testid="reply-artifact-files">
          <ImageArtifactGallery artifacts={imageArtifacts} sessionId={resolvedSessionId} />
        </div>
      )}
      {regularFiles.length > 0 && (
        <div className="ub ub-wrap full-width gap8" data-testid="reply-artifact-files">
          {regularFiles.map((fileItem) => (
            <FileRender
              fileItem={fileItem}
              key={fileItem.uid}
              message={message}
              previewInDetailPanel={previewInDetailPanel}
            />
          ))}
        </div>
      )}
      {audioFiles.length > 0 && (
        <div className="ub ub-ver full-width gap8" data-testid="speech-summary-footer">
          {audioFiles.map((fileItem) => (
            <VoiceMessage
              key={fileItem.uid}
              voice={{
                fileName: fileItem.queryFile?.fileName || 'summary.mp3',
                durationMs: 0,
                mimeType: fileItem.queryFile?.contentType || 'audio/mpeg',
              }}
              label="语音摘要"
              variant="assistant"
              loadAudio={async () => (await fileItem.downloadRequest!()).file}
              transcribeAudio={() =>
                transcribeVoice({ sessionId: resolvedSessionId!, path: fileItem.queryFile!.filePath! })
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

export default ReplyFileArtifacts;
