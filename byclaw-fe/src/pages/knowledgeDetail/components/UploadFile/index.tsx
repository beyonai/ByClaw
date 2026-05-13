import { useEffect } from 'react';
import { Button, message, Tooltip } from 'antd';

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

  const handlePick = async () => {
    const files = await pick({
      accept: '.doc, .docx, .xls, .xlsx, .pdf, .txt, .ppt, .pptx, .csv, .md',
      count: 10, // 最多选择10个文件
      multiple: true,
      totalSize: 1024 * 1024 * 200, // 总共不能超过200MB
    });
    if (!files) return;

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    formData.append('resourceId', baseInfo?.resourceId);
    formData.append('directoryPath', directoryPath || '/');

    try {
      setUploadLoading(true);
      await uploadFiles(formData);
      message.success(intl.formatMessage({ id: 'knowledgeDetail.uploadSuccess' }));
    } catch (err) {
      message.error(err as string);
    } finally {
      setUploadLoading(false);
    }
    reload?.();
  };

  useEffect(() => {
    if (uploadMessage) message.warning(uploadMessage);
  }, [uploadMessage]);

  return (
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
  );
};

export default UploadFile;
