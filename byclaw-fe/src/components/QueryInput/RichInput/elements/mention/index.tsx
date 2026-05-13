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
  children: { text: string }[];
};

const MentionElement = ({ attributes, element }: RenderElementProps) => {
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
      contentEditable={false}
      className={classNames(styles.mention, {
        // 这个类名需要在别的地方querySelector获取，因此用global的方式
        'default-agent': isDefaultAgent,
      })}
      onClick={() => {
        if (isDefaultAgent) {
          // 删除该节点
          // 找到当前节点的路径
          const path = ReactEditor.findPath(editor, element);
          // 删除节点
          Transforms.removeNodes(editor, { at: path });
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
