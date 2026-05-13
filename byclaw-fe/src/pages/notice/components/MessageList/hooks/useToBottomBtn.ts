import { debounce, noop } from 'lodash';
import { useCallback, useEffect, useState } from 'react';

import type { IMessage } from '@/typescript/message';

type IProps = {
  messageList: IMessage[];

  scrollMessageId: string;
};

function useToBottomBtn(props: IProps) {
  const { messageList, scrollMessageId } = props;

  const [toBottomBtnVisable, setToBottomBtnVisable] = useState(false);

  const adjustHandler = useCallback((element?: HTMLElement | null) => {
    if (!element) return false;

    return element.scrollHeight - element.scrollTop - element.clientHeight > 12;
  }, []);

  useEffect(() => {
    const element = document.getElementById(scrollMessageId);

    setToBottomBtnVisable(adjustHandler(element));
  }, [messageList, scrollMessageId]);

  useEffect(() => {
    const element = document.getElementById(scrollMessageId);
    if (!element) return noop;

    const handleScroll = debounce(() => {
      if (adjustHandler(element)) {
        setToBottomBtnVisable(true);
      } else {
        setToBottomBtnVisable(false);
      }
    }, 100);

    element.addEventListener('scroll', handleScroll);
    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const element = document.getElementById(scrollMessageId);

    const handleScroll = debounce(() => {
      if (adjustHandler(element)) {
        setToBottomBtnVisable(true);
      } else {
        setToBottomBtnVisable(false);
      }
    }, 100);

    const reseizeOber = new ResizeObserver(() => {
      handleScroll();
    });

    if (element) {
      reseizeOber.observe(element);
    }

    return () => {
      reseizeOber.disconnect();
    };
  }, [scrollMessageId]);

  return {
    toBottomBtnVisable,
    setToBottomBtnVisable,
  };
}

export default useToBottomBtn;
