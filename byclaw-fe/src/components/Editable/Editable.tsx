import { useControllableValue } from 'ahooks';
import React, {
  createElement,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import './Editable.less';

interface EditableProps {
  children: React.ReactNode;
  trim?: boolean;
  count?: number;
  // eslint-disable-next-line react/no-unused-prop-types
  value?: string;
  disable?: boolean;
  placeholder?: string;
  defaultValue?: string;
  onEnter?: (v: string) => void;
  // eslint-disable-next-line react/no-unused-prop-types
  onChange?: (v: string) => void;
}

export interface EditableRef {
  clear: () => void;
  focus: () => void;
}

export const Editable = forwardRef<EditableRef, EditableProps>((props, _ref) => {
  const { count, children, trim, placeholder, disable, onEnter, defaultValue = '' } = props;
  const dom = useRef<{ parent: HTMLDivElement | null; target: HTMLDivElement | null }>({ parent: null, target: null });
  const vms = useRef({ onEnter });
  vms.current.onEnter = onEnter;

  const [value, update] = useControllableValue(props, { defaultValue });

  useImperativeHandle(
    _ref,
    () => {
      return {
        clear: () => {
          if (dom.current.target) dom.current.target.innerHTML = '';
        },
        focus: () => {
          dom.current.target?.focus();
        },
      };
    },
    []
  );

  useEffect(() => {
    if (dom.current.target) {
      dom.current.target.innerText = value;
    }
  }, [value]);

  useLayoutEffect(() => {
    dom.current.target = document.createElement('div');
    dom.current.target.contentEditable = disable ? 'false' : 'true';
    dom.current.target.innerText = value;
    dom.current.target.style.width = '100%';
    dom.current.target.style.height = '100%';

    if (placeholder) dom.current.target.setAttribute('placeholder', placeholder);

    const blur = (e: Event) => {
      let { innerText } = e.target as HTMLDivElement;
      if (trim) innerText = innerText.trim();
      if (count) innerText = innerText.slice(0, count);
      update(innerText);
    };

    const keydown = (e: Event) => {
      const { key, metaKey, ctrlKey, altKey } = e as KeyboardEvent;
      const { innerText } = e.target as HTMLDivElement;
      // 可产生字符的按键事件
      if (key.length === 1 && !metaKey && !ctrlKey && !altKey) {
        // 超长字符
        if (count && innerText.length > count) e.preventDefault();
      }
      // 回车键
      if (key === 'Enter' && !ctrlKey) {
        e.preventDefault();

        update(innerText);
        setTimeout(() => vms.current.onEnter?.(innerText), 0);
      }
    };
    dom.current.target.addEventListener('blur', blur);
    dom.current.target.addEventListener('keydown', keydown);

    dom.current.parent?.appendChild(dom.current.target);

    return () => {
      dom.current.target?.remove();
      dom.current.target?.removeEventListener('blur', blur);
      dom.current.target?.removeEventListener('keydown', keydown);
    };
  }, [dom.current, disable, placeholder]);

  if (!Array.isArray(children) && isValidElement(children)) {
    const ref = (e: HTMLDivElement | null) => {
      dom.current.parent = e;

      const temp = children as any;
      if (temp.ref) temp.ref.current = e;
    };
    return createElement(children.type, {
      ...children.props,
      ref,
      key: children.key,
      className: `${children.props.className ?? ''} x-editable`,
    });
  }

  return null;
});
