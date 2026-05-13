import { Editor, Descendant, Element, Text, Range, Point, Transforms, Path, Node } from 'slate';
import { useIntl } from '@umijs/max';
import { ELEMENT_MENTION, ELEMENT_EDITABLE, ELEMENT_RESOURCE, ResourceType } from './constants';
import { EditableElementType } from '../elements/editable';
import { MentionElementType } from '../elements/mention';
import { ResourceElementType } from '../elements/resource';
import { DefaultValueSchema, IResourceType, MentionTriggerInfo, Resource } from '../types';
import getElementData, { getElementDisplayText } from './getElementData';

export const IdInBracesRegex = /^[\w./\u4e00-\u9fa5]+#[\w./\u4e00-\u9fa5]+.*$/;

const isEditableElement = (element: Element): element is EditableElementType => {
  return element.type === ELEMENT_EDITABLE;
};

export const isMentionElement = (element: Element): element is MentionElementType => {
  return element.type === ELEMENT_MENTION;
};

const isResourceElement = (element: Element): element is ResourceElementType => {
  return element.type === ELEMENT_RESOURCE;
};

export function getChatResourceId(resourceId: any, resourceType: IResourceType) {
  return `${resourceType}_${resourceId}`;
}

export function getNodeResourceData(node: MentionElementType | ResourceElementType): Resource {
  const { resourceType } = node;
  const resourceId = isMentionElement(node) ? node.agentId || node.userId : node.id;
  let id: string;
  if (isResourceElement(node) && node.isAgentTool) {
    id = `${getChatResourceId(node.agentId, ResourceType.digitalEmployee)}#${getChatResourceId(
      resourceId,
      resourceType
    )}`;
  } else {
    id = getChatResourceId(resourceId, resourceType);
  }
  return {
    id,
    resourceType,
    resourceId: `${resourceId}`,
    resourceName: node.name,
    resourceCode: node.resourceCode,
    // 冗余chatAvatar
    chatAvatar: node.chatAvatar,
  };
}

export function getInputText(value: Descendant[]) {
  const getTextFromNodes = (nodes: Descendant[], level: number) => {
    let text = '';
    let displayText = '';
    for (const node of nodes) {
      // 每个换行就是一个node，因此需要在这里添加换行符
      if (level <= 0 && text.length) {
        text += '\n';
        displayText += '\n';
      }
      if (Element.isElement(node)) {
        if (isEditableElement(node)) {
          const { displayText: childrenText } = getTextFromNodes(node.children, level + 1);
          let realText = '';
          if (childrenText.trim() === '') {
            realText = node.placeholder.replace(/^\[/, '').replace(/\]$/, '');
          } else {
            realText = childrenText;
          }
          text += realText;
          displayText += realText;
        } else if (isMentionElement(node) || isResourceElement(node)) {
          if (isResourceElement(node) || !node.isDefaultAgent) {
            // isDefaultAgent不参与text的拼接
            displayText += getTextFromNodes(node.children, level + 1).displayText;
            text += `{{${getNodeResourceData(node).id}}}`;
          }
        } else if (node.children) {
          const childrenTexts = getTextFromNodes(node.children, level + 1);
          text += childrenTexts.text;
          displayText += childrenTexts.displayText;
        }
      } else if (Text.isText(node)) {
        const sanitized = node.text.replace(/\u200B/g, '');
        text += sanitized;
        displayText += sanitized;
      }
    }
    return {
      text,
      displayText,
    };
  };

  return getTextFromNodes(value, 0);
}

/**
 * 处理在 Mention 节点之后、文本行首位置开启输入法组合输入（compositionStart）时的兼容问题。
 * 在这种场景下，Chrome + Slate 在 inline void 节点后直接组合输入可能出现丢字，
 * 因此这里会在当前文本开头插入一个零宽空格，让 IME 挂载在这段缓冲文本上。
 */
