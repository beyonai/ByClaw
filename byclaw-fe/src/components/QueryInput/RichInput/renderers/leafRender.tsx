import React from 'react';
import { Editor } from 'slate';
import { RenderLeafProps, useSlate } from 'slate-react';
import { getIntl } from '@umijs/max';

function Leaf(props: RenderLeafProps) {
  const { attributes, children, leaf } = props;
  const editor = useSlate();
  const value = Editor.string(editor, []);
  const showMyPlaceholder = !leaf.placeholder && !value;

  return (
    <span {...attributes} style={showMyPlaceholder ? { position: 'relative' } : undefined}>
      {children}
      {showMyPlaceholder && (
        <span
          data-slate-placeholder="true"
          contentEditable={false}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            // width: '100%',
            // maxWidth: '100%',
            // display: 'block',
            opacity: 0.333,
            userSelect: 'none',
            textDecoration: 'none',
          }}
        >
          {getIntl().formatMessage({ id: 'common.send' })}
        </span>
      )}
    </span>
  );
}

export function renderLeaf(props: RenderLeafProps) {
  return <Leaf {...props} />;
}
