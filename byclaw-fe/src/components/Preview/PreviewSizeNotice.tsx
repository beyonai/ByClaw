import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { useIntl } from '@umijs/max';

import { downloadFile } from '@/utils/file';

import { BYTES_PER_MB } from './previewSize';

interface PreviewSizeNoticeProps {
  data: Blob;
  limit: number;
  title?: string;
}

export default function PreviewSizeNotice({ data, limit, title }: PreviewSizeNoticeProps) {
  const intl = useIntl();
  return (
    <Alert
      type="warning"
      showIcon
      message={intl.formatMessage({ id: 'preview.tooLarge' }, { size: limit / BYTES_PER_MB })}
      action={(
        <Button
          icon={<DownloadOutlined />}
          onClick={() => downloadFile({
            file: data,
            fileName: title || intl.formatMessage({ id: 'common.file' }),
          })}
        >
          {intl.formatMessage({ id: 'common.download' })}
        </Button>
      )}
    />
  );
}
