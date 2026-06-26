import React, { useState } from 'react';
import { get } from 'lodash';
import classnames from 'classnames';
import { useIntl } from '@umijs/max';
import { CloudDownloadOutlined, LoadingOutlined, EyeOutlined } from '@ant-design/icons';
import useGlobal from '@/hooks/useGlobal';

import IconRender from '@/components/MessageList/components/FileRender/components/IconRender';

import { downloadFile, getFileUrl } from '@/utils/file';
import { PREVIEWABLE } from '@/components/MessageList/components/FileRender';

import previewStyle from '@/components/MessageList/components/FileRender/components/Previewer/index.module.less';
import styles from './index.module.less';

const previewCaches: Record<string, Blob> = {};

function ATag({ domNode }: { domNode: any }) {
  const intl = useIntl();
  const { href } = domNode.attribs || {};
  const name: string = get(domNode, 'children.0.data') || href || '';

  const { EventEmitter } = useGlobal();

  const [previewing, setPreviewing] = useState(false);

  const nameArr = name?.split('.');
  const fileType = (nameArr?.length > 1 ? nameArr?.pop() : '') || '';

  const canPreview = !!href && PREVIEWABLE.includes(fileType.toLowerCase());
  const canDownload = !!href;
  const isLoading = previewing;

  const openOnDrawer = (previewInfo: { blob: Blob | null }) => {
    EventEmitter.emit('beyond-main-driver-open-type', {
      width: '50vw',
      drawerType: 'preview',
      canClose: true,
    });
    EventEmitter.emit('beyond-main-driver-message', {
      data: previewInfo.blob,
      type: fileType,
      title: name,
      className: previewStyle.preview,
    });
  };

  const onPreview = () => {
    if (!href) return;
    const url = getFileUrl(href);

    if (previewCaches[url]) {
      openOnDrawer({ blob: previewCaches[url] });
      return;
    }

    setPreviewing(true);
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => {
        previewCaches[url] = blob;
        openOnDrawer({ blob });
      })
      .catch((error) => {
        console.error(error);
        // setPreviewInfo((prev) => ({ ...prev, open: false, loading: false }));
      })
      .finally(() => {
        setPreviewing(false);
      });
  };

  if (!href) return domNode;

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
              onClick={() => downloadFile({ fileUrl: href, fileName: name })}
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
