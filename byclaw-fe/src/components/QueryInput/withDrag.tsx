import React, { ReactElement, cloneElement, isValidElement, HTMLAttributes } from 'react';
// @ts-ignore
import { getIntl } from '@umijs/max';
import { setDragData } from './RichInput/utils/drag';
import { DragType } from './RichInput/utils/constants';
import getElementData from './RichInput/utils/getElementData';

export type IDragType = (typeof DragType)[keyof typeof DragType];

export function onTreeNodeDragStart(event: React.DragEvent, data: any, type: IDragType) {
  setDragData(event, getElementData(type, data));
}

export { DragType };

interface DraggableProps<P extends HTMLAttributes<HTMLElement> = HTMLAttributes<HTMLElement>> {
  data: any;
  disabled?: boolean;
  children: ReactElement<P>;
}

let draggingStyle: HTMLStyleElement;

export function Draggable<P extends HTMLAttributes<HTMLElement> = HTMLAttributes<HTMLElement>>(
  props: DraggableProps<P> & {
    type: IDragType;
  }
): ReactElement<P> {
  const { data, disabled, type, children } = props;
  if (!isValidElement(children)) {
    const intl = getIntl();
    throw new Error(intl.formatMessage({ id: 'common.draggableError' }));
  }

  const handleDragStart = (e: React.DragEvent<HTMLElement>) => {
    if (!draggingStyle) {
      draggingStyle = document.createElement('style');
      // 如果children内部有tooltip，拖拽开始时也会展示部分tooltip，所以需要隐藏
      draggingStyle.innerHTML = `
          .${PREFIX_NAME}-tooltip {
            display: none !important;
          }
        `;
    }
    document.head.appendChild(draggingStyle);
    setDragData(e, getElementData(type, data));
  };

  const handleDragEnd = () => {
    if (draggingStyle) {
      document.head.removeChild(draggingStyle);
    }
  };

  if (disabled) {
    return children;
  }

  const style = {
    ...(children.props.style || {}),
    cursor: 'pointer',
  };

  return cloneElement(children, {
    ...children.props,
    style,
    draggable: true,
    onDragEnd: handleDragEnd,
    onDragStart: handleDragStart,
  } as P);
}

export default function withDrag(type: IDragType) {
  function InnerDraggable<P extends HTMLAttributes<HTMLElement> = HTMLAttributes<HTMLElement>>(
    props: DraggableProps<P>
  ): ReactElement<P> {
    return <Draggable {...props} type={type} />;
  }
  return InnerDraggable;
}
