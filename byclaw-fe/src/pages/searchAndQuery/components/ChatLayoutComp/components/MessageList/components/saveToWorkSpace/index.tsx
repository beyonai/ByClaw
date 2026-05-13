import React, { useContext } from 'react';
import { Button, message } from 'antd';
import { get, debounce } from 'lodash';
import { customAlphabet } from 'nanoid';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';

import { createBatch } from '@/service/session';
import { uploadFiles } from '@/service/file';
import { getFileUrl } from '@/utils/file';
import useGlobal from '@/hooks/useGlobal';

import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';

import { SSEMessageType } from '@/constants/message';

import type { IQueryFile, IFile } from '@/typescript/file';
import type { IMessage } from '@/typescript/message';

import styles from '@/components/MessageList/index.module.less';

const SaveToWorkSpace = (props: { msg: IMessage }) => {
  const { msg } = props;
  const intl = useIntl();
  const { sessionId, agentInfo, EventEmitter } = useGlobal();
  const { getMessageList } = useContext(ChatLayoutCompContext);
  const getNanoid = React.useRef<(size?: number) => string>(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 10));

  const [isLoading, setIsLoading] = React.useState(false);
  const [isSuccess, setIsSuccess] = React.useState(false);

  const myUploadFile = React.useCallback(
    (rawFile: File): Promise<IFile> => {
      return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('files', rawFile);
        formData.append('sessionType', 'AGENT');
        formData.append('sessionId', `${sessionId || ''}`);
        formData.append('agentId', `${agentInfo?.agentId || ''}`);

        uploadFiles(formData)
          .then((data: { sessionId: string; sessionDatasetid: string; rebuildFileList: IQueryFile[] }) => {
            const queryFile = get(data, 'rebuildFileList.0');
            if (queryFile) {
              const fileItem = {
                uid: getNanoid.current(),
                file: rawFile,
                downloadUrl: getFileUrl(queryFile.fileUrl),
                status: 'done',
                fileType: 'file',
                queryFile,
              };

              resolve(fileItem);
            } else {
              reject(new Error('上传失败'));
            }
          })
          .catch(reject);
      });
    },
    [agentInfo?.agentId]
  );

  const setSuccessTimeout = React.useCallback(() => {
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
    }, 5000);
  }, []);

  const mySaveToWorkSpace = React.useCallback((content: string = '', fileName: string = '') => {
    const textFile = new File([content], fileName, { type: 'text/plain' });

    setIsLoading(true);

    myUploadFile(textFile).then((fileItem: IFile) => {
      return createBatch({
        sessionId,
        relConut: 0,
        fileList: [
          {
            name: fileItem.queryFile?.fileName,
            fileId: fileItem.queryFile?.fileId,
            fileUrl: fileItem.queryFile?.fileUrl,
          },
        ],
      })
        .then((result) => {
          setSuccessTimeout();
          EventEmitter.emit('beyond-workspace-add-documentitem', result);
        })
        .finally(() => {
          setIsLoading(false);
        });
    });
  }, []);

  const onClickSave = debounce(() => {
    if (isLoading) return;

    let messageContent = '';
    let fileName = `${msg?.creatorName || '我的'}的收藏_${new Date().getTime()}.txt`;

    const messageList = getMessageList?.() || [];
    const currMessageIndex = messageList.findIndex((item) => item.msgId === msg?.msgId);
    const prevMessage = messageList[currMessageIndex - 1];
    if (prevMessage && !prevMessage?.fromBeyond) {
      fileName = `${get(prevMessage, 'text', '')}_${new Date().getTime()}.txt`;
    }

    msg?.messageList?.forEach((item) => {
      const { contentType } = item;
      if (`${contentType}` === `${SSEMessageType.text}`) {
        messageContent += `${get(item, 'content.substance', '')}\n\n`;
      }
    });

    if (!messageContent) {
      message.error('内容不能为空！');
      return;
    }

    mySaveToWorkSpace(messageContent, fileName);
  }, 300);

  return (
    <Button
      type="text"
      size="small"
      icon={
        <>
          {!isSuccess && <AntdIcon type="icon-a-Starxingxing" className={styles.icon} />}
          {isSuccess && (
            <AntdIcon
              type="icon-a-Check-smallxiaoyan-xiao1"
              className={styles.icon}
              style={{ color: 'var(--beyond-color-success)' }}
            />
          )}
        </>
      }
      onClick={onClickSave}
      loading={isLoading}
    >
      <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.saveToWorkSpace' })}</span>
    </Button>
  );
};

export default SaveToWorkSpace;
