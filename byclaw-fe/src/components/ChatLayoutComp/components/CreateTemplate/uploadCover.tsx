import React, { useMemo, useCallback, useEffect } from 'react';
import classnames from 'classnames';
import { noop } from 'lodash';
import UploadFile from './UploadFile';
import { DeleteOutlined, PlusOutlined, DownloadOutlined } from '@ant-design/icons';
import styles from './index.module.less';
import { message, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { getFileUrl, downloadFile } from '@/utils/file';
import { downloadMinIOFileURL } from '@/service/file';

export default function UploadCover(props: { value?: string; onChange?: (value: string) => void; sessionId?: string }) {
  const { value, onChange, sessionId } = props;
  const intl = useIntl();

  const [isUploadingImg, setIsUploadingImg] = React.useState(false);
  const [coverDownloadMeta, setCoverDownloadMeta] = React.useState<string>('');

  const imageUrl = useMemo(() => {
    if (!coverDownloadMeta) {
      return '';
    }

    return getFileUrl(coverDownloadMeta);
  }, [coverDownloadMeta]);

  const clearImage = useCallback(() => {
    onChange?.('');
  }, [onChange]);

  const handleDownload = useCallback(async () => {
    if (!imageUrl) {
      message.warning(intl.formatMessage({ id: 'common.downloadFailed' }));
      return;
    }

    try {
      downloadFile({
        fileUrl: imageUrl,
        fileName: 'cover.jpg',
      });
    } catch (error) {
      console.error(error);
      message.error(intl.formatMessage({ id: 'common.downloadFailed' }));
    }
  }, [imageUrl, intl]);

  const beforeUpload = useCallback(
    (payload: { file?: File }) => {
      const { file } = payload;
      if (!file) {
        return false;
      }
      const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
      if (!isJpgOrPng) {
        message.error(intl.formatMessage({ id: 'createTemplate.uploadCover.onlyJpgPng' }));
      }
      const isLt2M = file.size / 1024 / 1024 < 2;
      if (!isLt2M) {
        message.error(intl.formatMessage({ id: 'createTemplate.uploadCover.imageSizeLimit' }));
      }
      return isJpgOrPng && isLt2M;
    },
    [intl]
  );

  const onCreate = useCallback(
    (payload: { file?: File }) => {
      if (beforeUpload(payload)) {
        setIsUploadingImg(true);
        return true;
      }
      return false;
    },
    [beforeUpload]
  );

  const onUpdate = useCallback(
    (result: { queryFile?: Record<string, unknown> & { fileId?: React.Key; fileUrl?: string } }) => {
      console.log(result);
      if (result.queryFile) {
        onChange?.(`${result.queryFile.fileId}`);
        setCoverDownloadMeta(result.queryFile?.fileUrl || '');
      }
      setIsUploadingImg(false);
    },
    [onChange]
  );

  const onError = useCallback(() => {
    setIsUploadingImg(false);
  }, []);

  const uploadCoverPayload = React.useMemo(() => {
    return {
      sessionType: 'AGENT',
      sessionId: sessionId || '',
    };
  }, [sessionId]);

  const uploadButton = useMemo(
    () => (
      <div className="ub ub-ver ub-ac ub-pc full-height">
        <PlusOutlined />
        <div style={{ marginTop: 8 }}>{intl.formatMessage({ id: 'createTemplate.uploadCover.upload' })}</div>
      </div>
    ),
    [intl]
  );

  useEffect(() => {
    if (!value) {
      return;
    }

    const q = new URLSearchParams();
    q.set('fileId', String(value));
    setCoverDownloadMeta(`${downloadMinIOFileURL}?${q.toString()}`);
  }, [value]);

  return (
    <div className="ub ub-ae gap8">
      <UploadFile
        setSessionId={noop}
        onRemove={onError}
        onCreate={onCreate}
        onUpdate={onUpdate}
        listType="picture-card"
        accept="image/*"
        extendsPayload={uploadCoverPayload}
        className={classnames('avatar-uploader', styles.uploadWrapper)}
      >
        <div className={classnames(styles.imageContainer, 'pointer')}>
          <Spin spinning={isUploadingImg} wrapperClassName="full-height-spin">
            {imageUrl && <img src={imageUrl} alt="cover" className={styles.uploadedImage} />}
            {value && (
              <div className={styles.deleteOverlay}>
                <DownloadOutlined
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload();
                  }}
                  className={styles.actionIcon}
                />
                <DeleteOutlined
                  onClick={(e) => {
                    e.stopPropagation();
                    clearImage();
                  }}
                  className={styles.actionIcon}
                />
              </div>
            )}
            {!imageUrl && uploadButton}
          </Spin>
        </div>
      </UploadFile>
      <div style={{ color: '#A4AAB2', fontSize: 12 }}>
        <div>{intl.formatMessage({ id: 'createTemplate.uploadCover.thumbnailRatio' }, { ratio: '3:4' })}</div>
        <div>{intl.formatMessage({ id: 'createTemplate.uploadCover.fileSizeLimit' }, { size: '2MB' })}</div>
      </div>
    </div>
  );
}
