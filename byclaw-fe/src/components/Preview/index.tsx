import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import cn from 'classnames';
import { BundledLanguage } from 'shiki/bundle/web';
import AntdIcon from '@/components/AntdIcon';
import { copyWithMessage } from '@/utils/copy';
import TextHighlight from './TextHighlight';
import styles from './index.less';

export interface TextPreviewProps {
  url?: string;
  data?: string | Blob;
  type?: BundledLanguage;
  title?: string;
  maxSizeAt?: HTMLElement | string | (() => HTMLElement);
}

interface iPreview {
  (props: TextPreviewProps): React.JSX.Element;
}

export const Preview: iPreview = (props) => {
  const { url, data, type, title, maxSizeAt = document.body } = props;
  const [mountPoint, setMountPoint] = useState<Element>();
  const [source, setSource] = useState<string | undefined>();
  const uri = useRef<string>(null);

  const onDownload = () => {
    let tmp = url || '';
    if (!tmp && source) {
      const blob = new Blob([source || ''], { type: 'text/plain' });
      uri.current = URL.createObjectURL(blob);
      tmp = uri.current;
    }
    const a = document.createElement('a');
    a.href = tmp;
    a.download = title || 'preview.md';
    a.click();
  };

  const onCopy = () => {
    if (source) copyWithMessage(source);
  };

  const onFullScreen = () =>
    setMountPoint((old) => {
      if (old) return undefined;
      if (maxSizeAt instanceof HTMLElement) {
        return maxSizeAt;
      }
      if (maxSizeAt instanceof Function) {
        return maxSizeAt() || document.body;
      }
      if (typeof maxSizeAt === 'string') {
        return document.querySelector(maxSizeAt) ?? document.body;
      }

      return document.body;
    });

  useEffect(() => {
    if (data) {
      if (data instanceof Blob) {
        data.text().then((text) => {
          setSource(text);
        });
      } else {
        setSource(data);
      }
    }
  }, [data]);

  useEffect(() => {
    if (!data && url) {
      fetch(url).then((res) => {
        res.text().then((text) => {
          setSource(text);
        });
      });
    }
  }, [url, data]);

  const content = (
    <div className={cn(styles.preview, { [styles.fullScreen]: !!mountPoint })}>
      <div className={styles.head}>
        <AntdIcon className={styles.icon} type="icon-a-Downloadxiazai" onClick={onDownload} />
        <AntdIcon className={styles.icon} type="icon-a-Copyfuzhi1" onClick={onCopy} />
        <AntdIcon className={styles.icon} type="icon-a-Full-screen-onequanjufangda1" onClick={onFullScreen} />
      </div>
      <div className={styles.body}>
        <TextHighlight lang={type} content={source} lineNumber={false} />
      </div>
    </div>
  );

  return mountPoint ? createPortal(content, mountPoint) : content;
};
