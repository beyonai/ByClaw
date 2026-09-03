import React, { useEffect, useRef, useState } from 'react';
import { Segmented } from 'antd';
import { CodeOutlined, ReadOutlined } from '@ant-design/icons';
import cn from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { copyWithMessage } from '@/utils/copy';
import { getIntl } from '@umijs/max';

import TextHighlight from './TextHighlight';
import type { MarkdownImageResolver } from './Md';
import styles from './Html.module.less';

// loader.config({
//   paths: {
//     vs: window.location.origin + getRuntimeActualUrl('/monaco/vs'),
//   },
// });

/* eslint-disable lines-around-comment */
export interface HtmlPreviewProps {
  /** 资源链接 */
  // eslint-disable-next-line react/no-unused-prop-types
  href?: string;

  /** 数据 */
  data?: string | Blob;

  /** 标题 */
  title?: string;
}
/* eslint-enable lines-around-comment */

const isRelativeResourcePath = (path: string) =>
  !path.startsWith('/') && !path.startsWith('#') && !path.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(path);

const resolveHtmlResources = async (
  content: string,
  resolver: MarkdownImageResolver,
  onLinkClick?: (href: string) => void
) => {
  const document = new DOMParser().parseFromString(content, 'text/html');
  const resourceNodes = [
    ...Array.from(document.querySelectorAll<HTMLElement>('img[src], source[src]')).map((element) => ({
      element,
      attribute: 'src',
    })),
    ...Array.from(document.querySelectorAll<HTMLElement>('video[poster]')).map((element) => ({
      element,
      attribute: 'poster',
    })),
    ...Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((element) => ({
      element,
      attribute: 'href',
    })),
  ];
  const objectUrls: string[] = [];

  await Promise.all(
    resourceNodes.map(async ({ element, attribute }) => {
      const resourcePath = element.getAttribute(attribute);
      if (!resourcePath || !isRelativeResourcePath(resourcePath)) return;

      try {
        const resolvedResource = await resolver(resourcePath);
        if (resolvedResource instanceof Blob) {
          const objectUrl = URL.createObjectURL(resolvedResource);
          objectUrls.push(objectUrl);
          element.setAttribute(attribute, objectUrl);
        } else if (resolvedResource) {
          element.setAttribute(attribute, resolvedResource);
        }
        if (element.tagName === 'A') {
          element.setAttribute('data-preview-resource-path', resourcePath);
          (element as HTMLAnchorElement).target =
            onLinkClick && isRelativeResourcePath(resourcePath) ? '_self' : '_blank';
          (element as HTMLAnchorElement).rel = 'noopener noreferrer';
          if (onLinkClick && isRelativeResourcePath(resourcePath)) {
            element.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              onLinkClick(resourcePath);
            });
          }
        }
      } catch {
        // 单个资源解析失败时保留原始地址，不影响 HTML 其它内容预览。
      }
    })
  );

  return { content: document.documentElement.outerHTML, objectUrls };
};

export const HtmlRender = React.memo(
  (props: {
    content?: string;
    data?: Blob;
    safe?: boolean;
    href?: string;
    resolveResource?: MarkdownImageResolver;
    onLinkClick?: (href: string) => void;
  }) => {
    const { content, data, href, safe = true, resolveResource, onLinkClick } = props;
    const [loading, setLoading] = useState<boolean>(false);
    const [blobContent, setBlobContent] = useState<string>();
    const ref = useRef<HTMLIFrameElement>(null);
    const htmlContent = content !== undefined ? content : blobContent;

    const onLoad = () => {
      // HTML 在 iframe 中预览时，链接默认可能被当前 iframe 接管，导致点击后出现空白页。
      // 统一改为新标签页打开，并保留安全的 opener 防护。
      const document = ref.current?.contentDocument;
      document?.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
        const relativePath = anchor.getAttribute('data-preview-resource-path') || anchor.getAttribute('href') || '';
        const isInternalLink = !!onLinkClick && isRelativeResourcePath(relativePath);
        anchor.target = isInternalLink ? '_self' : '_blank';
        anchor.rel = 'noopener noreferrer';
        if (isInternalLink) {
          anchor.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            onLinkClick(relativePath);
            return false;
          };
        }
      });
      document?.addEventListener(
        'click',
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const anchor = target.closest<HTMLAnchorElement>('a[href]');
          const link = anchor?.getAttribute('data-preview-resource-path') || anchor?.getAttribute('href');
          if (!anchor || !link || !onLinkClick || !isRelativeResourcePath(link)) return;
          event.preventDefault();
          event.stopPropagation();
          onLinkClick(link);
        },
        true
      );
      setLoading(false);
    };

    useEffect(() => {
      let objectUrl: string | undefined;
      let resourceObjectUrls: string[] = [];
      let active = true;

      const revokeResourceObjectUrls = () => {
        resourceObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        resourceObjectUrls = [];
      };

      const renderContent = (resolvedContent: string, resolvedObjectUrls: string[] = []) => {
        resourceObjectUrls = resolvedObjectUrls;
        if (!active) {
          revokeResourceObjectUrls();
          return;
        }

        if (safe) {
          const blob = new Blob([resolvedContent], { type: 'text/html' });
          if (ref.current) {
            objectUrl = URL.createObjectURL(blob);
            ref.current.src = objectUrl;
          }
        } else if (ref.current) {
          ref.current.srcdoc = resolvedContent;
        }
        setLoading(false);
      };

      // 如果存在资源链接，则使用资源链接
      if (href && !content) {
        if (ref.current) {
          setLoading(true);
          ref.current.src = href;
        }
      }

      // 如果存在内容，则使用内容
      if (htmlContent !== undefined && !href) {
        setLoading(true);
        if (resolveResource) {
          void resolveHtmlResources(htmlContent, resolveResource, onLinkClick)
            .then(({ content: resolvedContent, objectUrls }) => renderContent(resolvedContent, objectUrls))
            .catch(() => renderContent(htmlContent));
        } else {
          renderContent(htmlContent);
        }
      }

      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        revokeResourceObjectUrls();
      };
    }, [htmlContent, href, onLinkClick, resolveResource, safe]);

    useEffect(() => {
      if (content !== undefined || !(data instanceof Blob)) {
        setBlobContent(undefined);
        return;
      }

      let active = true;
      void data.text().then((text) => {
        if (active) setBlobContent(text);
      });

      return () => {
        active = false;
      };
    }, [content, data]);

    return (
      <section className={styles.html}>
        {loading && (
          <div className={styles.loader}>
            <span />
          </div>
        )}
        <iframe ref={ref} title={getIntl().formatMessage({ id: 'preview.htmlPreview' })} onLoad={onLoad} />
      </section>
    );
  }
);

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
