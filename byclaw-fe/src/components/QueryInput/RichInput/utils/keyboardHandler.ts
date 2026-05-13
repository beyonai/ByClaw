import { Editor, Element, Range, Transforms } from 'slate';
import { ELEMENT_EDITABLE } from './constants';
import { PayloadType } from '../types';

const isLeftArrowKey = (event: React.KeyboardEvent) => {
  return event.key === 'ArrowLeft';
};
const isRightArrowKey = (event: React.KeyboardEvent) => {
  return event.key === 'ArrowRight';
};
const isEnterKey = (event: React.KeyboardEvent) => {
  return event.key === 'Enter';
};

interface KeyboardHandlerParams {
  editor: Editor;
  isComposing: React.RefObject<boolean>;
  onSend?: (payload: PayloadType) => void;
  getPayload: () => PayloadType;
  setText: (text: string) => void;
  canSend?: (payload: { text: string }) => boolean;
}

export const createKeyboardHandler = ({
  editor,
  isComposing,
  onSend,
  getPayload,
  setText,
  canSend,
}: KeyboardHandlerParams) => {
  return (event: React.KeyboardEvent) => {
    const { selection } = editor;

    // 处理左右箭头键导航
    if ((isLeftArrowKey(event) || isRightArrowKey(event)) && selection && Range.isCollapsed(selection)) {
      const [start] = Range.edges(selection);
      const elementEntry = Editor.above(editor, {
        at: start,
        match: (n) => Element.isElement(n) && n.type === ELEMENT_EDITABLE,
      });

      if (elementEntry) {
        // 光标在可编辑元素内部
        const [, path] = elementEntry;

        if (isLeftArrowKey(event)) {
          // 只有在可编辑元素的开始位置才跳出
          if (Editor.isStart(editor, start, path)) {
            event.preventDefault();
            try {
              const beforePoint = Editor.before(editor, Editor.start(editor, path));
              if (beforePoint) {
                Transforms.select(editor, beforePoint);
              } else {
                const paragraphPath = path.slice(0, -1);
                const paragraphStart = Editor.start(editor, paragraphPath);
                Transforms.select(editor, paragraphStart);
              }
            } catch (e) {
              const paragraphPath = path.slice(0, -1);
              const paragraphStart = Editor.start(editor, paragraphPath);
              Transforms.select(editor, paragraphStart);
            }
            return;
          }
        } else if (isRightArrowKey(event)) {
          // 对于右箭头键，使用一个更简单的策略
          // 先阻止默认行为，然后检查是否能在元素内向右移动
          event.preventDefault();

          const elementEnd = Editor.end(editor, path);
          const elementText = Editor.string(editor, path);

          if (elementText === '') {
            // 空元素，直接跳出
            const afterPoint = Editor.after(editor, elementEnd);
            if (afterPoint) {
              Transforms.select(editor, afterPoint);
            } else {
              const paragraphPath = path.slice(0, -1);
              const paragraphEnd = Editor.end(editor, paragraphPath);
              Transforms.select(editor, paragraphEnd);
            }
          } else {
            // 有内容的元素，尝试向右移动一个字符
            try {
              const nextPoint = Editor.after(editor, start, { unit: 'character' });
              if (nextPoint && nextPoint.path.length > path.length) {
                // 下一个位置在当前元素内，移动到那里
                Transforms.select(editor, nextPoint);
              } else {
                // 无法在元素内继续移动，跳出元素
                const afterPoint = Editor.after(editor, elementEnd);
                if (afterPoint) {
                  Transforms.select(editor, afterPoint);
                } else {
                  const paragraphPath = path.slice(0, -1);
                  const paragraphEnd = Editor.end(editor, paragraphPath);
                  Transforms.select(editor, paragraphEnd);
                }
              }
            } catch (e) {
              // 如果出错，跳出元素
              const afterPoint = Editor.after(editor, elementEnd);
              if (afterPoint) {
                Transforms.select(editor, afterPoint);
              } else {
                const paragraphPath = path.slice(0, -1);
                const paragraphEnd = Editor.end(editor, paragraphPath);
                Transforms.select(editor, paragraphEnd);
              }
            }
          }
          return;
        }
      } else {
        // 光标在可编辑元素外部，检查是否需要进入元素
        // 获取当前段落中的所有子节点
        const paragraphPath = start.path.slice(0, -1);
        const paragraph = Editor.node(editor, paragraphPath);
        const [paragraphNode] = paragraph;

        if (Element.isElement(paragraphNode) && paragraphNode.children) {
          const currentChildIndex = start.path[start.path.length - 1];
          const currentOffset = start.offset;

          if (isRightArrowKey(event)) {
            // 检查当前位置右侧是否有可编辑元素
            // 首先检查当前文本节点是否已经到末尾
            const currentChild = paragraphNode.children[currentChildIndex];
            if (currentChild && 'text' in currentChild && currentOffset >= currentChild.text.length) {
              // 当前文本节点已到末尾，检查下一个节点
              const nextChildIndex = currentChildIndex + 1;
              if (nextChildIndex < paragraphNode.children.length) {
                const nextChild = paragraphNode.children[nextChildIndex];
                if (Element.isElement(nextChild) && nextChild.type === ELEMENT_EDITABLE) {
                  // 下一个节点是可编辑元素，进入其开始位置
                  event.preventDefault();
                  const editablePath = [...paragraphPath, nextChildIndex];
                  const elementStart = Editor.start(editor, editablePath);
                  Transforms.select(editor, elementStart);
                  return;
                }
                if (Element.isElement(nextChild)) {
                  // 碰到了不可编辑的节点，检查再下一个节点是否为文本节点
                  const nextTextChild = paragraphNode.children[nextChildIndex + 1];
                  if (nextTextChild && nextTextChild.hasOwnProperty('text')) {
                    event.preventDefault();
                    const textChildPath = [...paragraphPath, nextChildIndex + 1];
                    Transforms.select(editor, Editor.start(editor, textChildPath));
                  }
                }
              }
            }
          } else if (isLeftArrowKey(event)) {
            // 检查当前位置左侧是否有可编辑元素
            // 首先检查当前文本节点是否在开始位置
            if (currentOffset === 0) {
              // 当前文本节点在开始位置，检查前一个节点
              const prevChildIndex = currentChildIndex - 1;
              if (prevChildIndex >= 0) {
                const prevChild = paragraphNode.children[prevChildIndex];
                if (Element.isElement(prevChild) && prevChild.type === ELEMENT_EDITABLE) {
                  // 前一个节点是可编辑元素，进入其结束位置
                  event.preventDefault();
                  const editablePath = [...paragraphPath, prevChildIndex];
                  const elementEnd = Editor.end(editor, editablePath);
                  Transforms.select(editor, elementEnd);
                  return;
                }
                if (prevChildIndex > 0 && Element.isElement(prevChild)) {
                  // 碰到了不可编辑的节点，检查再前一个节点是否为文本节点
                  const prevTextChild = paragraphNode.children[prevChildIndex - 1];
                  if (prevTextChild && prevTextChild.hasOwnProperty('text')) {
                    event.preventDefault();
                    const textChildPath = [...paragraphPath, prevChildIndex - 1];
                    Transforms.select(editor, Editor.end(editor, textChildPath));
                    return;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 回车发送
    if (isEnterKey(event)) {
      // shiftKey是默认的换行按键组合，直接return就可以换行了
      if (event.shiftKey || isComposing.current) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) && !event.altKey) {
        // 单独的回车键，发送消息
        event.preventDefault();
        if (onSend) {
          const payload = getPayload();
          if (payload.text.trim()) {
            if (typeof canSend === 'function' && !canSend(payload)) {
              return;
            }
            onSend(payload);
            setText('');
          }
          return;
        }
      } else {
        // 检查当前光标是否在节点内部
        const editableEntry = Editor.above(editor, {
          match: (n) => Element.isElement(n) && !!n.type && n.type !== 'paragraph',
        });
        if (editableEntry) {
          // 在可编辑元素内部，禁止换行
          event.preventDefault();
          return;
        }
      }
      // 手动换行
      editor.insertBreak();
    }
  };
};
