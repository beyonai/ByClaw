import { useDispatch } from '@umijs/max';
import React from 'react';

import useRegBotEventHooks from '@/hooks/useRegBotEventHooks';

import type { IProps } from './index';

function Bot(props: IProps) {
  const { messageListItemContent, message, messageIdx } = props;
  const { substance } = messageListItemContent;

  const dispatch = useDispatch();

  const [canShow, setCanShow] = React.useState(false);

  const { pageFunc } = useRegBotEventHooks({
    message,
    messageIdx,
  });

  React.useEffect(() => {
    dispatch({
      type: 'bot/botLogin',
    }).then((res: boolean) => {
      if (res) {
        setCanShow(true);
      }
    });
  }, []);

  React.useEffect(() => {
    if (!canShow) return;

    const { parameters, funcCode } = substance?.data || {};
    pageFunc(parameters, { value: funcCode });
  }, [substance, canShow]);

  return null;
}

export default Bot;
