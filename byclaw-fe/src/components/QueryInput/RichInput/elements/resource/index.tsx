import React, { useMemo } from 'react';
import { Editor, Transforms } from 'slate';
import { useIntl } from '@umijs/max';
import { ReactEditor, RenderElementProps, useSlateStatic } from 'slate-react';
import { CloseCircleFilled } from '@ant-design/icons';
import { Tooltip } from 'antd';
import styles from '../mention/index.module.less';
import { IResourceType } from '../../types';
import { getAgentChatAvatar } from '@/utils/agent';
import useGlobal from '@/hooks/useGlobal';

export type ResourceElementType = {
  type: string;
  id: string;
  name: string;
  chatAvatar?: string;
  agentId?: string;
  agentName?: string;
  agentType?: string;
  resourceName: string;
  resourceCode?: string;
  field_code?: string;
  field_name?: string;
  field_id?: string;
  field_desc?: string;
  resourceType: IResourceType;
  isAgentTool?: boolean;
  isInactiveAgentSelection?: boolean;
  ownerAgentId?: string;
  isAgentResourceValidationPending?: boolean;
  requiresAgentResourceReplacement?: boolean;
  resourceReplacementType?: 'skill' | 'knowledge' | 'tool';
  isFromResourceModule?: boolean;
  showQuotePrefix?: boolean;
  children: { text: string }[];
};

const ResourceElement = ({ attributes, children, element }: RenderElementProps) => {
  const el = element as ResourceElementType;
  const intl = useIntl();
  const editor = useSlateStatic();
  const { EventEmitter } = useGlobal();
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

  const replacementHint = useMemo(() => {
    const resourceTypeLabel =
      el.resourceReplacementType === 'skill' ? '技能' : el.resourceReplacementType === 'knowledge' ? '知识库' : '工具';
    return `该${resourceTypeLabel}不适用于当前数字员工，点击选择替换，或点击 × 移除`;
  }, [el.resourceReplacementType]);

  const resourceElement = (
    <span
      {...attributes}
      data-inactive-agent-selection={el.isInactiveAgentSelection ? 'true' : undefined}
      data-agent-resource-replacement={el.requiresAgentResourceReplacement ? el.resourceReplacementType : undefined}
      className={`${styles.mention} ${
        el.isInactiveAgentSelection || el.requiresAgentResourceReplacement ? styles.inactiveAgentSelection : ''
      } ${el.requiresAgentResourceReplacement ? styles.invalidResource : ''}`.trim()}
    >
      <span
        contentEditable={false}
        onClick={(event) => {
          if (!el.requiresAgentResourceReplacement || !el.resourceReplacementType) return;
          event.preventDefault();
          event.stopPropagation();
          EventEmitter.emit('queryInput-open-resource-picker', {
            tabKey: el.resourceReplacementType,
            resourceId: el.id,
          });
        }}
      >
        {prefix}
        {(el.showQuotePrefix ||
          !(el.isFromResourceModule || el.resourceType === 'TOOL' || el.resourceType === 'OBJECT')) && (
          <span style={{ color: '#00000080', marginRight: 2 }}>{intl.formatMessage({ id: 'quote' })}</span>
        )}
        {name}
        {el.requiresAgentResourceReplacement && (
          <CloseCircleFilled
            aria-label="remove-incompatible-resource"
            className={styles.deleteIcon}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const selectionRef = editor.selection
                ? Editor.rangeRef(editor, editor.selection, { affinity: 'forward' })
                : undefined;
              try {
                Transforms.removeNodes(editor, { at: ReactEditor.findPath(editor, element) });
                const preservedSelection = selectionRef?.unref();
                if (preservedSelection) {
                  Transforms.select(editor, preservedSelection);
                }
              } catch (e) {
                selectionRef?.unref();
                // 节点可能已在异步兼容性检查期间被移除。
              }
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        )}
      </span>
      {children}
    </span>
  );
  return el.requiresAgentResourceReplacement ? (
    <Tooltip title={replacementHint} placement="top">
      {resourceElement}
    </Tooltip>
  ) : (
    resourceElement
  );
};
export default ResourceElement;
