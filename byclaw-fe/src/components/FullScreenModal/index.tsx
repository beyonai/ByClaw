import { getRandomNumber } from '@/utils/math';
import { Modal } from 'antd';
import classnames from 'classnames';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import useGlobal from '@/hooks/useGlobal';
import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import useActionEffect, { IModalMessage } from './useEventEmitter';

import styles from './index.module.less';

const FragmentComp = () => null;

interface IProps {
  className?: string;
}

const FullScreenModal: React.FC<IProps> = ({ className }) => {
  const keyRef = useRef(getRandomNumber(0, 100));

  const [animationVisible, setAnimationVisible] = useState(false);

  const {
    drawerType,
    contentPayload,
    drawerCfg,

    driverOpen,
  } = useActionEffect();
  const { width, height, canClose } = drawerCfg;

  const { EventEmitter } = useGlobal();

  useEffect(() => {
    let timer: number;
    if (drawerType) {
      setAnimationVisible(true);
    } else {
      timer = window.setTimeout(() => {
        setAnimationVisible(false);
      }, 300); // 动画持续时间
    }
    return () => clearTimeout(timer);
  }, [drawerType]);

  const ContentComp = useMemo(() => {
    if (drawerType === 'iframe') {
      return IframeRender;
    }

    return FragmentComp;
  }, [drawerType]);

  const ContentElement = React.useMemo(() => {
    if (React.isValidElement(drawerType)) {
      return drawerType;
    }
    return null;
  }, [drawerType]);

  return (
    <Modal
      open={!!drawerType}
      onCancel={() => driverOpen('')}
      footer={null}
      width="100%"
      style={{ top: 0, padding: 0 }}
      maskClosable={false}
      closable={canClose}
      destroyOnHidden
      className={styles.fullScreenModal}
    >
      <div
        className={classnames(styles.content, className, {
          [styles.visible]: animationVisible,
        })}
        style={{ width, height }}
      >
        <Suspense fallback="loading...">
          {ContentElement}
          <ContentComp
            key={keyRef.current}
            {...(contentPayload || {})}
            onClose={() => driverOpen('')}
            onUpdateMessage={(payload: IModalMessage) => {
              if (!payload.messageId) return;
              console.log('onUpdateMessage', payload);
              EventEmitter.emit('beyond-update-message', {
                message: payload,
                opt: {},
              });
            }}
            onCreateMessage={(payload: IModalMessage) => {
              console.log('onCreateMessage', payload);
              EventEmitter.emit('beyond-create-message', {
                ...payload,
                fromBeyond: true,
              });
            }}
          />
        </Suspense>
      </div>
    </Modal>
  );
};

export default FullScreenModal;
