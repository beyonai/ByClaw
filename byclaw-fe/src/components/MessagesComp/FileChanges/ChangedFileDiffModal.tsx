import React, { useEffect, useMemo, useState } from 'react';
import { ColumnHeightOutlined } from '@ant-design/icons';
import { Empty, Modal, Select, Spin } from 'antd';
import { useIntl } from '@umijs/max';

import FilePreviewPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel';
import { getChangedFileDiff } from '@/service/fileBrowser';
import type { ChangedFileDiff } from '@/service/fileBrowser';

import type { DiffLine } from './diff';
import { createDiffDisplayItems, createLineDiff } from './diff';
import styles from './index.module.less';

type Props = {
  open: boolean;
  sessionId: string;
  uuid: string;
  path: string;
  files?: Array<{ uuid: string; path: string }>;
  onClose: () => void;
  onFileChange?: (uuid: string) => void;
};

const getFileName = (path: string) => path.replace(/\\/g, '/').split('/').pop() || path;

export default function ChangedFileDiffModal({
  open,
  sessionId,
  uuid,
  path,
  files = [{ uuid, path }],
  onClose,
  onFileChange,
}: Props) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [diff, setDiff] = useState<ChangedFileDiff | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const lines = useMemo(() => createLineDiff(diff?.originalContent ?? null, diff?.modifiedContent ?? null), [diff]);
  const displayItems = useMemo(() => createDiffDisplayItems(lines), [lines]);
  const hasTextDiff = lines.some((line) => line.kind === 'addition' || line.kind === 'deletion');

  useEffect(() => {
    if (!open || !sessionId || !uuid) return undefined;

    let active = true;
    setLoading(true);
    setError(false);
    setDiff(null);
    setExpandedSections(new Set());
    getChangedFileDiff(sessionId, uuid)
      .then((result) => {
        if (active) setDiff(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, sessionId, uuid]);

  const fileName = getFileName(diff?.filePath || path);
  const binaryContent = diff?.modifiedContent ?? diff?.originalContent ?? null;

  const renderDiffLine = (line: DiffLine, key: React.Key) => (
    <div className={`${styles.diffLine} ${styles[line.kind]}`} key={key}>
      <span className={styles.lineNumber}>{line.originalLineNumber ?? ''}</span>
      <span className={styles.lineNumber}>{line.modifiedLineNumber ?? ''}</span>
      <span className={styles.lineMarker}>{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '}</span>
      <code>{line.text || ' '}</code>
    </div>
  );

  return (
    <Modal
      className={styles.diffModal}
      footer={null}
      open={open}
      title={
        <div className={styles.modalTitle}>
          <Select
            className={styles.fileSelect}
            value={uuid}
            options={files.map((file) => ({ label: file.path, value: file.uuid }))}
            optionFilterProp="label"
            popupMatchSelectWidth={false}
            showSearch
            onChange={onFileChange}
          />
          <span className={styles.modalPath}>{diff?.filePath || path}</span>
        </div>
      }
      width={960}
      onCancel={onClose}
      destroyOnHidden
    >
      {loading ? (
        <div className={styles.modalState}>
          <Spin />
        </div>
      ) : error || !diff ? (
        <Empty className={styles.modalState} description={intl.formatMessage({ id: 'fileChanges.diffLoadFailed' })} />
      ) : !diff.changed ? (
        <Empty className={styles.modalState} description={intl.formatMessage({ id: 'fileChanges.noDiff' })} />
      ) : diff.binary ? (
        <div className={styles.binaryPreview}>
          <FilePreviewPanel fileName={fileName} content={{ data: binaryContent, binary: true }} />
        </div>
      ) : !hasTextDiff ? (
        <Empty className={styles.modalState} description={intl.formatMessage({ id: 'fileChanges.noDiff' })} />
      ) : (
        <div className={styles.diffBody}>
          {displayItems.map((item) => {
            if (item.type === 'line') return renderDiffLine(item.line, `line:${item.index}`);

            const sectionKey = `${item.startIndex}:${item.endIndex}`;
            if (expandedSections.has(sectionKey)) {
              return item.lines.map((line, index) => renderDiffLine(line, `expanded:${item.startIndex + index}`));
            }
            return (
              <button
                className={styles.collapsedSection}
                key={`collapsed:${sectionKey}`}
                type="button"
                onClick={() => {
                  setExpandedSections((current) => new Set(current).add(sectionKey));
                }}
              >
                <ColumnHeightOutlined aria-hidden="true" />
                {intl.formatMessage({ id: 'fileChanges.expandUnchanged' }, { count: item.lines.length })}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
