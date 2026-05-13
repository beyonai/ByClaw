import Markdown from '@/components/Markdown';
import { downloadResourceFile, normalizeDatasetDirectoryPath } from '@/service/file';
import { downloadFile } from '@/utils/file';
import { LoadingOutlined } from '@ant-design/icons';
import { Button, Drawer, Space, Tag, Typography, message, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AntdIcon from '../AntdIcon';
import { downloadFile as downloadFileService } from '@/service/workSpace';
import { RenderSourceIcon } from '@/components/ReferenceSource';
import styles from './index.module.less';

const Office = React.lazy(() => import('@/components/Preview/Office').then((module) => ({ default: module.Office })));

const { Title, Paragraph } = Typography;
interface IProps {
  drawerOpen: boolean;
  detailInfo: any;
  setShowDetail: (showDetail: boolean) => void;
}

const DetailDrawer = (props: IProps) => {
  const { drawerOpen, detailInfo, setShowDetail } = props;

  const intl = useIntl();
  const { title = '', chunkList = [] } = detailInfo || {};
  const documentId = detailInfo?.documentId ?? detailInfo?.id;

  const [activeTab, setActiveTab] = useState('sourceDetail');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const abortController = useRef<AbortController | undefined>(undefined);
  const [file, setFile] = useState<Blob>();

  const handleDownload = useCallback(async () => {
    const resourceId = detailInfo?.resourceId ?? detailInfo?.datasetId;
    const directoryPathRaw =
      detailInfo?.directoryPath ??
      (detailInfo?.title ? (String(detailInfo.title).startsWith('/') ? detailInfo.title : `/${detailInfo.title}`) : '');
    if (resourceId === null || resourceId === undefined || `${resourceId}` === '' || !directoryPathRaw) {
      message.warning(intl.formatMessage({ id: 'sourceDrawer.downloadFailed' }));
      return;
    }

    try {
      setDownloading(true);
      const res = await downloadResourceFile({
        resourceId,
        directoryPath: normalizeDatasetDirectoryPath(directoryPathRaw),
      });
      downloadFile(res);
    } catch (error: any) {
      console.error(error);
      message.error(error || intl.formatMessage({ id: 'sourceDrawer.downloadFailed' }));
    } finally {
      setDownloading(false);
    }
  }, [detailInfo, intl]);

  // 预览文件
  const previewDocument = useCallback(async () => {
    if (!documentId) {
      message.warning(intl.formatMessage({ id: 'sourceDrawer.previewComponentNotReady' }));
      return;
    }

    if (abortController.current?.signal.aborted) return;

    setLoading(true);

    const supportedOfficeFormats = ['xlsx', 'docx', 'pdf', 'pptx'];
    const fileExtension = title?.split('.').pop()?.toLowerCase() || '';

    if (!supportedOfficeFormats.includes(fileExtension)) {
      message.info(intl.formatMessage({ id: 'sourceDrawer.previewNotSupported' }));
      setLoading(false);
      return;
    }

    try {
      abortController.current = new AbortController();
      const fileRes = await downloadFileService(
        { fileId: documentId },
        { cancelToken: abortController.current.signal }
      );
      abortController.current = undefined;
      if (fileRes?.file) {
        console.log({ fileRes });

        setFile(new File([fileRes.file], fileRes.fileName));
      }
    } catch (error: any) {
      if (!abortController.current?.signal.aborted) {
        console.error(error);
        message.error(error.message || error || intl.formatMessage({ id: 'sourceDrawer.previewFailed' }));
      }
    } finally {
      setLoading(false);
    }
  }, [documentId, title, intl]);

  const renderTitle = useMemo(() => {
    return (
      <>
        <div className={classnames(styles.headerBox, 'ub ub-ac ub-pj mb-16')}>
          <div className="ub ub-ac">
            <AntdIcon
              type="icon-a-Leftzuo"
              onClick={() => setShowDetail(false)}
              style={{ fontSize: 20, marginRight: 8 }}
            />
            <RenderSourceIcon title={title} fontSize={20} />
            <Title level={5} ellipsis={{ rows: 1, tooltip: title }} style={{ margin: '0 0 0 8px', width: 300 }}>
              {title}
            </Title>
          </div>
          <Space>
            {downloading ? (
              <LoadingOutlined />
            ) : (
              <AntdIcon
                type="icon-a-Downloadxiazai"
                style={{ fontSize: 20 }}
                onClick={() => {
                  handleDownload();
                }}
              />
            )}
          </Space>
        </div>
        <Space>
          <Button
            className={styles.tabBtn}
            size="small"
            color="default"
            variant={activeTab === 'pagePreview' ? 'solid' : 'outlined'}
            onClick={() => {
              setActiveTab('pagePreview');
              setFile(undefined);
              previewDocument();
            }}
          >
            {intl.formatMessage({ id: 'sourceDrawer.filePreview' })}
          </Button>
          <Button
            className={styles.tabBtn}
            size="small"
            color="default"
            variant={activeTab === 'sourceDetail' ? 'solid' : 'outlined'}
            onClick={() => {
              setActiveTab('sourceDetail');
              abortController.current?.abort();
              if (loading) {
                setLoading(false);
              }
            }}
          >
            {`${intl.formatMessage({ id: 'sourceDrawer.referenceDetails' })} (${chunkList?.length})`}
          </Button>
        </Space>
      </>
    );
  }, [
    title,
    activeTab,
    chunkList,
    loading,
    downloading,
    abortController.current,
    handleDownload,
    previewDocument,
    intl,
  ]);

  useEffect(
    () => () => {
      setLoading(false);
      setActiveTab('sourceDetail');
      abortController.current?.abort();
      abortController.current = undefined;
    },
    [drawerOpen]
  );

  return (
    <Drawer
      open={drawerOpen}
      footer={null}
      mask={false}
      closeIcon={null}
      title={renderTitle}
      width={650}
      styles={{
        header: {
          color: `var(--${PREFIX_NAME}-color-text)`,
          fontWeight: 500,
          padding: '8px 12px',
        },
        body: {
          padding: 16,
          backgroundColor: activeTab === 'pagePreview' ? '#F0F1F2' : undefined,
        },
      }}
    >
      <div
        className="full-width full-height overflow-auto ub-ver"
        style={{
          display: activeTab === 'sourceDetail' ? 'flex' : 'none',
        }}
      >
        {chunkList.map((item: any, index: number) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { content, title, type, id } = item;

          return (
            <div key={id} className={classnames(styles.sourceItem, 'ub ub-ver gap8')}>
              <div className="ub ub-ac ub-pj pr-16">
                <span className={styles.sourceTitle}>
                  <span className={styles.symbol}>&quot;</span> {intl.formatMessage({ id: 'common.quote' })}
                  {index + 1}
                </span>
                <Space>
                  <Tag className={styles.idTag}># {id}</Tag>
                </Space>
              </div>
              <Paragraph className={styles.content}>
                <Markdown text={content} />
              </Paragraph>
            </div>
          );
        })}
      </div>
      {activeTab === 'pagePreview' && (
        <React.Suspense fallback={<Spin />}>
          <Office loading={loading} data={file} fileName={title} />
        </React.Suspense>
      )}
    </Drawer>
  );
};

export default DetailDrawer;
