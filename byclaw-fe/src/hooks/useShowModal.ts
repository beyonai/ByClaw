import { useSetState } from 'ahooks';
import { useCallback } from 'react';
// @ts-ignore
import { getIntl } from '@umijs/max';

type Type = 'add' | 'edit' | 'view' | 'debug';

export const getTitle = (type: `${Type}`, text: string) => {
  const intl = getIntl();
  let title = '';
  const titleMap = {
    add: intl.formatMessage({ id: 'common.add' }),
    edit: intl.formatMessage({ id: 'common.edit' }),
    view: intl.formatMessage({ id: 'common.view' }),
  };
  if (titleMap[type]) {
    title = titleMap[type];
  }
  if (text) {
    title += `${text}`;
  }
  return title;
};

export type ModalStore<T> = {
  open: boolean;
  data?: T;
  type?: Type;
};

export type ShowModalProps<T = any, U = unknown> = ModalStore<T> & {
  onCancel: () => void;
} & U;

export type Operation<T = any> = {
  handleShow: (type: Type, item?: T) => void;
  onCancel: () => void;
};

function useShowModal<T>(): [ModalStore<T>, Operation<T>] {
  const [state, setState] = useSetState<ModalStore<T>>({
    open: false,
    data: undefined,
    type: undefined,
  });

  const handleShow = useCallback((type: Type, item?: T) => {
    setState({
      open: true,
      data: item,
      type,
    });
  }, []);

  const onCancel = useCallback(() => {
    setState({
      open: false,
      data: undefined,
      type: undefined,
    });
  }, []);

  return [
    { ...state },
    {
      handleShow,
      onCancel,
    },
  ];
}

export default useShowModal;
