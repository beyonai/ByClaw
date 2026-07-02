import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, Spin } from 'antd';
import { EyeOutlined, FileDoneOutlined } from '@ant-design/icons';
import cn from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { copyWithMessage } from '@/utils/copy';
import { BundledLanguage } from 'shiki';
import { Animated } from '../Animated';
// import { KeepAlive } from '../KeepAlive';
import ss from './Twins.module.less';

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

const langMap: Record<string, BundledLanguage> = {
  md: 'markdown',
  json: 'json',
  html: 'html',
};

const officeTypes = ['pptx', 'docx', 'xlsx'];

const createNamedBlob = (blob: Blob, type: string, title?: string) => {
  if (!title) return blob;

  return new File([blob], title, { type: typeMap[type] || blob.type });
};

export interface TwinsProps {
  data?: string | Blob;
  type?: string;
  title?: string;
}

export const PreViewFile = React.memo((props: TwinsProps & { extra?: React.ReactNode; className?: string }) => {
  const { data, type = 'txt', title, extra, className } = props;
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

      // 可查看源码
      if (type && ['txt', 'md', 'h5', 'html', 'json', 'text'].includes(type)) {
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
        <span className={ss.icon} style={{ display: ['h5', 'html', 'md', 'txt'].includes(type) ? '' : 'none' }}>
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
        <div style={{ display: !!content && tab === 'source' ? 'block' : 'none' }} className={ss.textPane}>
          <Suspense fallback={<Spin />}>
            <TextHighlightComponent content={content?.[1]} lang={content?.[0] as any} lineNumber />
          </Suspense>
        </div>
        <div
          style={{ display: !!uri && tab === 'preview' && ['h5', 'html', 'pdf'].includes(type) ? 'block' : 'none' }}
          className={'full-width full-height'}
        >
          <Suspense fallback={<Spin />}>
            <HtmlRenderComponent href={uri} />
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
          style={{ display: !!uri && tab === 'preview' && ['md'].includes(type) ? 'block' : 'none' }}
          className={ss.textPane}
        >
          <Suspense fallback={<Spin />}>
            <MdPreviewComponent content={content?.[1]} />
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
  const { data, type = 'txt', title } = props;

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
