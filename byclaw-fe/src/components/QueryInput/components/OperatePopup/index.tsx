import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import lazyHandler from '@/components/MessageList/lazyHandler';
import useGlobal from '@/hooks/useGlobal';
import { CloseOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { get, isEmpty } from 'lodash';

import type { IMessage, IMessageListItem } from '@/typescript/message.d.ts';

import styles from './index.module.less';

type IProps = {
  style?: React.CSSProperties;
};

type ICompProps = {
  messageListItem: IMessageListItem;
  message: IMessage;
  messageListItemContent: any;
  messageIdx: number;
  updateMessageListItemContent: (messageListItemContent: any) => void;
};

const FragmentComp = () => <></>;

function OperatePopup(props: IProps) {
  const { style = {} } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [compProps, setCompProps] = useState<Partial<ICompProps>>({});

  const tipsBlockRef = useRef<HTMLDivElement | null>(null);
  const { EventEmitter } = useGlobal();

  const Comp = useMemo(() => {
    if (isEmpty(compProps) || !compProps) return FragmentComp;
    const contentType = get(compProps, 'messageListItem.contentType');

    return lazyHandler.lazyComp(`${contentType}`) || FragmentComp;
  }, [compProps]);

  useEffect(() => {
    const handler = (mycompProps: ICompProps) => {
      setCompProps(mycompProps || {});
      if (isEmpty(mycompProps) || !mycompProps) {
        setIsOpen(false);
      } else {
        setIsOpen(true);
      }
    };

    EventEmitter.on('beyond-operatepopup-set-compconent', handler);

    return () => {
      EventEmitter.off('beyond-operatepopup-set-compconent', handler);
    };
  }, []);

  useEffect(() => {
    const clickHandler = (e: MouseEvent) => {
      if (tipsBlockRef.current !== e.target) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      requestIdleCallback(() => {
        document.addEventListener('click', clickHandler, { once: true });
      });
    }

    return () => {
      document.removeEventListener('click', clickHandler);
    };
  }, [isOpen]);

  return (
    <>
      <div
        className={classnames(styles.tipsBlock, styles.smoothHeight, 'overflow-hidden', {
          [styles.smoothHeightOpen]: isOpen,
        })}
        style={{
          ...style,
        }}
        ref={tipsBlockRef}
        id="operatePopup"
        onClick={(e: React.SyntheticEvent) => e.stopPropagation()}
      >
        <div className={`${styles.tipsBlockContent} ub ub-ver overflow-hidden`}>
          <CloseOutlined
            className={classnames(styles.closeBtn, 'pointer')}
            onClick={() => {
              setCompProps({});
              setIsOpen(false);
            }}
          />
          <div className="overflow-auto hideThumb" onClick={(e: React.SyntheticEvent) => e.stopPropagation()}>
            <Suspense key={`${get(compProps, 'messageListItem.contentType')}_Suspense`}>
              <Comp {...compProps} />
            </Suspense>
          </div>
        </div>
      </div>
      <div
        className={`${styles.rectifyQuestionTips} ub ub-ac ub-pc ${styles.smoothOpacity} ${
          isOpen ? styles.smoothOpacityVisible : ''
        }`}
      />
    </>
  );
}

export default OperatePopup;
