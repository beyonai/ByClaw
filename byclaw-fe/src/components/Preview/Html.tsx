import React, { useEffect, useRef, useState } from 'react';
import { Segmented } from 'antd';
import { CodeOutlined, ReadOutlined } from '@ant-design/icons';
import cn from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { copyWithMessage } from '@/utils/copy';
import { getIntl } from '@umijs/max';

import TextHighlight from './TextHighlight';
import styles from './Html.module.less';

// loader.config({
//   paths: {
//     vs: window.location.origin + getRuntimeActualUrl('/monaco/vs'),
//   },
// });

export interface HtmlPreviewProps {

  /** 资源链接 */
  // eslint-disable-next-line react/no-unused-prop-types
  href?: string;

  /** 数据 */
  data?: string | Blob;

  /** 标题 */
  title?: string;
}

export const HtmlRender = (props: { content?: string; safe?: boolean; href?: string }) => {
  const { content, href, safe = true } = props;
  const [loading, setLoading] = useState<boolean>(false);
  const [key, setKey] = useState<number>(Date.now());
  const ref = useRef<HTMLIFrameElement>(null);

  const onLoad = () => {
    setLoading(false);
  };

  useEffect(() => {
    // 如果存在资源链接，则使用资源链接
    if (href && !content) {
      if (ref.current) {
        setLoading(true);
        ref.current.src = href;
      }
    }

    // 如果存在内容，则使用内容
    if (content && !href) {
      if (safe) {
        const blob = new Blob([content], { type: 'text/html' });
        if (ref.current) {
          setLoading(true);
          ref.current.src = URL.createObjectURL(blob);
        }
      }
      if (!safe) {
        if (ref.current) {
          setLoading(true);
          ref.current.srcdoc = content;
        }
      }
    }

    return () => {
      if (safe) setKey(Date.now());
      if (ref.current?.src) URL.revokeObjectURL(ref.current.src);
    };
  }, [content, safe, href]);
  console.log('loading', loading);
  return (
    <section className={styles.html}>
      {loading && (
        <div className={styles.loader}>
          <span />
        </div>
      )}
      <iframe ref={ref} key={key} title={getIntl().formatMessage({ id: 'preview.htmlPreview' })} onLoad={onLoad} />
    </section>
  );
};

export default function HtmlPreview(props: HtmlPreviewProps) {
  const { data, title } = props;
  const [type, setType] = useState<'code' | 'html'>('code');
  const [content, setContent] = useState<string>();
  const ref = useRef<string>(null);

  const onDownload = () => {
    const a = document.createElement('a');
    let blob: Blob;
    if (!(data instanceof Blob)) {
      blob = new Blob([data || ''], { type: 'text/plain' });
    } else {
      blob = data;
    }
    ref.current = URL.createObjectURL(blob);
    a.href = ref.current;
    a.download = title || 'preview.md';
    a.click();
  };

  const onCopy = () => {
    if (content) copyWithMessage(content);
  };

  const onFullScreen = () => {
    const body = document.getElementById('preview-body');
    if (body) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        body.requestFullscreen();
      }
    }
  };

  useEffect(() => {
    if (data instanceof Blob) {
      data.text().then((text) => {
        setContent(text);
      });
    }
  }, [data]);

  return (
    <div className={styles.preview}>
      <div className={styles.head}>
        <Segmented
          size="small"
          value={type}
          onChange={(value) => setType(value as 'code')}
          options={[
            { value: 'code', icon: <CodeOutlined /> },
            { value: 'html', icon: <ReadOutlined /> },
          ]}
        />

        <span style={{ flex: 1 }} />
        <AntdIcon className={styles.icon} type="icon-a-Downloadxiazai" onClick={onDownload} />
        <AntdIcon className={styles.icon} type="icon-a-Copyfuzhi1" onClick={onCopy} />
        <AntdIcon className={styles.icon} type="icon-a-Full-screen-onequanjufangda1" onClick={onFullScreen} />
      </div>
      <div className={cn(styles.body, styles[type])}>
        {type === 'code' && <TextHighlight lang="html" content={content} lineNumber />}
        {type === 'html' && <HtmlRender content={content} />}
      </div>
    </div>
  );
}
