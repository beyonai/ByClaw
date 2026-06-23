import React, { useMemo } from 'react';
import { useIntl } from '@umijs/max';
import { RenderElementProps } from 'slate-react';
import styles from '../mention/index.module.less';
import { IResourceType } from '../../types';
import { getAgentChatAvatar } from '@/utils/agent';

export type ResourceElementType = {
  type: string;
  id: string;
  name: string;
  chatAvatar?: string;
  agentId?: string;
  agentName?: string;
  resourceName: string;
  resourceCode?: string;
  field_code?: string;
  field_name?: string;
  field_id?: string;
  field_desc?: string;
  resourceType: IResourceType;
  isAgentTool?: boolean;
  isFromResourceModule?: boolean;
  children: { text: string }[];
};

const ResourceElement = ({ attributes, children, element }: RenderElementProps) => {
  const el = element as ResourceElementType;
  const intl = useIntl();
  const { name, chatAvatar } = el;
  const prefix = useMemo(() => {
    if (chatAvatar) {
      return getAgentChatAvatar(chatAvatar, '', {
        width: 20,
        height: 20,
        verticalAlign: 'text-top',
        marginRight: 4,
      });
    }
    return null;
  }, [chatAvatar]);

  return (
    <span {...attributes} className={styles.mention}>
      <span contentEditable={false}>
        {prefix}
        {!(
          el.isFromResourceModule ||
          el.resourceType === 'TOOL' ||
          el.resourceType === 'OBJECT' ||
          el.resourceType === 'VIEW'
        ) && <span style={{ color: '#00000080', marginRight: 2 }}>{intl.formatMessage({ id: 'quote' })}</span>}
        {name}
      </span>
      {children}
    </span>
  );
};
export default ResourceElement;
