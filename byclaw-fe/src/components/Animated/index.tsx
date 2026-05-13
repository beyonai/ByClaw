import { createElement, useEffect, useRef, useState } from 'react';

enum STATUS {

  /** 初始化 */
  INIT = 0,

  /** 激活 */
  ACTIVE = 1,

  /** 销毁 */
  DISPOSE = 2,
}

interface AnimatedProps<T = any> {
  children: React.JSX.Element;
  active?: boolean;
  compute?: (active: boolean) => Partial<T>;
}

export function Animated<T = any>({ active, compute, children }: AnimatedProps<T>): React.ReactNode {
  const [show, update] = useState<boolean>();
  const [attr, setAttr] = useState<any>({});
  const status = useRef<STATUS>(undefined);
  const timer = useRef({ s: 0, e: 0 });

  const { type, props } = children;

  const vm = useRef({ compute, props });
  vm.current = { compute, props };

  useEffect(() => {
    if (active) {
      update(active);
      // 首次渲染
      status.current = STATUS.INIT;

      timer.current.s = window.setTimeout(() => {
        // 触发过渡
        status.current = STATUS.ACTIVE;
        const val = vm.current.compute?.(true) ?? {
          className: `actived${vm.current.props?.className ? ' ' : ''}${vm.current.props?.className ?? ''}`,
        };
        setAttr(val);
      }, 10);
    }

    if (!active) {
      // 触发销毁过渡动画
      status.current = STATUS.DISPOSE;
      const val = vm.current.compute?.(false) ?? {
        className: `disposed${vm.current.props?.className ? ' ' : ''}${vm.current.props?.className ?? ''}`,
      };
      setAttr(val);
      // 开启兜底
      timer.current.e = window.setTimeout(() => {
        if (status.current === STATUS.DISPOSE) {
          // 执行销毁渲染
          update(false);
          timer.current.e = 0;
        }
      }, 500);
    }
    return () => {
      if (timer.current.e) {
        window.clearTimeout(timer.current.e);
        timer.current.e = 0;
      }
      if (timer.current.s) {
        window.clearTimeout(timer.current.s);
        timer.current.s = 0;
      }
    };
  }, [active]);

  const onAnimationEnd = () => {
    if (status.current === STATUS.DISPOSE) {
      // 执行销毁渲染
      update(false);
      // 清除兜底
      if (timer.current.e) {
        window.clearTimeout(timer.current.e);
        timer.current.e = 0;
      }
    }
  };

  return show && createElement(type, { ...props, ...attr, onAnimationEnd });
}
