import { Editor, Element, Transforms } from 'slate';
import { ELEMENT_MENTION } from './constants';
import { MentionElementType } from '../elements/mention';
import { getDefaultAgentElementByValue } from '.';

/**
 * 检查两个mention元素是否相等（通过type和agentId判断）
 */
function isMentionElementEqual(element1: any, element2: any): boolean {
  if (!element1 || !element2) return false;
  if (element1.type !== element2.type) return false;
  if (element1.type === ELEMENT_MENTION) {
    return element1.agentId === element2.agentId;
  }
  return false;
}

function getFirstElement(editor: Editor) {
  const firstParagraph = editor.children[0] as any;
  if (!firstParagraph || !firstParagraph.children || firstParagraph.children.length === 0) {
    return null;
  }
  return firstParagraph.children[0];
}

/**
 * 检查第一个子元素是否为指定的defaultAgentElement
 */
function isFirstElementDefaultAgent(editor: Editor, defaultAgentElement: MentionElementType | undefined): boolean {
  if (!defaultAgentElement) return false;
  const currentFirstElement = getDefaultAgentElementByValue(editor.children);
  return isMentionElementEqual(currentFirstElement, defaultAgentElement);
}

/**
 * 在editor开始位置插入defaultAgentElement
 */
function insertDefaultAgentAtStart(editor: Editor, defaultAgentElement: MentionElementType): void {
  const firstParagraph = editor.children[0] as any;
  if (!firstParagraph || !firstParagraph.children) return;
  Transforms.insertNodes(editor, defaultAgentElement, { at: [0, 0] });
}

/**
 * 删除editor开始位置的defaultAgentElement
 */
export function removeDefaultAgentFromStart(editor: Editor): void {
  const defaultAgentElement = getDefaultAgentElementByValue(editor.children);
  if (!defaultAgentElement) return;

  // 查找第一个mention元素的位置
  const mentionNodes = Array.from(
    Editor.nodes(editor, {
      at: [0],
      mode: 'lowest',
      match: (node) => node === defaultAgentElement,
    })
  );

  if (mentionNodes.length > 0) {
    const [, path] = mentionNodes[0];
    // 删除找到的mention元素
    Transforms.removeNodes(editor, { at: path });
  }
}

/**
 * 删除editor中所有的mention元素
 */
export function removeAllMentionElements(editor: Editor): void {
  // 使用更安全的方式删除所有mention元素
  const mentionNodes = Array.from(
    Editor.nodes(editor, {
      at: [],
      mode: 'lowest',
      match: (node) => Element.isElement(node) && node.type === ELEMENT_MENTION,
    })
  );

  // 从后往前删除，避免路径变化问题
  for (let i = mentionNodes.length - 1; i >= 0; i -= 1) {
    const [, path] = mentionNodes[i];
    try {
      Transforms.removeNodes(editor, { at: path });
    } catch (e) {
      // 忽略删除失败的情况（节点可能已经被删除）
      console.warn('Failed to remove mention node:', e);
    }
  }
}

/**
 * 更新editor内容的主要函数
 * @param editor - Slate编辑器实例
 * @param defaultAgentElement - 默认agent元素
 * @param inAgentRoute - 是否在数字员工的路由下
 * @param lastChatMode - 上一次的chatMode
 * @param currentChatMode - 当前的chatMode
 */
export function updateEditorContent(
  editor: Editor,
  defaultAgentElement: MentionElementType | undefined,
  inAgentRoute: boolean,
): void {
  // 2. 处理defaultAgentElement的添加/删除
  const shouldShowDefaultAgent = !inAgentRoute && !!defaultAgentElement;
  const hasDefaultAgent = isFirstElementDefaultAgent(editor, defaultAgentElement);

  if (shouldShowDefaultAgent && !hasDefaultAgent) {
    removeDefaultAgentFromStart(editor);
    // 需要显示defaultAgentElement但当前没有，则添加
    insertDefaultAgentAtStart(editor, defaultAgentElement);
  } else if (!shouldShowDefaultAgent && hasDefaultAgent) {
    // 不需要显示defaultAgentElement但当前有，则删除
    removeDefaultAgentFromStart(editor);
  } else if (shouldShowDefaultAgent && hasDefaultAgent) {
    const firstElement = getFirstElement(editor);
    if (firstElement && !firstElement.isDefaultAgent) {
      // 需要显示defaultAgentElement但当前有，且不是defaultAgentElement，则删除，再添加
      removeDefaultAgentFromStart(editor);
      insertDefaultAgentAtStart(editor, defaultAgentElement);
    }
  }
}
