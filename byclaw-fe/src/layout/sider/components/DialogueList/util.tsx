import dayjs from 'dayjs';
import { PictureOutlined } from '@ant-design/icons';
import { isNumber, isNil } from 'lodash';

export const formatTime = (updateTimeStr: string, createTime: string) => {
  const myUpdateTimeStr = Number(updateTimeStr) ? Number(updateTimeStr) : updateTimeStr;
  const myCreateTime = Number(createTime) ? Number(createTime) : createTime;

  let timeStr: number | string = myUpdateTimeStr;
  if (isNumber(timeStr) && timeStr < 0) {
    timeStr = myCreateTime;
  } else if (isNil(timeStr)) {
    timeStr = myCreateTime;
  }

  let displayCreateTime = timeStr;
  if (displayCreateTime) {
    const createTimeDayjsObj = dayjs(displayCreateTime);
    const isSameDay = createTimeDayjsObj.isSame(dayjs(), 'day');

    if (isSameDay) {
      displayCreateTime = createTimeDayjsObj.format('HH:mm');
    } else {
      displayCreateTime = createTimeDayjsObj.format('MM-DD');
    }
  }

  return displayCreateTime;
};

const extractTextFromContent = (content: any): string => {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    const trimmedContent = content.trim();

    if (trimmedContent.startsWith('[') || trimmedContent.startsWith('{')) {
      try {
        return extractTextFromContent(JSON.parse(trimmedContent));
      } catch (error) {
        return content;
      }
    }

    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextFromContent(item))
      .filter(Boolean)
      .join(' ');
  }

  if (typeof content === 'object') {
    return (
      extractTextFromContent(content.text) ||
      extractTextFromContent(content.content?.substance) ||
      extractTextFromContent(content.substance) ||
      ''
    );
  }

  return `${content}`;
};

const stripMarkdownContent = (content: string) => {
  return content
    .replace(/^\s+/, '')
    .replace(/^\\n+/, '')
    .replace(/```\w*\s?/g, '')
    .replace(/```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * 处理会话列表内容，提取用户可读文本并移除 markdown 标记
 * @param content 原始内容
 * @returns 处理后的内容
 */
export const processSessionContent = (content: any): React.ReactNode => {
  // 检查是否包含伪 JSON 格式的特征
  if (typeof content === 'string' && (content.includes('"steps"') || content.includes('"step_topic"'))) {
    // JSON 解析失败，使用正则表达式提取
    const stepTopicMatch = content.match(/"step_topic"\s*:\s*"([^"]+)"/);
    if (stepTopicMatch && stepTopicMatch[1]) {
      return stepTopicMatch[1];
    }

    return '';
  }

  const textContent = extractTextFromContent(content);
  if (!textContent || typeof textContent !== 'string') {
    return '';
  }

  // 将markdown的代码格式去掉，保留内容即可
  const handledContent = stripMarkdownContent(textContent);
  if (/<img\s+[^>]*src=/i.test(handledContent)) {
    // 将图片换成这个icon。暂时发现以这个开头的话，整个内容都是图片了。
    return <PictureOutlined />;
  }
  if (handledContent.startsWith('{"')) {
    // 不展示JSON。暂时发现以这个开头的话，整个内容都是JSON了。
    return '';
  }
  return handledContent;
};
