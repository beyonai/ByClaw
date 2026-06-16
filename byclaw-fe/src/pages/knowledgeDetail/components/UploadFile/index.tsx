import { useEffect, useState } from 'react';
import { Alert, Button, message, Modal, Space, Switch, Tooltip, Typography } from 'antd';

// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import { uploadFiles } from '@/service/knowledgeCenter';
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
  const [processFrontMatter, setProcessFrontMatter] = useState(false);
  const uploadDirectory = directoryPath || '/';
  const previewFiles = pendingFiles.slice(0, 3);
  const remainingFileCount = pendingFiles.length - previewFiles.length;

  const handlePick = async () => {
    const files = await pick({
      accept: '.doc, .docx, .xls, .xlsx, .pdf, .txt, .ppt, .pptx, .csv, .md',
      count: 10, // 最多选择10个文件
      multiple: true,
      totalSize: 1024 * 1024 * 200, // 总共不能超过200MB
    });
    if (!files) return;

    setPendingFiles(files);
    setProcessFrontMatter(false);
    setConfirmOpen(true);
  };

  const handleUpload = async () => {
    if (!pendingFiles.length) return;

    const formData = new FormData();
    pendingFiles.forEach((file) => {
      formData.append('files', file);
    });
    formData.append('resourceId', baseInfo?.resourceId);
    formData.append('directoryPath', uploadDirectory);
    // 由用户在上传确认弹窗中决定是否让 QA 解析 Markdown 的 YAML front matter。
    formData.append('processFrontMatter', String(processFrontMatter));

    try {
      setUploadLoading(true);
      await uploadFiles(formData);
      message.success(intl.formatMessage({ id: 'knowledgeDetail.uploadSuccess' }));
      setConfirmOpen(false);
      setPendingFiles([]);
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
  };

  useEffect(() => {
    if (uploadMessage) message.warning(uploadMessage);
  }, [uploadMessage]);

  return (
    <>
      <Tooltip title={intl.formatMessage({ id: 'knowledgeDetail.sameNameFileOverwriteTip' })}>
        <Button
          loading={uploadLoading}
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
        okText={intl.formatMessage({ id: 'knowledgeDetail.uploadFile' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={uploadLoading}
        onOk={handleUpload}
        onCancel={handleCancel}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Typography.Text strong>
              {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmFiles' }, { count: pendingFiles.length })}
            </Typography.Text>
            <Typography.Text type="secondary">
              {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmDirectory' }, { directoryPath: uploadDirectory })}
            </Typography.Text>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {previewFiles.map((file) => (
                <Typography.Text key={`${file.name}-${file.size}`} ellipsis style={{ maxWidth: '100%' }}>
                  {file.name}
                </Typography.Text>
              ))}
              {remainingFileCount > 0 && (
                <Typography.Text type="secondary">
                  {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmMoreFiles' }, { count: remainingFileCount })}
                </Typography.Text>
              )}
            </Space>
          </Space>
          <Space align="center">
            <Switch checked={processFrontMatter} onChange={setProcessFrontMatter} />
            <Typography.Text>{intl.formatMessage({ id: 'knowledgeDetail.processFrontMatter' })}</Typography.Text>
          </Space>
          <Alert
            showIcon
            type={processFrontMatter ? 'warning' : 'info'}
            message={intl.formatMessage({
              id: processFrontMatter
                ? 'knowledgeDetail.processFrontMatterWarning'
                : 'knowledgeDetail.processFrontMatterDefaultTip',
            })}
            description={intl.formatMessage({ id: 'knowledgeDetail.processFrontMatterTip' })}
          />
        </Space>
      </Modal>
    </>
  );
};

export default UploadFile;
