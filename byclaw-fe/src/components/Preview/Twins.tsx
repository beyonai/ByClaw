import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, Spin } from 'antd';
import { EyeOutlined, FileDoneOutlined } from '@ant-design/icons';
import cn from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { copyWithMessage } from '@/utils/copy';
import { BundledLanguage } from 'shiki';
import { CODE_TEXT_EXTENSIONS } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import { Animated } from '../Animated';
// import { KeepAlive } from '../KeepAlive';
import ss from './Twins.module.less';
import type { MarkdownImageResolver } from './Md';

const HtmlRenderComponent = React.lazy(() =>
  import('@/components/Preview/Html').then((module) => ({ default: module.HtmlRender }))
);
const TextHighlightComponent = React.lazy(() =>
  import('@/components/Preview/TextHighlight').then((module) => ({ default: module.default }))
);
const MdPreviewComponent = React.lazy(() =>
  import('@/components/Preview/Md').then((module) => ({ default: module.default }))
);
const ImagePreviewComponent = React.lazy(() =>
  import('@/components/Preview/Image').then((module) => ({ default: module.default }))
);
const OfficeComponent = React.lazy(() =>
  import('@/components/Preview/Office').then((module) => ({ default: module.Office }))
);

const typeMap: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  pdf: 'application/pdf',
  json: 'application/json',
  h5: 'text/html',
  html: 'text/html',
  image: 'image/*',
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// 文件扩展名 -> shiki 语言。仅收录 shiki/bundle-web 实际打包的语言;传入未打包的 lang 会让 codeToHtml 抛错致预览白屏。
// 未命中的代码/配置类型(如 go/rust/kotlin)仍按纯文本展示(见 isTextLike + TextHighlight 默认 lang)。
const langMap: Record<string, BundledLanguage> = {
  md: 'markdown',
  json: 'json',
  html: 'html',
  xml: 'xml',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  java: 'java',
  py: 'python',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  php: 'php',
  sh: 'shellscript',
  bash: 'bash',
  zsh: 'zsh',
  sql: 'sql',
  vue: 'vue',
  css: 'css',
  less: 'less',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
};

// 纯文本类(可读源码展示):显式文本类型 + 白名单里的代码/配置扩展名(不依赖 langMap,未高亮也纯文本兜底)。
const isTextLike = (type: string) =>
  ['txt', 'text', 'log', 'json'].includes(type) || CODE_TEXT_EXTENSIONS.includes(type);

const officeTypes = ['pptx', 'docx', 'xlsx'];

const createNamedBlob = (blob: Blob, type: string, title?: string) => {
  if (!title) return blob;

  return new File([blob], title, { type: typeMap[type] || blob.type });
};

export interface TwinsProps {
  data?: string | Blob;
  type?: string;
  title?: string;
  resolveMarkdownImage?: MarkdownImageResolver;
  resolveHtmlResource?: MarkdownImageResolver;
}

