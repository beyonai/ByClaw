/* eslint-disable indent */
import React, { useMemo } from 'react';
import { Transforms } from 'slate';
import { RenderElementProps, useSlateStatic, ReactEditor } from 'slate-react';
import { getAgentChatAvatar } from '@/utils/agent';
import classNames from 'classnames';
import { Tooltip } from 'antd';
import { CloseCircleFilled } from '@ant-design/icons';
import styles from './index.module.less';
import { ResourceType } from '../../utils/constants';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { IResourceType } from '../../types';
import { getIntl } from '@umijs/max';

// 自定义Element类型
export type MentionElementType = {
  type: string;
  agentId?: string;
  userId?: string | number;
  name: string;
  chatAvatar?: string;
  agentType?: string;
  isDefaultAgent?: boolean; // 是否为最左侧的技能，例如慧笔、问数
  resourceType: IResourceType;
  resourceCode?: string;
  field_code?: string;
  field_name?: string;
  field_id?: string;
  field_desc?: string;
  children: { text: string }[];
};

const MentionElement = ({ attributes, children, element }: RenderElementProps) => {
  const el = element as MentionElementType;
  const { name, chatAvatar, resourceType, isDefaultAgent } = el;
  const editor = useSlateStatic();

  const prefix = useMemo(() => {
    if (chatAvatar) {
      return getAgentChatAvatar(chatAvatar, '', {
        width: 20,
        height: 20,
        verticalAlign: 'text-top',
        marginRight: 4,
      });
    }
    if (name) {
      return (
        <span className={styles.name}>
          <span>{getDisplayUserNameInChat(name)}</span>
        </span>
      );
    }
    return null;
  }, [name, chatAvatar]);

  const isSuperAssistant = useMemo(() => resourceType === ResourceType.superAssistant, [resourceType]);

  const ele = (
    <span
      {...attributes}
      className={classNames(styles.mention, {
        // 这个类名需要在别的地方querySelector获取，因此用global的方式
        'default-agent': isDefaultAgent,
      })}
    >
      <span
        contentEditable={false}
        onClick={(event) => {
          if (isDefaultAgent) {
            event.preventDefault();
            event.stopPropagation();
            try {
              // 默认员工标签是 Slate void 节点，删除前先通过 ReactEditor 定位真实路径。
              const path = ReactEditor.findPath(editor, element);
              Transforms.removeNodes(editor, { at: path });
            } catch (e) {
              // 节点可能已被外部状态更新移除，忽略即可，避免再次触发 Slate DOM 映射异常。
            }
          }
        }}
      >
        {prefix}
        {name}
        {isDefaultAgent && <CloseCircleFilled className={styles.deleteIcon} />}
        {isSuperAssistant && (
          <span className={styles.aiMark}>
            <span>{getIntl().formatMessage({ id: 'common.digitalClone' })}</span>
          </span>
        )}
      </span>
      {children}
    </span>
  );
  if (el.isDefaultAgent) {
    return (
      <Tooltip title={getIntl().formatMessage({ id: 'common.clickToExit' })} placement="top">
        {ele}
      </Tooltip>
    );
  }
  return ele;
};
export default MentionElement;
