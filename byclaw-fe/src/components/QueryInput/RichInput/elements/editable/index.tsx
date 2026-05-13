import React, { useMemo } from 'react';
import { RenderElementProps, useComposing, useSelected } from 'slate-react';
import { get } from 'lodash';
import styles from './index.module.less';

export type EditableElementType = {
  type: string;
  placeholder: string;
  children: { text: string }[];
};

function getPlaceholderMinWidth(placeholder: string, fontSize = 16) {
  if (!placeholder) return 54;
  const span = document.createElement('span');
  span.style.cssText = `
    position: fixed;
    top: -9999px;
    left: -9999px;
    white-space: nowrap;
    font-size: ${fontSize}px;
  `;
  span.textContent = placeholder;
  document.body.appendChild(span);
  const width = span.offsetWidth; // 获取元素宽度
  document.body.removeChild(span);
  return Math.ceil(width);
}

// 可编辑自定义节点
const CustomEditableElement = ({ attributes, children, element }: RenderElementProps) => {
  const el = element as EditableElementType;
  const { placeholder } = el;
  const selected = useSelected();
  const isComposing = useComposing();
  const hasContent = !!get(el, 'children.0.text');
  const minWidth = useMemo(() => getPlaceholderMinWidth(placeholder), [placeholder]);
  // 只要正在中文输入且当前节点被选中，placeholder 隐藏
  const hidePlaceholder = !placeholder || hasContent || (isComposing && selected);
  return (
    <span
      {...attributes}
      contentEditable
      className={styles.customEditable}
      style={hidePlaceholder ? undefined : { minWidth }}
    >
      {placeholder && (
        <div className={styles.p} contentEditable={false}>
          <div className={styles.placeholder} style={{ opacity: hidePlaceholder ? '0' : '1' }}>
            {placeholder}
          </div>
        </div>
      )}
      {children}
      <span contentEditable={false} style={{ fontSize: 0, userSelect: 'none' }}>
        &nbsp;
      </span>
    </span>
  );
};
export default CustomEditableElement;
