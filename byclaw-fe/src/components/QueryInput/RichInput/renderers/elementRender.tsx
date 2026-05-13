import React from 'react';
import { RenderElementProps } from 'slate-react';
import MentionElement from '../elements/mention';
import ResourceElement from '../elements/resource';
import CustomEditableElement from '../elements/editable';
import { ELEMENT_MENTION, ELEMENT_RESOURCE, ELEMENT_EDITABLE } from '../utils/constants';
import { CustomElement } from '../types';

// 节点渲染分发
export const elementRender = (props: RenderElementProps) => {
  const { element } = props;
  switch ((element as CustomElement).type) {
    case ELEMENT_MENTION:
      return <MentionElement {...props} />;
    case ELEMENT_RESOURCE:
      return <ResourceElement {...props} />;
    case ELEMENT_EDITABLE:
      return <CustomEditableElement {...props} />;
    case 'paragraph':
      return <div {...props.attributes}>{props.children}</div>;
    default:
      return <span {...props.attributes}>{props.children}</span>;
  }
};
