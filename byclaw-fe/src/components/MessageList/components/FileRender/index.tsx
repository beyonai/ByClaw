import { formatBytes } from '@/utils/file';
import { Popconfirm } from 'antd';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import React from 'react';
import { isFunction, get } from 'lodash';

import { CloseOutlined, CloudDownloadOutlined, LoadingOutlined, EnterOutlined, EyeOutlined } from '@ant-design/icons';
import IconRender from './components/IconRender';
import Previewer from './components/Previewer';
import usePreview from './components/Previewer/usePreview';
import useGlobal from '@/hooks/useGlobal';
import useDownload from './useDownload';

import { LayoutMode } from '@/constants/system';

import type { IFile } from '@/typescript/file';

import styles from './index.module.less';
import { IMessage } from '@/typescript/message';

export type IFileRender = {
  fileItem: IFile;
  renderFileType?: 'file';
  canQuote?: boolean;
  canCollect?: boolean;
};

export type IProps = {
  onClose?: (fileItem: IFileRender) => void;
  rightBottomRender?: (fileItem: IFileRender) => React.ReactNode;
  message?: IMessage;
} & IFileRender;

function FileRender(props: IProps) {
  const { fileItem, onClose, rightBottomRender, canQuote } = props;
  const intl = useIntl();
  // const { messageId, collectIds = [] } = message || {};
  console.log(props);
  const { EventEmitter, layoutMode } = useGlobal();
  const { onPreview, previewInfo, onClosePreviewModal, previewing } = usePreview();
  const { handleDownload, downloadFile, downloading } = useDownload();

  const { file, imgUrl, uid, status, queryFile, downloadUrl } = fileItem;

  const size = get(queryFile, 'length') || file?.size;
  const name = get(queryFile, 'fileName') || file?.name;

  const isPreviewMode = layoutMode === LayoutMode.preview;

  const nameArr = name?.split('.');

  const fileType = queryFile?.fileType || nameArr?.pop();
  const fileName = nameArr?.join('.');

  const canDownload = downloadUrl || queryFile?.fileUrl || queryFile?.fileId;
  const canPreview = [
    'h5',
    'txt',
    'html',
    'pdf',
    'md',
    'image',
    'jpg',
    'json',
    'png',
    'gif',
    'bmp',
    'webp',
    'pptx',
    'docx',
    'xlsx',
  ].includes(fileType);

  const isLoading = status === 'uploading' || previewing || downloading;

  const moreDesc = () => {
    if (fileItem.useType === 'outline') {
      return <div className={styles.useTypeOutline}>{intl.formatMessage({ id: 'fileRender.outlineImitate' })}</div>;
    }
    if (fileItem.useType === 'content') {
      return <div className={styles.useTypeContent}>{intl.formatMessage({ id: 'fileRender.contentExtract' })}</div>;
    }
    if (fileItem.useType === 'template') {
      return <div className={styles.useTypeContent}>{intl.formatMessage({ id: 'fileRender.writingTemplate' })}</div>;
    }
    return null;
  };

  if (!file && !queryFile) return null;

  return (
    <>
      <div className={classnames(styles.fileItem, 'ub ub-ac overflow-hidden')} key={uid}>
        <div className={classnames(styles.actionList, 'full-width full-height ub ub-ac ub-pc gap8')}>
          {!isLoading && canPreview && (
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer preview')}
              onClick={() => onPreview(fileItem)}
              title={intl.formatMessage({ id: 'common.preview' })}
            >
              {/* 预览 */}
              <div className={classnames(styles.preview)}>
                <EyeOutlined style={{ fontSize: '18px' }} />
              </div>
            </div>
          )}
          {!isLoading && canDownload && !isPreviewMode && (
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer download')}
              onClick={() => {
                if (downloadUrl || queryFile?.fileUrl) {
                  downloadFile({
                    fileUrl: downloadUrl || queryFile?.fileUrl,
                    fileName: name,
                  });
                } else if (queryFile?.fileId) {
                  void handleDownload(queryFile?.fileId);
                }
              }}
              title={intl.formatMessage({ id: 'common.download' })}
            >
              {/* 下载 */}
              <CloudDownloadOutlined style={{ fontSize: '18px' }} />
            </div>
          )}
          {!isLoading && canDownload && canQuote && !isPreviewMode && (
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer cite')}
              onClick={() => {
                EventEmitter.emit('queryInput-push-fileList', {
                  ...fileItem,
                  queryFile: {
                    ...(queryFile || {}),
                    // 统一处理，如果没有fileUrl的话，则使用fileId
                    fileUrl: queryFile?.fileUrl || queryFile?.fileId,
                  },
                });
              }}
              title={intl.formatMessage({ id: 'common.quote' })}
            >
              {/* 引用 */}
              <EnterOutlined style={{ fontSize: '18px' }} />
            </div>
          )}
          {/* 添加到知识库 */}

          {/* 收藏 */}
          {/* {!isLoading && myCanCollect && !isPreviewMode && (
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer cite')}
              onClick={() => {
                handleCollectClick();
              }}
              title={intl.formatMessage({ id: 'common.collect' })}
            >
              <AntdIcon
                type="icon-a-Starxingxing"
                style={{ fontSize: '18px', color: isCollected ? '#F7BA1E' : undefined }}
              />
            </div>
          )} */}
          {isFunction(onClose) && (
            <Popconfirm
              title={intl.formatMessage({ id: 'fileRender.deleteConfirm' })}
              onConfirm={() => {
                onClose({
                  fileItem,
                  renderFileType: 'file',
                });
              }}
            >
              <div className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer delete')}>
                <CloseOutlined style={{ fontSize: '18px', color: 'red' }} />
              </div>
            </Popconfirm>
          )}
        </div>
        {isLoading && (
          <div className={classnames(styles.fileItemLoading, 'ub ub-ac ub-pc')}>
            <LoadingOutlined style={{ fontSize: '24px' }} />
          </div>
        )}
        <div style={{ position: 'relative' }}>
          {imgUrl && <img src={imgUrl} alt="" className={styles.fileItemIcon} />}
          {!imgUrl && <IconRender fileType={(fileType || '').toLowerCase()} />}
        </div>
        <div className={classnames(styles.fileItemInfo, 'ub-f1 overflow-hidden')}>
          <p className={classnames(styles.fileItemName, 'textEllipsis')}>{fileName}</p>
          <div className="ub ub-pj">
            <p className={classnames(styles.fileItemMore, 'textEllipsis')}>
              {fileType} {!!size && `· ${formatBytes(size)}`}
            </p>
            {rightBottomRender?.({
              fileItem,
              renderFileType: 'file',
            })}
            {moreDesc()}
          </div>
        </div>
      </div>
      <Previewer
        previewInfo={previewInfo}
        onClosePreviewModal={onClosePreviewModal}
        fileType={fileType}
        fileName={fileName}
      />
    </>
  );
}

export default FileRender;
