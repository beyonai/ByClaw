import React, { useState, useCallback, useMemo } from 'react';
import classnames from 'classnames';
import { createPortal } from 'react-dom';
import { Spin, message, Button } from 'antd';
import { get, isEmpty } from 'lodash';
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import Empty from '@/components/Empty';
import { Animated } from '@/components/Animated';
import MessagesModal from './components/Messages';

import styles from './index.module.less';
import achievementSpaceStyles from '@/pages/achievementSpace/index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

type IExtraInfoObj = {
  shareSourceType: 'chat' | 'collect';
  shareData: {
    content: string;
    type: string;
    id: string;
    previewName: string;
    previewUrl: string;
    fileType: string;
  };
  senderInfo: {
    userName: string;
    userId: string;
    userCode: string;
  };
};

type IMessageListItemContent = {
  substance: IExtraInfoObj;
};

export type IProps = {
  // message: IMessage;
  // updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  messageListItemContent: IMessageListItemContent;
};

function Share(props: IProps) {
  const { messageListItemContent } = props;

  const intl = useIntl();

  const { substance: extraInfoObj } = messageListItemContent;

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | Blob>();

  const [previewMeta, setPreviewMeta] = useState<{ name?: string; type?: string }>({});

  const [messageIds, setMessageIds] = useState<string>('');

  const shouldRenderPreview = previewVisible || previewLoading || !!previewContent;

  const handleClosePreview = useCallback(() => {
    setPreviewVisible(false);
    setPreviewContent(undefined);
    setPreviewMeta({});
  }, []);

  const handlePreview = useCallback(
    async (record?: IExtraInfoObj['shareData']) => {
      if (!record || isEmpty(record)) return;
      console.log(record);
      const { previewName, fileType } = record;
      let { previewUrl } = record;

      if (!previewUrl) {
        message.error(intl.formatMessage({ id: 'common.previewNoUrl' }));
        return;
      }
      if (previewUrl.startsWith('/WaManagerService')) {
        previewUrl = `/byaiService${previewUrl}`;
      }

      setPreviewMeta({
        name: previewName,
        type: fileType,
      });
      setPreviewContent(undefined);
      setPreviewVisible(true);
      setPreviewLoading(true);

      try {
        const response = await fetch(previewUrl);
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const blob = await response.blob();

        setPreviewContent(blob);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(intl.formatMessage({ id: 'notice.messageComp.share.previewFailed' }), error);
        message.error(intl.formatMessage({ id: 'common.previewFailed' }));
        setPreviewVisible(false);
        setPreviewContent(undefined);
        setPreviewMeta({});
      } finally {
        setPreviewLoading(false);
      }
    },
    [intl]
  );

  const paragraph = useMemo(() => {
    let textKey = 'notice.messageComp.share.oneMessage';

    if (extraInfoObj.shareSourceType === 'chat') {
      textKey = 'notice.messageComp.share.messageRecord';
    }

    if (extraInfoObj.shareSourceType === 'collect') {
      const type = get(extraInfoObj, 'shareData.type');
      switch (type) {
        case 'chat':
          textKey = 'notice.messageComp.share.messageRecord';
          break;
        case 'image':
          textKey = 'notice.messageComp.share.image';
          break;
        case 'ppt':
          textKey = 'notice.messageComp.share.ppt';
          break;
        case 'md':
        case 'text':
          textKey = 'notice.messageComp.share.document';
          break;
        case 'excel':
          textKey = 'notice.messageComp.share.excel';
          break;
        case 'pdf':
          textKey = 'notice.messageComp.share.pdf';
          break;
        case 'record':
          textKey = 'notice.messageComp.share.record';
          break;
        default:
          break;
      }
    }

    const text = intl.formatMessage({ id: textKey });
    const userName = extraInfoObj?.senderInfo?.userName || intl.formatMessage({ id: 'common.user' });
    return intl.formatMessage({ id: 'notice.messageComp.share.shareMessage' }, { userName, text });
  }, [extraInfoObj, intl]);

  return (
    <>
      <div className={classnames(styles.wrapper, 'mW600')}>
        <div className={classnames(styles.header, 'ub ub-ac')}>{intl.formatMessage({ id: 'common.shareTitle' })}</div>
        <div className={classnames(styles.content, 'ub gap8 ub-ver')}>
          <p>{paragraph}</p>
          <Button
            block
            className={classnames(styles.more)}
            onClick={() => {
              if (extraInfoObj.shareSourceType === 'chat') {
                setMessageIds(get(extraInfoObj, 'shareData.messageIds') || '');
              }
              if (extraInfoObj.shareSourceType === 'collect') {
                if (get(extraInfoObj, 'shareData.type') === 'chat') {
                  setMessageIds(get(extraInfoObj, 'shareData.content') || '');
                } else {
                  handlePreview(get(extraInfoObj, 'shareData'));
                }
              }
            }}
            loading={previewLoading}
          >
            {intl.formatMessage({ id: 'achievementSpace.action.viewDetail' })}
          </Button>
        </div>
      </div>

      {shouldRenderPreview &&
        createPortal(
          <Animated
            active={previewVisible}
            compute={(opened) => ({
              className: opened ? achievementSpaceStyles.previewFullscreen : achievementSpaceStyles.previewNone,
            })}
          >
            <div className={achievementSpaceStyles.previewPanel}>
              {previewLoading && (
                <div className={achievementSpaceStyles.previewLoading}>
                  <Spin />
                </div>
              )}
              {!previewLoading && previewContent && (
                <React.Suspense fallback={<Spin />}>
                  <PreViewFile
                    data={previewContent}
                    type={previewMeta.type as any}
                    title={previewMeta.name}
                    className={achievementSpaceStyles.previewTwins}
                    extra={
                      <span className={achievementSpaceStyles.previewCloseIcon}>
                        <AntdIcon type="icon-a-Closeguanbi1" onClick={handleClosePreview} />
                      </span>
                    }
                  />
                </React.Suspense>
              )}
              {!previewLoading && !previewContent && (
                <div className={achievementSpaceStyles.previewEmpty}>
                  <Empty description={intl.formatMessage({ id: 'achievementSpace.preview.noContent' })} />
                </div>
              )}
            </div>
          </Animated>,
          document.body
        )}

      <MessagesModal messageIds={messageIds} setMessageIds={setMessageIds} />
    </>
  );
}
export default Share;
