import React from 'react';

import Bot from './Bot';
import BirthdayCard, { IMyProps as IBirthdayCardProps } from './BirthdayCard';
import Tools, { IMyProps as IToolsProps } from './Tools';

import type { IMessage } from '@/typescript/message';

export type IMessageListItemContent = {
  substance: {
    integrationType?: string;
  };
};

export type IBaseProps = {
  message: IMessage;
  messageIdx: number;
  updateMessageListItemContent: (
    messageListItemContent: IMessageListItemContent & IBirthdayCardProps['messageListItemContent']
  ) => void;
  messageListItemContent: IMessageListItemContent;
};

export type IProps = IBaseProps | IToolsProps | IBirthdayCardProps;

function SlientHandler(props: IProps) {
  const { messageListItemContent } = props;
  const { substance } = messageListItemContent;

  const { integrationType } = substance;

  return (
    <>
      {!integrationType && <Bot {...props} />}
      {integrationType === 'TOOLS' && <Tools {...(props as IToolsProps)} />}
      {integrationType === 'BIRTHDAY_CARD' && <BirthdayCard {...(props as IBirthdayCardProps)} />}
    </>
  );
}

export default SlientHandler;
