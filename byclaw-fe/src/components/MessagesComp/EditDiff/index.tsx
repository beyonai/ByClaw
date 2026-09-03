import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DownOutlined,
  LoadingOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { message, Tooltip } from 'antd';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';

import { createDiffDisplayItems, createLineDiff } from '@/components/MessagesComp/FileChanges/diff';
import { copyTextToClipboard } from '@/utils/copy';
import toolStyles from '@/components/MessagesComp/ToolCall/index.module.less';

import styles from './index.module.less';

type EditDiffFile = {
  path: string;
  absolutePath?: string;
  oldPath?: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldText?: string | null;
  newText?: string | null;
  additions: number;
  deletions: number;
  binary?: boolean;
};

export type EditDiffPayload = {
  type: 'edit_diff';
  schemaVersion: 1;
  eventId: string;
  phase: 'running' | 'applied' | 'failed';
  operation: 'edit' | 'write' | 'git';
  sessionId: string;
  files: EditDiffFile[];
  error?: string;
};

const isEditDiffFile = (value: unknown): value is EditDiffFile => {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<EditDiffFile>;
  return (
    typeof file.path === 'string' &&
    (file.absolutePath === undefined || typeof file.absolutePath === 'string') &&
    ['added', 'modified', 'deleted', 'renamed'].includes(`${file.changeType}`) &&
    Number.isFinite(file.additions) &&
    Number.isFinite(file.deletions)
  );
};

export const parseEditDiff = (value: unknown): EditDiffPayload | null => {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const payload = candidate as Partial<EditDiffPayload>;
  if (
    payload.type !== 'edit_diff' ||
    payload.schemaVersion !== 1 ||
    !['running', 'applied', 'failed'].includes(`${payload.phase}`) ||
    !['edit', 'write', 'git'].includes(`${payload.operation}`) ||
    !Array.isArray(payload.files)
  )
    return null;
  const files = payload.files.filter(isEditDiffFile);
  return files.length === 0 ? null : ({ ...payload, files } as EditDiffPayload);
};

const operationTitle = (operation: EditDiffPayload['operation']) =>
  operation === 'write' ? 'Write' : operation === 'git' ? 'Git' : 'Edit';

function EditDiff({ messageListItemContent }: { messageListItemContent?: { substance?: EditDiffPayload | string } }) {
  const intl = useIntl();
  const payload = useMemo(() => parseEditDiff(messageListItemContent?.substance), [messageListItemContent?.substance]);
  const [expanded, setExpanded] = useState(true);
  const [copiedPath, setCopiedPath] = useState<string>();
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (payload?.phase === 'running') setExpanded(true);
  }, [payload?.phase]);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
    },
    []
  );

  if (!payload) return null;

  const title = operationTitle(payload.operation);
  const primaryPath = payload.files[0].path;
  const fileCountSuffix = payload.files.length > 1 ? ` +${payload.files.length - 1}` : '';
  const toggleLabel = `${expanded ? '收起' : '展开'} ${title} ${primaryPath}`;

  const copyPath = (path: string) => {
    copyTextToClipboard(
      path,
      () => {
        setCopiedPath(path);
        message.success(intl.formatMessage({ id: 'common.copySuccess' }));
        if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
        copyFeedbackTimer.current = setTimeout(() => setCopiedPath(undefined), 1600);
      },
      () => message.error(intl.formatMessage({ id: 'common.copyFail' }))
    );
  };

  return (
    <section
      className={classnames(toolStyles.toolCall, styles.diffToolCall, {
        [toolStyles.doneCall]: payload.phase === 'applied',
        [toolStyles.errorCall]: payload.phase === 'failed',
      })}
      aria-label={intl.formatMessage({ id: 'editDiff.title' })}
    >
      <button
        type="button"
        className={classnames(toolStyles.header, styles.toolHeader, 'ub ub-ac pointer')}
        aria-label={toggleLabel}
        onClick={() => setExpanded(!expanded)}
      >
        {payload.phase === 'running' && <LoadingOutlined className={toolStyles.statusIcon} />}
        {payload.phase === 'applied' && (
          <CheckOutlined className={classnames(toolStyles.statusIcon, toolStyles.done)} />
        )}
        {payload.phase === 'failed' && (
          <CloseOutlined className={classnames(toolStyles.statusIcon, toolStyles.error)} />
        )}
        <span className={toolStyles.toolIdentity}>{title}</span>
        <span className={classnames(toolStyles.description, styles.relativePath)}>{primaryPath}</span>
        {fileCountSuffix && <span className={styles.fileCountSuffix}>{fileCountSuffix}</span>}
        <span className={toolStyles.collapseIcon}>{expanded ? <DownOutlined /> : <RightOutlined />}</span>
      </button>

      {expanded && (
        <div className={classnames(toolStyles.detail, styles.details)}>
          {payload.error && <div className={styles.error}>{payload.error}</div>}
          {payload.files.map((file) => {
            const displayPath = file.absolutePath || file.path;
            const copied = copiedPath === displayPath;
            const items = file.binary
              ? []
              : createDiffDisplayItems(createLineDiff(file.oldText ?? null, file.newText ?? null));

            return (
              <React.Fragment key={`${file.oldPath || ''}:${file.path}`}>
                <article className={styles.filePanel}>
                  <div className={styles.pathRow}>
                    <code>{displayPath}</code>
                    <Tooltip title={intl.formatMessage({ id: copied ? 'common.copySuccess' : 'common.copy' })}>
                      <button
                        type="button"
                        className={classnames(styles.copyButton, { [styles.copyButtonDone]: copied })}
                        aria-label={intl.formatMessage({ id: 'common.copy' })}
                        onClick={() => copyPath(displayPath)}
                      >
                        {copied ? <CheckOutlined /> : <CopyOutlined />}
                      </button>
                    </Tooltip>
                  </div>

                  {file.binary ? (
                    <div className={styles.binary}>{intl.formatMessage({ id: 'editDiff.binary' })}</div>
                  ) : (
                    <div className={styles.diffBody}>
                      {items.map((item) => {
                        if (item.type === 'collapsed')
                          return (
                            <div className={styles.collapsed} key={`${item.startIndex}:${item.endIndex}`}>
                              ···
                            </div>
                          );
                        const { line } = item;
                        return (
                          <div className={classnames(styles.line, styles[line.kind])} key={item.index}>
                            <span>{line.originalLineNumber ?? ''}</span>
                            <span>{line.modifiedLineNumber ?? ''}</span>
                            <code>{line.text || ' '}</code>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <footer className={styles.stats}>
                    +{file.additions} −{file.deletions} · 1 file
                  </footer>
                </article>
                <button type="button" className={styles.inspectButton} disabled>
                  <CodeOutlined /> Inspect
                </button>
              </React.Fragment>
            );
          })}
          <button type="button" className={toolStyles.collapseButton} onClick={() => setExpanded(false)}>
            {intl.formatMessage({ id: 'toolCall.collapse' })}
            <DownOutlined className={toolStyles.collapseButtonIcon} />
          </button>
        </div>
      )}
    </section>
  );
}

export default EditDiff;
