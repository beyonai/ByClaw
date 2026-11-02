import React, { useState } from 'react';
import { get } from 'lodash';
import classnames from 'classnames';
import { useIntl } from '@umijs/max';
import { message } from 'antd';
import { domToReact } from 'html-react-parser';
import { CloudDownloadOutlined, LoadingOutlined, EyeOutlined } from '@ant-design/icons';
import useGlobal from '@/hooks/useGlobal';

import IconRender from '@/components/MessageList/components/FileRender/components/IconRender';

import { downloadFile, getFileUrl } from '@/utils/file';
import { isManagedChatFileArtifactPath, isRelativeChatFileArtifactPath } from '@/utils/chatFileArtifact';
import { downloadChatFileArtifact, downloadRelativeChatFileArtifact } from '@/service/chatFileArtifact';
import { resolvePreviewType } from '@/components/Preview/formats';
import { PREVIEWABLE } from '@/components/MessageList/components/FileRender';
import {
  createRelativePathResourceResolver,
  createRelativeResourceResolver,
} from '@/components/MessageList/components/FileRender/components/Previewer/relativeResource';
import type { MarkdownImageResolver } from '@/components/Preview/Md';

import previewStyle from '@/components/MessageList/components/FileRender/components/Previewer/index.module.less';
import styles from './index.module.less';

const getFileTypeFromUrl = (href?: string) => {
  if (!href) return '';

  try {
    const url = new URL(href, window.location.origin);
    const filePath = url.searchParams.get('filePath') || url.pathname;
    return filePath.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
  } catch {
    return href.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() || '';
  }
};

function ATag({ domNode, sessionId, messageId }: { domNode: any; sessionId?: string; messageId?: string }) {
  const intl = useIntl();
  const { href } = domNode.attribs || {};
  const name: string = get(domNode, 'children.0.data') || href || '';

  const { EventEmitter } = useGlobal();

  const [previewing, setPreviewing] = useState(false);

  const nameArr = name?.split('.');
  const fileType = resolvePreviewType((nameArr?.length > 1 ? nameArr?.pop() : '') || getFileTypeFromUrl(href), name);
  const relativeFile = isRelativeChatFileArtifactPath(href);

  const canPreview = !!href && PREVIEWABLE.includes(fileType.toLowerCase());
  const canDownload = !!href;
  const isLoading = previewing;

  const openOnDrawer = (previewInfo: {
    blob: Blob;
    resourceUrl?: string;
    resolvePreviewResource?: MarkdownImageResolver;
  }) => {
    const resolveRelativeResource =
      previewInfo.resolvePreviewResource || createRelativeResourceResolver(previewInfo.resourceUrl);
    EventEmitter.emit('beyond-main-driver-open-type', {
      title: name,
      width: '50vw',
      drawerType: 'preview',
      canClose: true,
      canFullScreen: true,
    });
    EventEmitter.emit('beyond-main-driver-message', {
      data: previewInfo.blob,
      type: fileType,
      title: name,
      className: previewStyle.preview,
      resolveMarkdownImage: resolveRelativeResource,
      resolveHtmlResource: resolveRelativeResource,
    });
  };

  const stopFileActionEvent = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onPreview = async (event: React.MouseEvent) => {
    stopFileActionEvent(event);
    if (!href) return;
    setPreviewing(true);
    try {
      if (relativeFile) {
        const { file, path } = await downloadRelativeChatFileArtifact({ href, sessionId, messageId });
        if (!(file instanceof Blob) || !file.size) throw new Error('Empty file');
        openOnDrawer({
          blob: file,
          resolvePreviewResource: createRelativePathResourceResolver(path, async (resourcePath) => {
            if (!sessionId) throw new Error('Missing session');
            return (await downloadChatFileArtifact({ sessionId, path: resourcePath })).file;
          }),
        });
      } else {
        const url = getFileUrl(href);
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(response.statusText);
        const blob = await response.blob();
        if (!blob.size) throw new Error('Empty file');
        openOnDrawer({ blob, resourceUrl: url });
      }
    } catch {
      message.warning(intl.formatMessage({ id: 'fileRender.previewUnavailable' }));
    } finally {
      setPreviewing(false);
    }
  };

  const onDownload = async (event: React.MouseEvent) => {
    stopFileActionEvent(event);
    if (!relativeFile) {
      downloadFile({ fileUrl: href, fileName: name });
      return;
    }
    setPreviewing(true);
    try {
      const { file, fileName } = await downloadRelativeChatFileArtifact({ href, sessionId, messageId });
      if (!(file instanceof Blob) || !file.size) throw new Error('Empty file');
      downloadFile({ file, fileName: fileName || name });
    } catch {
      message.warning(intl.formatMessage({ id: 'fileRender.previewUnavailable' }));
    } finally {
      setPreviewing(false);
    }
  };

  // 会话产物由消息级组件统一校验并渲染，避免这里用原始路径再生成一张不可鉴权的重复卡片。
  if (isManagedChatFileArtifactPath(href)) {
    if (/^(?:🔊\s*)?播放语音摘要$/.test(name.trim()) && ['mp3', 'wav', 'm4a', 'ogg'].includes(fileType)) return null;
    return <>{domToReact(domNode.children || [])}</>;
  }
  if (!href || !canPreview) return <>{domToReact([domNode])}</>;

  return (
    <>
      <div className={classnames(styles.fileItem, 'ub ub-ac overflow-hidden')}>
        <div className={classnames(styles.actionList, 'full-width full-height ub ub-ac ub-pc gap8')}>
          {!isLoading && canPreview && (
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer preview')}
              onClick={onPreview}
              title={intl.formatMessage({ id: 'common.preview' })}
            >
              <div className={classnames(styles.preview)}>
                <EyeOutlined style={{ fontSize: '18px' }} />
              </div>
            </div>
          )}
          {!isLoading && canDownload && (
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer download')}
              onClick={onDownload}
              title={intl.formatMessage({ id: 'common.download' })}
            >
              <CloudDownloadOutlined style={{ fontSize: '18px' }} />
            </div>
          )}
        </div>
        {isLoading && (
          <div className={classnames(styles.fileItemLoading, 'ub ub-ac ub-pc')}>
            <LoadingOutlined style={{ fontSize: '24px' }} />
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <IconRender fileType={fileType.toLowerCase()} />
        </div>
        <div className={classnames(styles.fileItemInfo, 'ub-f1 overflow-hidden')}>
          <p className={classnames(styles.fileItemName, 'textEllipsis')}>{name}</p>
          <div className="ub ub-pj">
            <p className={classnames(styles.fileItemMore, 'textEllipsis')}>{href}</p>
          </div>
        </div>
      </div>
    </>
  );
}

export default ATag;
