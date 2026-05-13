// tslint:disable:ordered-imports
import React from 'react';
import classnames from 'classnames';
import { isEmpty } from 'lodash';
import CarouselFile from '@/components/MessageList/components/CarouselFile';

import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';

export type IMessageListItemContent = {
  substance: Array<{
    fileId: string;
    fileSize: number;
    fileName: string;
    fileUrl: string;
    fileType: string;
    path: string;
  }>;
};

export type IProps = {
  // eslint-disable-next-line react/no-unused-prop-types
  message: IMessage;
  // eslint-disable-next-line react/no-unused-prop-types
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

function ThinkResourceFile(props: IProps) {
  const { messageListItemContent, message } = props;
  const { substance } = messageListItemContent;

  const items: any[] = [];
  items.push(
    ...(substance || []).map((file) => {
      return {
        fileItem: {
          uid: file.fileId,
          downloadUrl: file.fileUrl,
          status: 'done', // 'uploading' | 'done';
          fileType: 'file',
          queryFile: {
            ...file,
            length: file.fileSize,
          },
        },
        renderFileType: 'file',
        canQuote: true,
        canCollect: true,
      };
    })
  );

  if (!items || isEmpty(items)) return null;

  return (
    <div className={classnames(styles.thinkResourceFile)}>
      <CarouselFile items={items} message={message} />
    </div>
  );
}

export default ThinkResourceFile;
