import { SSEMessageType } from '@/constants/message';
import { CloseOutlined, CopyOutlined, DownloadOutlined, SaveOutlined } from '@ant-design/icons';
import Writer, { IWritingEditorProps, PageMode } from '@whalecloud/writing-editor';
import '@whalecloud/writing-editor/dist/style.css';
import { App, Button, Divider } from 'antd';
import copy from 'copy-to-clipboard';
import throttle from 'lodash/throttle';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './index.module.less';
// @ts-ignore
import { useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';

interface IMessageCallbackData {
  messageId: string;
  messageList: {
    content: {
      substance: {
        docId?: React.Key;
        templateId?: React.Key;
        content: string;
      };
    };
    contentType: SSEMessageType;
  }[];
}

Writer.config({
  saveDocFileContentUrl: 'aiDoc/saveBaiYingContentFile',
});

interface Props extends Pick<IWritingEditorProps, 'docId' | 'templateId'> {
  onClose: () => void;
  saveExtraPayload?: any;
  onUpdateMessage?: (msg: IMessageCallbackData) => void;
  onCreateMessage?: (msg: IMessageCallbackData) => void;
}

export default function WisdomPen(props: Props) {
  const { docId, templateId, onClose, onUpdateMessage, onCreateMessage, saveExtraPayload } = props;
  const { message } = App.useApp();
  const writerRef = React.useRef<Writer>(null);
  const messageId = useRef<string>();
  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const [saveLoading, setSaveLoading] = useState(false);

  const handleCopy = useCallback(() => {
    const text = writerRef.current?.getText();
    if (text) {
      copy(text);
      message.success(intl.formatMessage({ id: 'common.copySuccess' }));
    }
  }, [intl]);

  const getMsg = useCallback(
    (messageId: string, content: string): IMessageCallbackData => {
      return {
        messageId,
        messageList: [
          {
            content: {
              substance: {
                docId,
                templateId,
                content,
              },
            },
            contentType: SSEMessageType.article,
          },
        ],
      };
    },
    [docId, templateId]
  );

  const _updateMessage = useMemo(() => {
    return throttle((content: string) => {
      if (messageId.current && onUpdateMessage) {
        const msg = getMsg(messageId.current, content);
        onUpdateMessage(msg);
      }
    }, 100);
  }, [getMsg, onUpdateMessage]);

  /**
   * @isManual 是否手动触发保存
   */
  const handleSave = (isManual: boolean) => {
    if (isManual) {
      setSaveLoading(true);
    }
    const isNew = !messageId.current;
    writerRef.current
      ?.save(saveExtraPayload)
      ?.then((data: { messageId: string; content: string }) => {
        console.log(data.content);
        if (isManual) {
          message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
        }
        const msg = getMsg(data.messageId, data.content);
        if (isNew) {
          messageId.current = data.messageId;
          if (onCreateMessage) {
            onCreateMessage(msg);
          }
        } else {
          _updateMessage(data.content);
        }
      })
      .finally(() => setSaveLoading(false));
  };

  const beforeClose = useCallback(() => {
    handleSave(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    messageId.current = saveExtraPayload.messageId || '';
  }, [docId]);

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <Button color="default" variant="text" icon={<CopyOutlined />} onClick={handleCopy}>
          {intl.formatMessage({ id: 'common.copy' })}
        </Button>
        <Button
          color="default"
          variant="text"
          icon={<SaveOutlined />}
          loading={saveLoading}
          onClick={() => handleSave(true)}
        >
          {intl.formatMessage({ id: 'common.save' })}
        </Button>
        <Button
          color="default"
          variant="text"
          icon={<DownloadOutlined />}
          onClick={() => writerRef.current?.download()}
        >
          {intl.formatMessage({ id: 'common.download' })}
        </Button>
        <Divider type="vertical" />
        <CloseOutlined className={styles.close} onClick={beforeClose} />
      </header>
      <article className={styles.article}>
        <Writer
          antPrefix={`${PREFIX_NAME}`}
          actionBar={{
            hidden: ['save', 'export', 'search', 'print'],
          }}
          messageApi={message}
          ref={writerRef}
          docId={docId}
          templateId={templateId}
          onStreamStatusChange={(isStreaming) => {
            EventEmitter.emit('beyond-input-disabled', isStreaming);
            if (!isStreaming) {
              _updateMessage(JSON.stringify(writerRef.current?.getInstance()?.command.getValue().data ?? {}));
            }
          }}
          options={
            {
              marginIndicatorSize: 0,
              margins: [32, 118, 32, 118],
              pageMode: PageMode.CONTINUITY,
            } as IEditorOption
          }
        />
      </article>
    </div>
  );
}
