import { useEffect, useState } from 'react';
import { Alert, Button, message, Modal, Space, Switch, Tooltip, Typography } from 'antd';

// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import { checkUploadFileConflicts, uploadFiles } from '@/service/knowledgeCenter';
import { useFileTookit } from '@/hooks/useFileTookit';

interface IProps {
  baseInfo: any;
  uploadLoading: boolean;
  setUploadLoading: (loading: boolean) => void;
  reload?: () => void;

  /** 上传到知识库时的目标目录路径，根目录为 "/" */
  directoryPath: string;
}

const UploadFile = (props: IProps) => {
  const { baseInfo, uploadLoading, setUploadLoading, reload, directoryPath } = props;

  const { pick, message: uploadMessage } = useFileTookit();

  const intl = useIntl();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadConflicts, setUploadConflicts] = useState<string[]>([]);
  const [conflictChecking, setConflictChecking] = useState(false);
  const [processFrontMatter, setProcessFrontMatter] = useState(false);
  const uploadDirectory = directoryPath || '/';
  const previewFiles = pendingFiles.slice(0, 3);
  const remainingFileCount = pendingFiles.length - previewFiles.length;
  const hasUploadConflicts = uploadConflicts.length > 0;

  const formatFileSize = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  };

  const handlePick = async () => {
    const files = await pick({
      accept: '.doc, .docx, .xls, .xlsx, .pdf, .txt, .ppt, .pptx, .csv, .md',
      count: 10, // 最多选择10个文件
      multiple: true,
      totalSize: 1024 * 1024 * 200, // 总共不能超过200MB
    });
    if (!files) return;

    try {
      setConflictChecking(true);
      const conflictResult = await checkUploadFileConflicts({
        resourceId: baseInfo?.resourceId,
        directoryPath: uploadDirectory,
        fileNames: files.map((file) => file.name),
      });
      setPendingFiles(files);
      setUploadConflicts(conflictResult?.overwritePaths || []);
      setProcessFrontMatter(false);
      setConfirmOpen(true);
    } catch (err) {
      message.error(err as string);
    } finally {
      setConflictChecking(false);
    }
  };

  const handleUpload = async () => {
    if (!pendingFiles.length) return;

    const formData = new FormData();
    pendingFiles.forEach((file) => {
      formData.append('files', file);
    });
    formData.append('resourceId', baseInfo?.resourceId);
    formData.append('directoryPath', uploadDirectory);
    // 当前交互需要将开关值取反后传给后端：开关打开时传 false，关闭时传 true。
    formData.append('processFrontMatter', String(!processFrontMatter));
    // QA import 暂不支持原子覆盖，后端收到 true 后会先删同路径同名旧文件再导入新文件。
    formData.append('overwrite', String(hasUploadConflicts));

    try {
      setUploadLoading(true);
      await uploadFiles(formData);
      message.success(intl.formatMessage({ id: 'knowledgeDetail.uploadSuccess' }));
      setConfirmOpen(false);
      setPendingFiles([]);
      setUploadConflicts([]);
      reload?.();
    } catch (err) {
      message.error(err as string);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleCancel = () => {
    if (uploadLoading) return;
    setConfirmOpen(false);
    setPendingFiles([]);
    setUploadConflicts([]);
  };

  useEffect(() => {
    if (uploadMessage) message.warning(uploadMessage);
  }, [uploadMessage]);

  return (
    <>
      <Tooltip title={intl.formatMessage({ id: 'knowledgeDetail.sameNameFileOverwriteTip' })}>
        <Button
          loading={uploadLoading || conflictChecking}
          type="primary"
          onClick={handlePick}
          icon={<AntdIcon type="icon-a-Uploadshangchuan" style={{ fontSize: 18 }} />}
        >
          {intl.formatMessage({
            id: 'knowledgeDetail.uploadFile',
          })}
        </Button>
      </Tooltip>
      <Modal
        title={intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmTitle' })}
        open={confirmOpen}
        okText={intl.formatMessage({
          id: hasUploadConflicts ? 'knowledgeDetail.confirmOverwriteUpload' : 'knowledgeDetail.uploadFile',
        })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={uploadLoading}
        onOk={handleUpload}
        onCancel={handleCancel}
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
              <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
                {uploadDirectory}
              </Typography.Text>
              <Typography.Text type="secondary">
                {intl.formatMessage({ id: 'knowledgeDetail.selectedFiles' })}
              </Typography.Text>
              <Typography.Text>
                {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmFiles' }, { count: pendingFiles.length })}
              </Typography.Text>
            </div>

            <div style={{ width: '100%', padding: 12, borderRadius: 10, background: '#fff' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.fileList' })}</Typography.Text>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {previewFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}`}
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
                      <Typography.Text type="secondary" style={{ flex: 'none', fontSize: 12 }}>
                        {formatFileSize(file.size)}
                      </Typography.Text>
                    </div>
                  ))}
                </Space>
                {remainingFileCount > 0 && (
                  <Typography.Text type="secondary">
                    {intl.formatMessage(
                      { id: 'knowledgeDetail.uploadConfirmMoreFiles' },
                      { count: remainingFileCount }
                    )}
                  </Typography.Text>
                )}
              </Space>
            </div>
          </Space>

          {hasUploadConflicts && (
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
                    {uploadConflicts.map((filePath) => (
                      <Typography.Text key={filePath} ellipsis style={{ maxWidth: '100%' }}>
                        {filePath}
                      </Typography.Text>
                    ))}
                  </Space>
                </Space>
              }
            />
          )}
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
        </Space>
      </Modal>
    </>
  );
};

export default UploadFile;
