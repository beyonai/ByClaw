import React, { createElement, useRef, useLayoutEffect, useEffect } from 'react';
import { isNil } from 'lodash';
import './Resizable.less';

type Length = number | `${number}vw` | `${number}vh` | `${number}px`;

type Limit = {
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  maxHeight?: Length;
};

export const isLength = (length?: Length) => {
  if (isNil(length)) return false;
  return typeof length === 'number' || length.endsWith('vw') || length.endsWith('vh') || length.endsWith('px');
};

export const transformLength = (length: Length): number => {
  if (typeof length === 'number') return length;
  if (length.endsWith('vw')) return (window.innerWidth * Number(length.replace('vw', ''))) / 100;
  if (length.endsWith('vh')) return (window.innerHeight * Number(length.replace('vh', ''))) / 100;
  return parseInt(length, 10);
};

interface ResizableProps {

  /** 顶部是否可拖动 */
  top?: boolean;

  /** 左侧是否可拖动 */
  left?: boolean;

  /** 右侧是否可拖动 */
  right?: boolean;

  /** 底部是否可拖动 */
  bottom?: boolean;

  /** 最小宽度 */
  minWidth?: number;

  /** 最大宽度 */
  maxWidth?: number;

  /** 最小高度 */
  minHeight?: number;

  /** 最大高度 */
  maxHeight?: number;

  /** 限制缩放尺寸 - 也可通过目标元素的CSS样式设置 */
  limit?: Limit;

  disabled?: boolean;

  children: React.ReactElement;
}

interface iResizable {
  (props: ResizableProps): React.JSX.Element;
}

const initHandle = (position: 'left' | 'right' | 'top' | 'bottom', limit: Limit = {}) => {
  const handle = document.createElement('span');
  handle.style.position = 'absolute';
  if (position !== 'top') handle.style.bottom = '0';
  if (position !== 'left') handle.style.right = '0';
  if (position !== 'right') handle.style.left = '0';
  if (position !== 'bottom') handle.style.top = '0';

  if (['top', 'bottom'].includes(position)) {
    handle.style.height = '2px';
    handle.classList.add('resizable-vertical');
  }
  if (['left', 'right'].includes(position)) {
    handle.style.width = '2px';
    handle.classList.add('resizable-horizontal');
  }

  handle.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // 创建透明遮罩层来覆盖 iframe
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.zIndex = '9999';

    // 将遮罩层添加到父元素
    handle.parentElement?.appendChild(overlay);

    const onMouseUp = document.onmouseup;
    const onMouseMove = document.onmousemove;
    const rect = handle.parentElement?.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    document.onmouseup = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 移除遮罩层
      overlay.remove();

      document.onmouseup = onMouseUp;
      document.onmousemove = onMouseMove;
    };

    document.onmousemove = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const moveX = position === 'left' ? startX - e.clientX : e.clientX - startX;
      const moveY = position === 'top' ? startY - e.clientY : e.clientY - startY;

      const _limit = {} as {
        [key in keyof typeof limit]: number;
      };
      Object.keys(limit || {}).forEach((k) => {
        const key = k as keyof typeof limit;

        const val = limit[key];
        if (isLength(val)) {
          _limit[key] = transformLength(val as Length);
        }
      });

      let width = Math.ceil((rect?.width ?? 0) + moveX);
      let height = Math.ceil((rect?.height ?? 0) + moveY);
      if (_limit?.minWidth) width = Math.max(width, _limit.minWidth);
      if (_limit?.maxWidth) width = Math.min(width, _limit.maxWidth);
      if (_limit?.minHeight) height = Math.max(height, _limit.minHeight);
      if (_limit?.maxHeight) height = Math.min(height, _limit.maxHeight);

      if (['left', 'right'].includes(position)) {
        if (handle.parentElement) handle.parentElement.style.width = `${width}px`;
      }
      if (['top', 'bottom'].includes(position)) {
        if (handle.parentElement) handle.parentElement.style.height = `${height}px`;
      }
    };
  };

  return handle;
};

/**
 * 可拖动组件 - (入侵式组件，请确保最外层是DOM元素，并且DOM元素的宽高是自适应的，可设置最大、最小宽高以限制拖动范围)
 * @param props 组件属性
 * @returns 组件
 */
export const Resizable: iResizable = (props) => {
  const { left, right, top, bottom, children, limit, disabled } = props;
  const dom = useRef<HTMLDivElement>(null);
  const tmp = useRef<Limit>({});

  useEffect(() => {
    tmp.current = limit ?? {};
  }, [limit]);

  const ref = (e: HTMLDivElement | null) => {
    dom.current = e;
    const child = children as any;
    if (child.ref) child.ref.current = dom.current;
  };

  useLayoutEffect(() => {
    let topHandle: HTMLSpanElement | null = null;
    let leftHandle: HTMLSpanElement | null = null;
    let rightHandle: HTMLSpanElement | null = null;
    let bottomHandle: HTMLSpanElement | null = null;

    if (dom.current && !disabled) {
      dom.current.style.position = 'relative';

      if (top) {
        topHandle = initHandle('top', tmp.current);
        dom.current.appendChild(topHandle);
      }

      if (left) {
        leftHandle = initHandle('left', tmp.current);
        dom.current.appendChild(leftHandle);
      }

      if (right) {
        rightHandle = initHandle('right', tmp.current);
        dom.current.appendChild(rightHandle);
      }

      if (bottom) {
        bottomHandle = initHandle('bottom', tmp.current);
        dom.current.appendChild(bottomHandle);
      }
    }
    return () => {
      topHandle?.remove();
      leftHandle?.remove();
      rightHandle?.remove();
      bottomHandle?.remove();
    };
  }, [dom.current, left, right, top, bottom, disabled]);

  return createElement(children.type, { ...(children.props ?? {}), ref });
};
