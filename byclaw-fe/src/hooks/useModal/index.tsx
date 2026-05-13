import { Modal, Typography } from 'antd';
import React, { useState } from 'react';

import BottomDrawer from '@/components/MobileComponents/BottomDrawer';
import useGlobal from '@/hooks/useGlobal';

import styles from './index.module.less';

const { Paragraph } = Typography;

type ModalProps = {
  title?: React.ReactNode;
  content?: React.ReactNode;
  onOk?: () => void;
  footer?: React.ReactNode;
  modalStyle?: React.CSSProperties;
  modalClassName?: string;
};

function useModal(props: ModalProps) {
  const { title = '', content = null, onOk, footer = null, modalStyle, modalClassName = '' } = props || {};

  const { platform } = useGlobal();

  const [open, setOpen] = useState(false);

  const [myTitle, setMyTitle] = useState<React.ReactNode>(title);
  const [myContent, setMyContent] = useState<React.ReactNode>(content);

  let ModalNode = <></>;
  if (platform === 'pc') {
    ModalNode = (
      <Modal
        destroyOnHidden
        centered
        title={
          <Paragraph
            ellipsis={{
              rows: 2,
            }}
            style={{
              fontSize: 'inherit',
            }}
          >
            {myTitle}
          </Paragraph>
        }
        open={open}
        onOk={() => {
          setOpen(false);
          onOk?.();
        }}
        onCancel={() => setOpen(false)}
        footer={footer}
        className={`${styles.modal} ${modalClassName}`}
        style={modalStyle}
      >
        {myContent}
      </Modal>
    );
  }
  if (platform === 'mobile') {
    ModalNode = (
      <BottomDrawer destroyOnHidden title={myTitle} onClose={() => setOpen(false)} open={open} renderButtons={footer}>
        {myContent}
      </BottomDrawer>
    );
  }

  return {
    ModalNode,
    open,
    setOpen,
    setMyContent,
    setMyTitle,
  };
}

export default useModal;
