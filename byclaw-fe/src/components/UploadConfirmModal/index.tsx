import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Space, Switch, Typography } from 'antd';
import { useIntl } from '@umijs/max';

export interface UploadConfirmFile {
  name: string;
  size?: number;
}

interface UploadConfirmModalProps {
  open: boolean;
  files: UploadConfirmFile[];
  directoryPath: string;
  conflicts?: string[];
  loading?: boolean;
  showProcessFrontMatter?: boolean;
  okText?: string;
  directoryActionText?: string;
  onDirectoryAction?: () => void;
  onOk: (processFrontMatter: boolean) => void;
  onCancel: () => void;
}

function formatFileSize(size?: number) {
  if (size === undefined) return '';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

const UploadConfirmModal: React.FC<UploadConfirmModalProps> = ({
  open,
  files,
  directoryPath,
  conflicts = [],
  loading = false,
  showProcessFrontMatter = false,
  okText,
  directoryActionText,
  onDirectoryAction,
  onOk,
  onCancel,
}) => {
  const intl = useIntl();
  const [processFrontMatter, setProcessFrontMatter] = useState(false);
  const previewFiles = useMemo(() => files.slice(0, 3), [files]);
  const remainingFileCount = files.length - previewFiles.length;
  const hasConflicts = conflicts.length > 0;

  useEffect(() => {
    if (open) {
      setProcessFrontMatter(false);
    }
  }, [open]);

  return (
    <Modal
      title={intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmTitle' })}
      open={open}
      okText={
        okText ||
        intl.formatMessage({
          id: hasConflicts ? 'knowledgeDetail.confirmOverwriteUpload' : 'knowledgeDetail.uploadFile',
        })
      }
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={loading}
      onOk={() => onOk(processFrontMatter)}
      onCancel={onCancel}
      destroyOnClose
      width="50vw"
      style={{ minWidth: 640, maxWidth: 960 }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space
          direction="vertical"
          size={12}
          style={{
            width: '100%',
            padding: 16,
            border: '1px solid #f0f0f0',
            borderRadius: 10,
            background: '#fafafa',
          }}
        >
          <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.uploadInfo' })}</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '86px minmax(0, 1fr)', rowGap: 8, columnGap: 12 }}>
            <Typography.Text type="secondary">
              {intl.formatMessage({ id: 'knowledgeDetail.uploadDirectory' })}
            </Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Typography.Text ellipsis style={{ flex: 1, maxWidth: '100%' }}>
                {directoryPath || '/'}
              </Typography.Text>
              {onDirectoryAction && (
                <Button size="small" onClick={onDirectoryAction} disabled={loading}>
                  {directoryActionText || intl.formatMessage({ id: 'fileBrowser.upload.changeDirectory' })}
                </Button>
              )}
            </div>
            <Typography.Text type="secondary">
              {intl.formatMessage({ id: 'knowledgeDetail.selectedFiles' })}
            </Typography.Text>
            <Typography.Text>
              {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmFiles' }, { count: files.length })}
            </Typography.Text>
          </div>

          <div style={{ width: '100%', padding: 12, borderRadius: 10, background: '#fff' }}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.fileList' })}</Typography.Text>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {previewFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size || 0}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: '#f7f8fa',
                    }}
                  >
                    <Typography.Text ellipsis style={{ flex: 1, maxWidth: '100%' }}>
                      {file.name}
                    </Typography.Text>
                    {file.size !== undefined && (
                      <Typography.Text type="secondary" style={{ flex: 'none', fontSize: 12 }}>
                        {formatFileSize(file.size)}
                      </Typography.Text>
                    )}
                  </div>
                ))}
              </Space>
              {remainingFileCount > 0 && (
                <Typography.Text type="secondary">
                  {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmMoreFiles' }, { count: remainingFileCount })}
                </Typography.Text>
              )}
            </Space>
          </div>
        </Space>

        {hasConflicts && (
          <Alert
            showIcon
            type="warning"
            message={intl.formatMessage({ id: 'knowledgeDetail.overwriteWarningTitle' })}
            description={
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  {intl.formatMessage({ id: 'knowledgeDetail.overwriteWarningDesc' })}
                </Typography.Text>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  {conflicts.map((filePath) => (
                    <Typography.Text key={filePath} ellipsis style={{ maxWidth: '100%' }}>
                      {filePath}
                    </Typography.Text>
                  ))}
                </Space>
              </Space>
            }
          />
        )}

        {showProcessFrontMatter && (
          <Space
            direction="vertical"
            size={10}
            style={{ width: '100%', padding: 14, border: '1px solid #f0f0f0', borderRadius: 10 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Space direction="vertical" size={2}>
                <Typography.Text strong>
                  {intl.formatMessage({ id: 'knowledgeDetail.processFrontMatter' })}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {intl.formatMessage({ id: 'knowledgeDetail.processFrontMatterTip' })}
                </Typography.Text>
              </Space>
              <Switch checked={processFrontMatter} onChange={setProcessFrontMatter} />
            </div>
            <Alert
              showIcon
              type={processFrontMatter ? 'warning' : 'info'}
              message={intl.formatMessage({
                id: processFrontMatter
                  ? 'knowledgeDetail.processFrontMatterWarning'
                  : 'knowledgeDetail.processFrontMatterDefaultTip',
              })}
            />
          </Space>
        )}
      </Space>
    </Modal>
  );
};

export default UploadConfirmModal;
