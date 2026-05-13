// tslint:disable:ordered-imports
import React, { useCallback, useEffect, createElement, useState, useRef, useMemo, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import classnames from 'classnames';
import { generateUniqueId } from '@/utils/math';
import { CloseOutlined } from '@ant-design/icons';

import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';

import styles from './index.module.less';
import useGlobal from '../useGlobal';

const INIT_DRAWER_CFG = {
  title: '',
  canFullScreen: false,
  canClose: false,
  width: '20vw',
};

type IMyDrawerProps = {
  children?: any;
  onClose: () => void;
} & Partial<typeof INIT_DRAWER_CFG>;

const MyDrawer = ({ children, onClose, title, width }: IMyDrawerProps) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div
      className={classnames(styles.myDrawer, {
        [styles.opening]: isOpen,
        [styles.closing]: !isOpen,
      })}
      style={{ width }}
    >
      <div className="ub ub-ver full-height">
        <div className={classnames(styles.header)}>
          <div className="ellipsis ub-f1">{title}</div>
          <CloseOutlined
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              setIsOpen(false);
              setTimeout(() => {
                onClose();
              }, 300);
            }}
          />
        </div>
        <div className="ub-f1 overflow-auto hideThumb">{children}</div>
      </div>
    </div>
  );
};

function useRelativeDrawer({ rootId }: { rootId: string }) {
  const compSetRef = useRef<Set<ReactNode>>(new Set());

  const [isreflush, setReflush] = useState(generateUniqueId());
  const { EventEmitter } = useGlobal();

  const reflush = useCallback(() => {
    setReflush(generateUniqueId());
  }, []);

  const getRenderer = useCallback((compType: string) => {
    if (compType === 'iframe') {
      return IframeRender;
    }
    return null;
  }, []);

  const createDrawer = useCallback(
    (compType: string, payload?: any, drawerCfg?: Partial<typeof INIT_DRAWER_CFG>) => {
      const root = window.document.getElementById(rootId);
      let comp: any;
      const Renderer = getRenderer(compType);

      if (!root || !Renderer) return;

      const drawer = createElement(
        MyDrawer,
        {
          onClose: () => {
            compSetRef.current.delete(comp);
            reflush();
          },
          ...drawerCfg,
        },
        createElement(Renderer, { ...payload })
      );

      comp = createPortal(drawer, root, generateUniqueId());

      compSetRef.current.add(comp);
      reflush();
    },
    [rootId]
  );

  useEffect(() => {
    const create = (param: { compType: string; payload?: any; drawerCfg?: Partial<typeof INIT_DRAWER_CFG> }) => {
      const { compType, payload = {}, drawerCfg = INIT_DRAWER_CFG } = param;

      createDrawer(compType, payload, drawerCfg);
    };

    EventEmitter.on('beyond-relative-driver-message', create);
    return () => {
      EventEmitter.off('beyond-relative-driver-message', create);
    };
  }, [createDrawer]);

  useEffect(() => {
    const clean = () => {
      compSetRef.current.clear();
      reflush();
    };
    EventEmitter.on('beyond-relative-driver-clean', clean);
    return () => {
      EventEmitter.on('beyond-relative-driver-clean', clean);
    };
  }, []);

  const compList = useMemo<ReactNode[]>(() => {
    return [...compSetRef.current];
  }, [isreflush]);

  return {
    createDrawer,
    compList,
  };
}

export default useRelativeDrawer;
