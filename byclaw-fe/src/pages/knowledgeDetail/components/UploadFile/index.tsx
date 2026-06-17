import { useEffect, useState } from 'react';
import { Button, message, Tooltip } from 'antd';

// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import UploadConfirmModal from '@/components/UploadConfirmModal';
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
  const uploadDirectory = directoryPath || '/';
  const hasUploadConflicts = uploadConflicts.length > 0;

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
      setConfirmOpen(true);
    } catch (err) {
      message.error(err as string);
    } finally {
      setConflictChecking(false);
    }
  };

  const handleUpload = async (processFrontMatter: boolean) => {
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
      <UploadConfirmModal
        open={confirmOpen}
        files={pendingFiles}
        directoryPath={uploadDirectory}
        conflicts={uploadConflicts}
        loading={uploadLoading}
        showProcessFrontMatter
        okText={intl.formatMessage({
          id: hasUploadConflicts ? 'knowledgeDetail.confirmOverwriteUpload' : 'knowledgeDetail.uploadFile',
        })}
        onOk={handleUpload}
        onCancel={handleCancel}
      />
    </>
  );
};

export default UploadFile;
