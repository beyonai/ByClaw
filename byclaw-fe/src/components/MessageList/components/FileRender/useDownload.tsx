import React, { useCallback } from 'react';
import { downloadMinIOFile } from '@/service/file';
import { downloadFile } from '@/utils/file';
import { message as AntdMessage } from 'antd';
import { useIntl } from '@umijs/max';

const useDownload = () => {
  const intl = useIntl();

  const [downloading, setDownloading] = React.useState(false);

  const handleDownload = useCallback(
    async (fileId: string | number) => {
      setDownloading(true);
      try {
        const res = await downloadMinIOFile({ fileId });
        downloadFile(res);
      } catch (error) {
        console.error(error);
        AntdMessage.error(intl.formatMessage({ id: 'common.downloadFailed' }));
      } finally {
        setDownloading(false);
      }
    },
    [intl]
  );

  return {
    downloading,
    handleDownload,
    downloadFile,
  };
};

export default useDownload;