export const handleMentionCompositionStart = (editor: Editor, isComposingRef: { current: boolean }) => {
  const { selection } = editor;
  if (selection && Range.isCollapsed(selection)) {
    const { anchor } = selection;
    if (anchor.offset === 0) {
      try {
        const parentPath = anchor.path.slice(0, -1);
        const index = anchor.path[anchor.path.length - 1];
        if (index > 0) {
          const prevPath = [...parentPath, index - 1];
          if (Node.has(editor, prevPath)) {
            const prevNode = Node.get(editor, prevPath);
            if (Element.isElement(prevNode) && prevNode.type === ELEMENT_MENTION) {
              // 在当前文本开头插入零宽空格
              Transforms.insertText(editor, '\u200B');
            }
          }
        }
      } catch (e) {
        // 兼容性兜底，不影响正常输入
      }
    }
  }
  isComposingRef.current = true;
};

export function getResourceList(value: Descendant[]): Resource[] {
  const getDataFromNodes = (nodes: Descendant[]): Resource[] => {
    const resourceList: Resource[] = [];
    for (const node of nodes) {
      if (Element.isElement(node)) {
        if (isMentionElement(node) || isResourceElement(node)) {
          const { resourceType } = node;
          if (resourceType) {
            if (isResourceElement(node) && node.isAgentTool) {
              resourceList.push(
                getNodeResourceData({
                  type: ELEMENT_MENTION,
                  resourceType: ResourceType.digitalEmployee,
                  chatAvatar: node.chatAvatar,
                  name: node.agentName!,
                  agentId: node.agentId,
                  children: [],
                })
              );
              resourceList.push(
                getNodeResourceData({
                  ...node,
                  isAgentTool: false,
                  name: node.resourceName,
                })
              );
            } else {
              resourceList.push(getNodeResourceData(node));
            }
          }
        } else if (node.children) {
          resourceList.push(...getDataFromNodes(node.children));
        }
      }
    }
    return resourceList;
  };

  const result = getDataFromNodes(value);

  // 按照 resourceId 去重，保留第一个出现的元素
  const uniqueMap = new Map<string, Resource>();
  result.forEach((item) => {
    if (!uniqueMap.has(item.resourceId)) {
      uniqueMap.set(item.resourceId, item);
    }
  });

  return Array.from(uniqueMap.values());
}

export function getDefaultAgentElementByValue(value: Descendant[]) {
  const paragraph = value[0] as {
    type: 'paragraph';
    children: Descendant[];
  };
  if (!paragraph || !paragraph.children) return null;
  for (let i = 0; i < paragraph.children.length; i += 1) {
    const item = paragraph.children[i] as any;
    if (item.text) return null;
    if (item.type && item.type !== ELEMENT_MENTION) {
      return null;
    }
    if (item.type === ELEMENT_MENTION && item.isDefaultAgent) {
      return item;
    }
  }
  return null;
}

export function getDefaultAgentByValue(value: Descendant[]) {
  const defaultAgentElement = getDefaultAgentElementByValue(value);
  if (!defaultAgentElement) return null;
  const { agentId, agentType } = defaultAgentElement;
  return {
    agentType,
    agentId,
  };
}

export function getNodesByTemplate(template: string): Descendant[] {
  if (!template) {
    return [{ text: '' }];
  }
  const nodes: Descendant[] = [];
  const regex = /【([^】]+)】/g;
  let lastIndex = 0;

  template.replace(regex, (match, content, index) => {
    // 添加匹配前的普通文本
    if (index > lastIndex) {
      nodes.push({ text: template.slice(lastIndex, index) });
    }
    // 添加自定义节点
    nodes.push({
      type: ELEMENT_EDITABLE,
      placeholder: `[${content}]`,
      children: [{ text: '' }],
    });
    lastIndex = index + match.length;
    return match;
  });

  // 添加剩余的普通文本
  if (lastIndex < template.length) {
    nodes.push({ text: template.slice(lastIndex) });
  }

  return nodes;
}

/**
 * 获取光标前一段连续的非空白文本（例如 "@Allen"）
 * @param editor Editor实例
 * @returns string
 */
