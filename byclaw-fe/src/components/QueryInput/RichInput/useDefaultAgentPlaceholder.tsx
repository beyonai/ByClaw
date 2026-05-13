import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Descendant } from 'slate';
import { getElementFullRect, getInputText } from './utils';
import styles from './index.module.less';
import { debounce } from 'lodash';

export default function useDefaultAgentPlaceholder(
  value: Descendant[],
  editorWrapRef: React.RefObject<HTMLDivElement | null>,
  placeholder: string
) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [updateKey, setUpdateKey] = useState(1);
  const [, startTransition] = useTransition();

  const [isComposing] = useState<React.RefObject<boolean>>(() => {
    const ref = { current: false };
    if (window.Proxy) {
      return new Proxy(ref, {
        set(target, prop, value) {
          if (prop === 'current') {
            target.current = value;
            startTransition(() => {
              setUpdateKey((prev) => prev + 1);
            });
            return true;
          }
          return false;
        },
      });
    }
    return ref;
  });

  const agentPlaceholder = useMemo(() => <div ref={placeholderRef} className={styles.myPlaceholder} />, []);
  const defaultAgentDomObserver = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (editorWrapRef.current) {
      // 监听宽度变化
      const observer = new ResizeObserver(() =>
        debounce(() => {
          setUpdateKey((prev) => prev + 1);
        }, 50)
      );
      observer.observe(editorWrapRef.current);
      setUpdateKey((prev) => prev + 1);
      return () => {
        observer.disconnect();
      };
    }
    setUpdateKey((prev) => prev + 1);
    return () => {
      defaultAgentDomObserver.current?.disconnect();
      defaultAgentDomObserver.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    defaultAgentDomObserver.current?.disconnect();
    defaultAgentDomObserver.current = null;
    if (placeholderRef.current) {
      const { displayText } = getInputText(value);
      if (!displayText && !isComposing.current && placeholder && editorWrapRef.current) {
        const defaultAgentDom = editorWrapRef.current?.querySelector('.default-agent[data-slate-node="element"]');
        const setPlaceholderStyle = () => {
          if (defaultAgentDom && editorWrapRef.current) {
            const rect = getElementFullRect(defaultAgentDom as HTMLSpanElement);
            if (rect.width < editorWrapRef.current.clientWidth) {
              placeholderRef.current!.style.lineHeight = rect.lineHeight;
              placeholderRef.current!.innerHTML = `<span style="width:${rect.width}px"></span><span>${placeholder}</span>`;
              placeholderRef.current!.style.display = 'block';
            }
          }
        };

        if (defaultAgentDom) {
          defaultAgentDomObserver.current = new ResizeObserver(() => {
            setPlaceholderStyle();
          });
          defaultAgentDomObserver.current.observe(defaultAgentDom);
        }
        setPlaceholderStyle();
      }
      placeholderRef.current.style.display = 'none';
    }
  }, [value, placeholder, updateKey]);

  return {
    agentPlaceholder,
    isComposing,
  };
}
