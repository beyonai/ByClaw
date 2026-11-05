import React, { useCallback, useRef } from 'react';
import { IS_FOCUSED } from 'slate-dom';
import { useSlateStatic } from 'slate-react';

const EditableRootWithAria = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
  const editor = useSlateStatic();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );

  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current) {
      // Suspense 隐藏时 Slate 0.117 的 ref 已解绑，但 DOM 仍可能随后失焦。
      // 此时根映射已删除，不能进入 Slate 的 DOM 查找；仅同步失焦状态，保留草稿和选区。
      IS_FOCUSED.delete(editor);
      return;
    }
    props.onBlur?.(event);
  };

  return <div {...props} ref={setRootRef} onBlur={onBlur} aria-label="byai-input" />;
});
EditableRootWithAria.displayName = 'EditableRootWithAria';

export default EditableRootWithAria;