function getBeforeCurrentRangeText(editor: Editor) {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return '';

  let { anchor } = selection;
  let result = '';

  // 向前逐字符遍历，直到遇到空格/换行或文档开始
  // 加一个安全上限，避免极端情况下的死循环
  for (let i = 0; i < 200; i += 1) {
    const beforePoint = Editor.before(editor, anchor, { unit: 'character' });
    if (!beforePoint) break;

    const range = Editor.range(editor, beforePoint, anchor);
    const char = Editor.string(editor, range);

    // 空格或换行视为边界
    if (!char || char === ' ' || char === '\n') break;

    result = char + result;
    anchor = beforePoint;
  }

  return result;
}

/**
 * 获取当前触发@或#的文本（例如 "@Allen" 或 "#123"）
 * @param editor Editor实例
 * @returns string
 */
export function getCurrentTriggerText(editor: Editor) {
  const text = getBeforeCurrentRangeText(editor);
  if (text) {
    const idx1 = text.indexOf('@');
    const idx2 = text.indexOf('#');
    const idx = Math.max(idx1, idx2);
    if (idx !== -1) {
      return text.slice(idx);
    }
  }
  return '';
}

// 检查光标前是否有@或#符号并确定位置
export const createCheckMentionTrigger = (
  editor: Editor,
  checkIfCanAt: (isInputting: boolean) => boolean,
  checkIfCanQuote: () => boolean
) => {
  return async (): Promise<MentionTriggerInfo | null> => {
    if (!editor) return null;
    const { selection } = editor;
    if (!selection || !Range.isCollapsed(selection)) return null;
    const currentTriggerText = getCurrentTriggerText(editor);
    let mentionType = '';
    if (currentTriggerText && currentTriggerText.startsWith('@')) {
      mentionType = '@';
    } else if (currentTriggerText && currentTriggerText.startsWith('#')) {
      mentionType = '#';
    }
    // 限制一下@和#的联想长度，避免用户输入的内容本身就自带@或#
    if (mentionType && currentTriggerText.length <= 12) {
      if (mentionType === '@' && !checkIfCanAt(true)) {
        return null;
      }
      if (mentionType === '#' && !checkIfCanQuote()) {
        return null;
      }
      // setTimeout 解决火狐浏览器获取到的range位置有问题
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        });
      });
      const domSelection = window.getSelection();
      if (domSelection && domSelection.rangeCount > 0) {
        const range = domSelection.getRangeAt(0).getBoundingClientRect();
        return {
          type: mentionType as '@' | '#',
          inputText: currentTriggerText.replace(/^@|#/, ''),
          position: {
            left: range.left,
            top: range.top + range.height,
          },
        };
      }
    }
    return null;
  };
};

// 查找最后一个插入节点的路径
const findLastNodePath = (originalPoint: Point, insertCount: number): Path => {
  const parentPath = Path.parent(originalPoint.path);
  const childIndex = originalPoint.path[originalPoint.path.length - 1];

  // 计算最后插入节点的索引位置
  const lastNodeIndex = childIndex + insertCount - 1;

  return [...parentPath, lastNodeIndex];
};

