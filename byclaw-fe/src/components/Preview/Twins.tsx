import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Segmented, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { EyeOutlined, FileDoneOutlined } from '@ant-design/icons';
import cn from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { copyWithMessage } from '@/utils/copy';
import { BundledLanguage } from 'shiki';
import {
  AUDIO_PREVIEW_TYPES,
  HTML_PREVIEW_TYPES,
  IMAGE_PREVIEW_TYPES,
  OFFICE_PREVIEW_TYPES,
  PREVIEW_MIME_TYPES,
  TEXT_PREVIEW_TYPES,
  VIDEO_PREVIEW_TYPES,
  resolvePreviewType,
} from './formats';
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

const MediaPreviewComponent = React.lazy(() => import('@/components/Preview/Media'));

// 文件扩展名 -> shiki 语言。仅收录 shiki/bundle-web 实际打包的语言;传入未打包的 lang 会让 codeToHtml 抛错致预览白屏。
// 未命中的代码/配置类型(如 go/rust/kotlin)仍按纯文本展示(见 isTextLike + TextHighlight 默认 lang)。
const langMap: Record<string, BundledLanguage> = {
  md: 'markdown',
  svg: 'xml',
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

// SVG 同时提供图片预览和 XML 源码；CSV/TSV 等数据文本沿用可复制的源码预览。
const isTextLike = (type: string) => TEXT_PREVIEW_TYPES.includes(type);
const canReadSource = (type: string) => isTextLike(type) || ['md', 'svg', ...HTML_PREVIEW_TYPES].includes(type);
const officeTypes = OFFICE_PREVIEW_TYPES;
const visualTypes = [
  'md',
  'pdf',
  ...HTML_PREVIEW_TYPES,
  ...IMAGE_PREVIEW_TYPES,
  ...VIDEO_PREVIEW_TYPES,
  ...AUDIO_PREVIEW_TYPES,
  ...officeTypes,
];

const createPreviewBlob = (blob: Blob, type: string, title?: string) => {
  // SVG、PDF 和媒体解码需要具体 MIME；未提供文件名时同样修正通用二进制响应。
  const mimeType = PREVIEW_MIME_TYPES[type] || blob.type;
  return title ? new File([blob], title, { type: mimeType }) : new Blob([blob], { type: mimeType });
};

export interface TwinsProps {
  data?: string | Blob;
  type?: string;
  title?: string;
  resolveMarkdownImage?: MarkdownImageResolver;
  resolveHtmlResource?: MarkdownImageResolver;
  onHtmlLinkClick?: (href: string) => void;
}

export const PreViewFile = React.memo((props: TwinsProps & { extra?: React.ReactNode; className?: string }) => {
  const {
    data,
    type: providedType,
    title,
    extra,
    className,
    resolveMarkdownImage,
    resolveHtmlResource,
    onHtmlLinkClick,
  } = props;
  const intl = useIntl();
  const type = resolvePreviewType(providedType, title, data instanceof Blob ? data.type : undefined);
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
      downloadUrl = URL.createObjectURL(createPreviewBlob(data, type, title));
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
    let objectUrl: string | undefined;
    let disposed = false;
    setUri(undefined);
    setContent(undefined);
    setLoading(false);

    if (data instanceof Blob && !officeTypes.includes(type)) {
      if (canReadSource(type)) {
        setLoading(true);
        data
          .text()
          .then((source) => {
            if (disposed) return;
            let text = source;
            if (type === 'json') {
              try {
                text = JSON.stringify(JSON.parse(source), null, 2);
              } catch {
                // 非标准 JSON 仍展示原文，避免影响下载或其他格式预览。
              }
            }
            setContent([langMap[type], text]);
          })
          .catch(() => {
            if (!disposed) setContent(undefined);
          })
          .finally(() => {
            if (!disposed) setLoading(false);
          });
      }
      objectUrl = URL.createObjectURL(createPreviewBlob(data, type, title));
      setUri(objectUrl);
    } else if (typeof data === 'string') {
      if (canReadSource(type)) setContent([langMap[type], data]);
      if (type === 'svg' || HTML_PREVIEW_TYPES.includes(type)) {
        objectUrl = URL.createObjectURL(createPreviewBlob(new Blob([data]), type, title));
        setUri(objectUrl);
      } else if ([...IMAGE_PREVIEW_TYPES, ...VIDEO_PREVIEW_TYPES, ...AUDIO_PREVIEW_TYPES].includes(type)) {
        setUri(data);
      }
    }

    return () => {
      // 异步文本读取不得覆盖后来打开的文件；只回收本组件创建的 URL。
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, type, title]);

  const tabs = useMemo(() => {
    const options = [];
    if (visualTypes.includes(type)) options.push({ value: 'preview', icon: <EyeOutlined /> });
    if (content) options.push({ value: 'source', icon: <FileDoneOutlined /> });
    return options;
  }, [type, content]);

  useEffect(() => {
    setTab(tabs[0]?.value as 'source' | 'preview' | undefined);
  }, [tabs]);

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
        <span style={{ display: canReadSource(type) ? '' : 'none' }} className={ss.icon}>
          <AntdIcon type="icon-a-Copyfuzhi1" onClick={onCopy} />
        </span>
        {extra}
      </nav>
      <div className={ss.twins}>
        {!loading && !visualTypes.includes(type) && !isTextLike(type) && (
          <Alert type="info" showIcon message={intl.formatMessage({ id: 'fileRender.formatUnsupported' })} />
        )}
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
            {/* PDF 必须保留二进制 URL 交给浏览器预览，避免被 HTML 资源解析分支读取为文本而显示乱码。 */}
            {(HTML_PREVIEW_TYPES.includes(type) || type === 'pdf') &&
              (type !== 'pdf' && resolveHtmlResource ? (
                <HtmlRenderComponent
                  content={content?.[1]}
                  data={data instanceof Blob ? data : undefined}
                  resolveResource={resolveHtmlResource}
                  onLinkClick={onHtmlLinkClick}
                />
              ) : (
                <HtmlRenderComponent href={uri} onLinkClick={onHtmlLinkClick} />
              ))}
          </Suspense>
        </div>
        <div
          style={{
            display: !!uri && tab === 'preview' && IMAGE_PREVIEW_TYPES.includes(type) ? 'block' : 'none',
          }}
          className={'full-width full-height'}
        >
          <Suspense fallback={<Spin />}>
            {IMAGE_PREVIEW_TYPES.includes(type) && <ImagePreviewComponent url={uri} title={title} />}
          </Suspense>
        </div>
        <div
          style={{
            display:
              !!uri && tab === 'preview' && [...VIDEO_PREVIEW_TYPES, ...AUDIO_PREVIEW_TYPES].includes(type)
                ? 'block'
                : 'none',
          }}
          className="full-width full-height"
        >
          <Suspense fallback={<Spin />}>
            {uri && [...VIDEO_PREVIEW_TYPES, ...AUDIO_PREVIEW_TYPES].includes(type) && (
              <MediaPreviewComponent
                url={uri}
                title={title}
                type={VIDEO_PREVIEW_TYPES.includes(type) ? 'video' : 'audio'}
                active={tab === 'preview'}
              />
            )}
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
  const { data, type, title, resolveMarkdownImage, resolveHtmlResource, onHtmlLinkClick } = props;

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
      onHtmlLinkClick={onHtmlLinkClick}
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
