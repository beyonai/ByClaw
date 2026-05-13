/* eslint-disable react/no-danger */
/**
 * 内容块渲染器
 * 根据不同的内容类型渲染对应的组件
 */
import React, { useMemo, useContext } from 'react';
import DOMPurify from 'dompurify';
import { Typography, Image, List } from 'antd';
import classnames from 'classnames';
import Markdown from '@/components/Markdown';
import { CardComponentContext } from '@/components/MessagesComp/Card';
import { useSelector } from '@umijs/max';
import styles from '../index.module.less';
import {
  CardContentType,
  ICardContentBlock,
  IHtmlContent,
  IImageContent,
  IMarkdownContent,
  ITextContent,
  IAgentInfoContent,
} from '../types';
import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';
import { getAgentChatAvatar } from '@/utils/agent';

const { Paragraph } = Typography;

/**
 * 文本内容块
 */
const TextBlock: React.FC<{ block: ITextContent }> = ({ block }) => {
  const { text, style, rows } = block;

  const displayText = useMemo(() => {
    return String(text);
  }, [text]);

  return (
    <Paragraph
      ellipsis={rows ? { rows } : undefined}
      className={classnames(styles.contentBlock, styles.textBlock)}
      style={style}
    >
      {displayText}
    </Paragraph>
  );
};

/**
 * Markdown内容块
 */
const MarkdownBlock: React.FC<{
  block: IMarkdownContent;
}> = ({ block }) => {
  const { text } = block;

  return <Markdown text={text} />;
};

/**
 * HTML内容块
 */
const HtmlBlock: React.FC<{ block: IHtmlContent }> = ({ block }) => {
  const { text } = block;

  const safeHtml = React.useMemo(
    () =>
      DOMPurify.sanitize(text, {
        FORBID_TAGS: ['style', 'script'],
      }),
    [text]
  );

  // 使用dangerouslySetInnerHTML渲染HTML
  // 注意：实际项目中应该使用DOMPurify等库进行安全处理
  return (
    <div className={classnames(styles.contentBlock, styles.htmlBlock)} dangerouslySetInnerHTML={{ __html: safeHtml }} />
  );
};

/**
 * 图片内容块
 */
const ImageBlock: React.FC<{ block: IImageContent }> = ({ block }) => {
  const { src, alt, title, width, height, action } = block;
  const { executeAction } = useContext(CardComponentContext);

  return (
    <div className={classnames(styles.contentBlock, styles.imageBlock)}>
      <Image
        src={src}
        alt={alt || title}
        title={title}
        width={width}
        height={height}
        preview={!action}
        onClick={action ? () => executeAction(action) : undefined}
        style={{ cursor: action ? 'pointer' : 'default' }}
      />
    </div>
  );
};

/**
 * 数字员工详情内容块
 */
const AgentInfoBlock: React.FC<{ block: IAgentInfoContent }> = ({ block }) => {
  const { agentId } = block;
  const { employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);

  const employee = useMemo(() => {
    return employeesList.find((item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`);
  }, [employeesList]);

  const agentInfo = useMemo(() => {
    if (!employee) {
      return null;
    }
    return (
      <List bordered className={styles.agentInfoList}>
        <List.Item className={styles.agentInfoItem}>
          <List.Item.Meta
            avatar={<div className={styles.agentInfoAvatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>}
            title={employee.name}
            description={
              <Paragraph
                type="secondary"
                className={styles.description}
                ellipsis={{ rows: 1, tooltip: { title: employee.resourceDesc } }}
              >
                {employee.resourceDesc}
              </Paragraph>
            }
          />
        </List.Item>
      </List>
    );
  }, [employee]);

  return agentInfo;
};

/**
 * 内容块渲染器主组件
 */
const ContentBlockRenderer: React.FC<{ block: ICardContentBlock }> = ({ block }) => {
  switch (block.type) {
    case CardContentType.MARKDOWN:
      return <MarkdownBlock block={block} />;
    case CardContentType.HTML:
      return <HtmlBlock block={block} />;
    case CardContentType.IMAGE:
      return <ImageBlock block={block} />;
    case CardContentType.AGENT_INFO:
      return <AgentInfoBlock block={block} />;
    default:
      return <TextBlock block={block} />;
  }
};

export default ContentBlockRenderer;
