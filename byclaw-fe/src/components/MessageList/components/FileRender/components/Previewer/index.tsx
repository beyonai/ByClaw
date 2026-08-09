import React from 'react';
import { Modal, Spin } from 'antd';

import AntdIcon from '@/components/AntdIcon';
import styles from './index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

function Previewer(props: {
  previewInfo: {
    open: boolean;
    blob: Blob | null;
    loading: boolean;
  };
  onClosePreviewModal: () => void;
  fileType: string;
  fileName: string;
  // 调用方本身在弹窗里时才需要传:预览是顶层兄弟节点,拿不到父弹窗的 zIndex 上下文,不抬高会被压在下面。
  zIndex?: number;
}) {
  const { previewInfo, onClosePreviewModal, fileType, fileName, zIndex } = props;
  return (
    <Modal
      centered
      destroyOnHidden
      open={previewInfo.open}
      title=""
      width="90vw"
      zIndex={zIndex}
      onCancel={onClosePreviewModal}
      footer={null}
      closable={false}
      styles={{
        content: {
          padding: 0,
          height: '90vh',
        },
        body: {
          padding: 0,
          height: '100%',
        },
      }}
    >
      <Spin spinning={previewInfo.loading} wrapperClassName="full-height-spin">
        {previewInfo.blob && (
          <React.Suspense fallback={null}>
            <PreViewFile
              data={previewInfo.blob}
              type={fileType}
              title={fileName}
              className={styles.preview}
              extra={
                <span className={styles.icon}>
                  <AntdIcon type="icon-a-Closeguanbi1" onClick={onClosePreviewModal} />
                </span>
              }
            />
          </React.Suspense>
        )}
      </Spin>
    </Modal>
  );
}

export default Previewer;
