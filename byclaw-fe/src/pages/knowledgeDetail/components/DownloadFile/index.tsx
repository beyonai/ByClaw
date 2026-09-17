import { useRef, useState } from 'react';
import { DownloadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { App, Button, Modal } from 'antd';
import { downloadResourceFile } from '@/service/file';

interface DownloadFileProps {
  resourceId: string | number;
  resourceName?: string;
}

const DownloadFile = ({ resourceId, resourceName }: DownloadFileProps) => {
  const intl = useIntl();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const downloadingRef = useRef(false);

  const handleDownload = async () => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setLoading(true);
    try {
      // 始终从知识库根目录递归打包，不受当前下钻目录、搜索和勾选项影响。
      const res = await downloadResourceFile({ resourceId, directoryPath: '/' });
      if (!(res?.file instanceof Blob)) throw new Error('Invalid knowledge archive response');
      if (res.file.type.includes('json')) {
        const error = JSON.parse(await res.file.text());
        throw new Error(error?.msg || intl.formatMessage({ id: 'knowledgeDetail.downloadFailed' }));
      }
      if (res.file.type.split(';')[0] !== 'application/zip') {
        throw new Error(intl.formatMessage({ id: 'knowledgeDetail.downloadFailed' }));
      }
      const url = window.URL.createObjectURL(res.file);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download =
          res.fileName || `${(resourceName || `knowledge-${resourceId}`).replace(/[\\/:*?"<>|]/g, '_')}.zip`;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      }
      setOpen(false);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : intl.formatMessage({ id: 'knowledgeDetail.downloadFailed' })
      );
    } finally {
      downloadingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <Button icon={<DownloadOutlined />} loading={loading} onClick={() => setOpen(true)}>
        {intl.formatMessage({ id: 'knowledgeDetail.downloadFile' })}
      </Button>
      <Modal
        title={intl.formatMessage({ id: 'knowledgeDetail.downloadConfirmTitle' })}
        open={open}
        onOk={handleDownload}
        onCancel={() => setOpen(false)}
        confirmLoading={loading}
        cancelButtonProps={{ disabled: loading }}
        closable={!loading}
        maskClosable={!loading}
        keyboard={!loading}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
      >
        {intl.formatMessage({ id: 'knowledgeDetail.downloadConfirmContent' })}
        {loading && <p role="status">{intl.formatMessage({ id: 'knowledgeDetail.downloadPreparing' })}</p>}
      </Modal>
    </>
  );
};

export default DownloadFile;
