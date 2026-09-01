import React, { useMemo, useState } from 'react';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import AntdIcon from '@/components/AntdIcon';
import { useIntl } from '@umijs/max';

import ChangedFileDiffModal from './ChangedFileDiffModal';
import styles from './index.module.less';

const DEFAULT_VISIBLE_FILE_COUNT = 3;

type FileChangeType = 'added' | 'modified' | 'deleted';

type FileChange = {
  uuid: string;
  path: string;
  changeType: FileChangeType;
  binary?: boolean;
  additions: number;
  deletions: number;
  beforeSize?: number;
  afterSize?: number;
  sources?: string[];
};

type FileChangesPayload = {
  type: 'file_changes';
  version: number;
  sessionId: string;
  summary: {
    total: number;
    added: number;
    modified: number;
    deleted: number;
  };
  files: FileChange[];
};

type Props = {
  messageListItemContent?: {
    substance?: FileChangesPayload | string;
  };
};

const isFileChange = (value: unknown): value is FileChange => {
  if (!value || typeof value !== 'object') return false;

  const file = value as Partial<FileChange>;
  return (
    typeof file.uuid === 'string' &&
    typeof file.path === 'string' &&
    ['added', 'modified', 'deleted'].includes(`${file.changeType}`) &&
    typeof file.additions === 'number' &&
    Number.isFinite(file.additions) &&
    typeof file.deletions === 'number' &&
    Number.isFinite(file.deletions)
  );
};

export const parseFileChanges = (value: unknown): FileChangesPayload | null => {
  // 流式消息传入 JSON 字符串，历史消息回放时也可能已经反序列化为对象。
  let payload = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== 'object') return null;

  const candidate = payload as Partial<FileChangesPayload>;
  if (candidate.type !== 'file_changes' || !Array.isArray(candidate.files)) return null;

  const files = candidate.files.filter(isFileChange);
  if (!files.length) return null;

  return {
    ...candidate,
    version: candidate.version ?? 2,
    sessionId: candidate.sessionId ?? '',
    summary: candidate.summary ?? {
      total: files.length,
      added: files.filter((file) => file.changeType === 'added').length,
      modified: files.filter((file) => file.changeType === 'modified').length,
      deleted: files.filter((file) => file.changeType === 'deleted').length,
    },
    files,
  } as FileChangesPayload;
};

export const getDisplayPath = (path: string, sessionId: string) => {
  if (!sessionId) return path;

  // 会话工作区的绝对路径对用户没有意义，卡片只展示其中的项目相对路径。
  const sessionPathMarker = `/.sessions/${sessionId}/`;
  const markerIndex = path.indexOf(sessionPathMarker);
  return markerIndex < 0 ? path : path.slice(markerIndex + sessionPathMarker.length);
};

export default function FileChanges({ messageListItemContent }: Props) {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const payload = useMemo(
    () => parseFileChanges(messageListItemContent?.substance),
    [messageListItemContent?.substance]
  );

  if (!payload) return null;

  const total = payload.files.length;
  const additions = payload.files.reduce((sum, file) => sum + Math.max(0, file.additions), 0);
  const deletions = payload.files.reduce((sum, file) => sum + Math.max(0, file.deletions), 0);
  const hasMore = total > DEFAULT_VISIBLE_FILE_COUNT;
  const visibleFiles = expanded ? payload.files : payload.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT);
  const remaining = total - DEFAULT_VISIBLE_FILE_COUNT;
  // 变更详情以 uuid 定位存储对象；缺少有效 uuid 的条目无法请求详情。
  const previewableFiles = payload.files.filter((file) => file.uuid.trim());

  return (
    <section className={styles.card} aria-label={intl.formatMessage({ id: 'fileChanges.ariaLabel' })}>
      <header className={styles.header}>
        <span className={styles.iconBox} aria-hidden="true">
          <AntdIcon type="icon-a-PlusMinus" />
        </span>
        <div className={styles.summary}>
          <div className={styles.title}>{intl.formatMessage({ id: 'fileChanges.title' }, { count: total })}</div>
          <div className={styles.totals}>
            <span className={styles.additions}>+{additions}</span>
            <span className={styles.deletions}>-{deletions}</span>
          </div>
        </div>
      </header>

      <div className={styles.fileList}>
        {visibleFiles.map((file) => (
          <button className={styles.fileRow} key={file.uuid} type="button" onClick={() => setSelectedFile(file)}>
            <span className={styles.path} title={file.path}>
              {getDisplayPath(file.path, payload.sessionId)}
            </span>
            <span className={styles.fileStats}>
              {file.additions > 0 && <span className={styles.additions}>+{file.additions}</span>}
              {file.deletions > 0 && <span className={styles.deletions}>-{file.deletions}</span>}
            </span>
          </button>
        ))}

        {hasMore && (
          <button className={styles.expandButton} type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded
              ? intl.formatMessage({ id: 'fileChanges.collapse' })
              : intl.formatMessage({ id: 'fileChanges.showMore' }, { count: remaining })}
            {expanded ? <UpOutlined /> : <DownOutlined />}
          </button>
        )}
      </div>
      {selectedFile && (
        <ChangedFileDiffModal
          open
          path={getDisplayPath(selectedFile.path, payload.sessionId)}
          sessionId={payload.sessionId}
          uuid={selectedFile.uuid}
          files={previewableFiles.map((file) => ({
            uuid: file.uuid,
            path: getDisplayPath(file.path, payload.sessionId),
          }))}
          onClose={() => setSelectedFile(null)}
          onFileChange={(uuid) => {
            const file = previewableFiles.find((item) => item.uuid === uuid);
            if (file) setSelectedFile(file);
          }}
        />
      )}
    </section>
  );
}