// 设置插入节点后的选区
export function setSelectionAfterInsert(editor: Editor, insertedNode: any, originalPoint?: Point) {
  if (originalPoint) {
    try {
      const isText = !insertedNode.type || insertedNode.type === 'text';
      if (isText) {
        const totalLength = insertedNode.text.length;
        const newPoint = {
          path: [...originalPoint.path],
          offset: originalPoint.offset + totalLength,
        };

        // 设置选区
        Transforms.select(editor, {
          anchor: newPoint,
          focus: newPoint,
        });
        return;
      }
      const lastNodePath = findLastNodePath(originalPoint, 1);

      const afterPath = Path.next(lastNodePath);
      const newPoint = Editor.after(editor, { path: afterPath, offset: 0 });

      if (newPoint) {
        Transforms.select(editor, newPoint);
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }

  // 方案2：降级方法 - 计算文档末尾位置
  const end = Editor.end(editor, []);
  Transforms.select(editor, end);
}

export function getElementFullRect(element: HTMLElement) {
  // 获取元素本身的尺寸（内容 + 内边距 + 边框）
  const rect = element.getBoundingClientRect();

  // 获取计算样式（包含外边距值）
  const styles = window.getComputedStyle(element);

  // 解析外边距数值（处理负值和auto情况）
  const parseMargin = (value: any) => Math.max(0, parseFloat(value) || 0);

  const margin = {
    top: parseMargin(styles.marginTop),
    right: parseMargin(styles.marginRight),
    bottom: parseMargin(styles.marginBottom),
    left: parseMargin(styles.marginLeft),
  };

  // 计算总尺寸
  return {
    margin,
    width: rect.width + margin.left + margin.right,
    height: rect.height + margin.top + margin.bottom,
    padding: {
      top: parseFloat(styles.paddingTop),
      right: parseFloat(styles.paddingRight),
      bottom: parseFloat(styles.paddingBottom),
      left: parseFloat(styles.paddingLeft),
    },
    lineHeight: styles.lineHeight,
  };
}

export function getAgentPlaceholder(intl: ReturnType<typeof useIntl>) {
  return intl.formatMessage({ id: 'chat.placeholder' });
}

export function getDescendantValueByDefaultValue(defaultValue: DefaultValueSchema) {
  const children: Descendant[] = [];
  if (defaultValue) {
    const { text = '', resourceList = [] } = defaultValue;
    // 将 text 中的 {{resourceId}} 片段解析为对应的节点
    const regex = /\{\{([^}]+)\}\}/g;
    let lastIndex = 0;
    let matchResult: RegExpExecArray | null;

    const pushPlainText = (segment: string) => {
      if (!segment) return;
      children.push({ text: segment });
    };

    const createMentionNode = (res: Resource) => {
      const fullData = {
        userName: res.resourceName,
        userId: res.resourceId,
        name: res.resourceName,
        agentId: res.resourceId,
        agentType: res.resourceType,
        chatAvatar: res.chatAvatar,
      };
      return getElementData(res.resourceType, fullData);
    };

    const createResourceNode = (res: Resource) => {
      return {
        type: ELEMENT_RESOURCE,
        resourceType: res.resourceType,
        id: res.resourceId,
        name: res.resourceName,
        resourceCode: res.resourceCode,
        children: [
          {
            text: getElementDisplayText({
              resourceType: res.resourceType,
              data: { name: res.resourceName },
            }),
          },
        ],
      };
    };

    const createAgentToolNode = (agentRes: Resource, toolRes: Resource) => {
      let name = toolRes.resourceName;

      return {
        name,
        isAgentTool: true,
        type: ELEMENT_RESOURCE,
        resourceType: toolRes.resourceType,
        resourceName: toolRes.resourceName,
        resourceCode: toolRes.resourceCode,
        id: toolRes.resourceId,
        agentId: agentRes.resourceId,
        agentType: agentRes.resourceType,
        agentName: agentRes.resourceName,
        children: [
          {
            text: getElementDisplayText({
              resourceType: toolRes.resourceType,
              data: { name },
            }),
          },
        ],
      };
    };

    for (;;) {
      matchResult = regex.exec(text);
      if (!matchResult) break;
      const idx = matchResult.index;
      const idInBraces = matchResult[1];
      // 追加 brace 前的纯文本
      if (idx > lastIndex) {
        pushPlainText(text.slice(lastIndex, idx));
      }
      lastIndex = idx + matchResult[0].length;

      // 匹配资源
      const res = resourceList.find((r) => r.id === idInBraces);
      if (
        res &&
        (res.resourceType === ResourceType.user ||
          res.resourceType === ResourceType.superAssistant ||
          res.resourceType === ResourceType.digitalEmployee)
      ) {
        children.push(createMentionNode(res));
      } else if (idInBraces.includes('#')) {
        const [agentResId, ...rest] = idInBraces.split('#');
        const toolResId: string = rest?.join('#');

        const agentRes = resourceList.find((r) => r.id === agentResId);
        const toolRes = resourceList.find((r) => r.id === toolResId);
        if (toolRes && agentRes) {
          children.push(createAgentToolNode(agentRes, toolRes));
        } else {
          pushPlainText(matchResult[0]);
        }
      } else if (res) {
        children.push(createResourceNode(res));
      } else {
        pushPlainText(matchResult[0]);
      }
    }

    // 追加剩余的纯文本
    if (lastIndex < text.length) {
      pushPlainText(text.slice(lastIndex));
    }
  }

  return children;
}