export const PreViewFile = React.memo((props: TwinsProps & { extra?: React.ReactNode; className?: string }) => {
  const { data, type = 'txt', title, extra, className, resolveMarkdownImage, resolveHtmlResource } = props;
  const [tab, setTab] = useState<'source' | 'preview'>();

  /** 资源链接 - 用于预览 */
  const [uri, setUri] = useState<string>();

  /** 内容 - 用于展示源代码 */
  const [content, setContent] = useState<[ext: string, data: string]>();
  const [loading, setLoading] = useState(false);
  const canDownload = !!uri || (data instanceof Blob && officeTypes.includes(type));

  const onDownload = () => {
    let downloadUrl = uri;

    if (!downloadUrl && data instanceof Blob && officeTypes.includes(type)) {
      downloadUrl = URL.createObjectURL(createNamedBlob(data, type, title));
      setTimeout(() => {
        if (downloadUrl) {
          URL.revokeObjectURL(downloadUrl);
        }
      }, 0);
    }

    if (!downloadUrl) return;

    const a = document.createElement('a');

    a.href = downloadUrl;
    a.download = title || 'preview.md';
    a.click();
  };

  const onCopy = () => {
    if (content) copyWithMessage(content[1]);
  };

  useEffect(() => {
    let _uri: string | undefined;

    setUri(undefined);

    if (data instanceof Blob && !officeTypes.includes(type)) {
      let blob: Blob = data;

      // 可查看源码:markdown/html 走各自预览,其余文本与代码类型统一读文本高亮。
      if (type && (isTextLike(type) || ['md', 'h5', 'html'].includes(type))) {
        setLoading(true);
        blob
          .text()
          .then((_text) => {
            let text = _text;
            if (type === 'json') {
              try {
                text = JSON.stringify(JSON.parse(text), null, 2);
              } catch (error) {
                text = _text;
              }
            }
            setContent([langMap[type], text]);
          })
          .finally(() => setLoading(false));
      }

      if (title) {
        blob = createNamedBlob(data, type, title);
      }

      _uri = URL.createObjectURL(blob);
      setUri(_uri);
    }
    if (data && typeof data === 'string') {
      setContent([langMap[type], data]);
    }
    return () => {
      setContent(undefined);
      if (_uri) URL.revokeObjectURL(_uri);
    };
  }, [data, type, title]);

  const tabs = useMemo(() => {
    const _tabs: any[] = [];
    // 可预览
    if (['h5', 'html', 'pdf', 'md', 'image', 'jpg', 'png', 'gif', 'bmp', 'webp', ...officeTypes].includes(type)) {
      _tabs.push({ value: 'preview', icon: <EyeOutlined /> });
    }
    if (content) {
      _tabs.push({ value: 'source', icon: <FileDoneOutlined /> });
    }
    if (_tabs.length) {
      setTab(_tabs[0].value);
    } else {
      setTab(undefined);
    }
    return _tabs;
  }, [uri, content]);
  return (
    <section className={cn(ss.twins, className)}>
      <nav className={ss.twins}>
        {tabs.length > 1 && (
          <Segmented
            options={tabs}
            shape="round"
            value={tab}
            onChange={(value) => setTab(value as 'source' | 'preview')}
          />
        )}

        <span style={{ flex: 1 }} />
        {canDownload && (
          <span className={ss.icon}>
            <AntdIcon type="icon-a-Downloadxiazai" onClick={onDownload} />
          </span>
        )}
        <span
          style={{ display: isTextLike(type) || ['h5', 'html', 'md'].includes(type) ? '' : 'none' }}
          className={ss.icon}
        >
          <AntdIcon type="icon-a-Copyfuzhi1" onClick={onCopy} />
        </span>
        {extra}
      </nav>
      <div className={ss.twins}>
        {loading && (
          <div className={ss.loading}>
            <Spin />
          </div>
        )}
        <div style={{ display: !!content && tab === 'source' ? 'block' : 'none' }} className={'full-width full-height'}>
          <Suspense fallback={<Spin />}>
            <TextHighlightComponent content={content?.[1]} lang={content?.[0] as any} lineNumber />
          </Suspense>
        </div>
        <div
          style={{ display: !!uri && tab === 'preview' && ['h5', 'html', 'pdf'].includes(type) ? 'block' : 'none' }}
          className={'full-width full-height'}
        >
          <Suspense fallback={<Spin />}>
            {resolveHtmlResource ? (
              <HtmlRenderComponent
                content={content?.[1]}
                data={data instanceof Blob ? data : undefined}
                resolveResource={resolveHtmlResource}
              />
            ) : (
              <HtmlRenderComponent href={uri} />
            )}
          </Suspense>
        </div>
        <div
          style={{
            display:
              !!uri && tab === 'preview' && ['jpg', 'png', 'gif', 'bmp', 'webp'].includes(type) ? 'block' : 'none',
          }}
          className={'full-width full-height'}
        >
          <Suspense fallback={<Spin />}>
            <ImagePreviewComponent url={uri} title={title} />
          </Suspense>
        </div>
        <div
          style={{ display: !!content && tab === 'preview' && ['md'].includes(type) ? 'block' : 'none' }}
          className={'full-width full-height'}
        >
          <Suspense fallback={<Spin />}>
            <MdPreviewComponent content={content?.[1]} resolveImage={resolveMarkdownImage} />
          </Suspense>
        </div>
        <div
          style={{ display: data && tab === 'preview' && officeTypes.includes(type) ? 'block' : 'none' }}
          className={'full-width full-height'}
        >
          <Suspense fallback={<Spin />}>
            <OfficeComponent data={data} type={type} />
          </Suspense>
        </div>
      </div>
    </section>
  );
});

export default function Twins(props: TwinsProps) {
  const { data, type = 'txt', title, resolveMarkdownImage, resolveHtmlResource } = props;

  /** 是否全屏 */
  const [fullscreen, setFullscreen] = useState(false);

  const onFullScreen = () => {
    setFullscreen((v) => !v);
  };

  const renderContent = (
    <PreViewFile
      data={data}
      type={type}
      title={title}
      resolveMarkdownImage={resolveMarkdownImage}
      resolveHtmlResource={resolveHtmlResource}
      extra={
        <span className={ss.icon}>
          <AntdIcon
            type={fullscreen ? 'icon-a-Collapse-text-inputshouqiwenbenyu' : 'icon-a-Full-screen-onequanjufangda1'}
            onClick={onFullScreen}
          />
        </span>
      }
    />
  );

  return (
    <>
      {renderContent}
      {createPortal(
        <Animated active={fullscreen} compute={(b) => ({ className: b ? ss.fullscreen : ss.none })}>
          <div>{renderContent}</div>
        </Animated>,
        document.body
      )}
    </>
  );
}
