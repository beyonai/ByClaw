import { Editor, Element, Range, Transforms } from 'slate';
import { ELEMENT_MENTION, ELEMENT_RESOURCE, ELEMENT_EDITABLE } from '../utils/constants';
import { CustomElement } from '../types';

// withMention插件，禁止编辑mention/resource节点
export const withMention = (editor: Editor) => {
  const { isInline, isVoid } = editor;
  editor.isInline = (element: CustomElement) => {
    return [ELEMENT_MENTION, ELEMENT_RESOURCE, ELEMENT_EDITABLE].includes(element.type) ? true : isInline(element);
  };
  editor.isVoid = (element: CustomElement) => {
    return [ELEMENT_MENTION, ELEMENT_RESOURCE].includes(element.type) ? true : isVoid(element);
  };
  return editor;
};

// withEditableNavigation插件，处理可编辑节点的键盘导航
export const withEditableNavigation = (editor: Editor) => {
  const { deleteBackward, deleteForward } = editor;

  editor.deleteBackward = (unit) => {
    const { selection } = editor;

    if (selection && Range.isCollapsed(selection)) {
      // 1. 优先处理零宽字符（\u200B）：这是为了解决 Mention 后面插入的
      //    零宽字符在按 Backspace 时"看起来没有删东西"的问题。
      const { anchor } = selection;
      const beforePoint = Editor.before(editor, anchor, { unit: 'character' });
      if (beforePoint) {
        const range = Editor.range(editor, beforePoint, anchor);
        const char = Editor.string(editor, range);
        if (char === '\u200B') {
          // 先删掉零宽字符
          Transforms.delete(editor, { at: range });
          // 再执行一次原始 deleteBackward，从当前光标位置继续按正常规则处理，
          // 这样对用户来说一次 Backspace 仍然相当于删掉一个"可见"的单元。
          deleteBackward(unit);
          return;
        }
      }

      // 2. 检查光标前一个节点是否是 void 元素（ELEMENT_RESOURCE 或 ELEMENT_MENTION）
      //    如果是，删除该节点并正确设置光标位置
      const [start] = Range.edges(selection);
      const paragraphPath = start.path.slice(0, -1);
      const paragraph = Editor.node(editor, paragraphPath);
      const [paragraphNode] = paragraph;

      if (Element.isElement(paragraphNode) && paragraphNode.children) {
        const currentChildIndex = start.path[start.path.length - 1];
        const currentOffset = start.offset;
        const currentChild = paragraphNode.children[currentChildIndex];

        // 如果当前节点是文本节点且 offset 为 0，或者当前节点是 void 元素，检查前一个节点
        const shouldCheckPrevNode =
          (currentChild && 'text' in currentChild && currentOffset === 0) ||
          (Element.isElement(currentChild) &&
            (currentChild.type === ELEMENT_RESOURCE || currentChild.type === ELEMENT_MENTION));

        if (shouldCheckPrevNode && currentChildIndex > 0) {
          const prevChildIndex = currentChildIndex - 1;
          const prevChild = paragraphNode.children[prevChildIndex];

          if (
            Element.isElement(prevChild) &&
            (prevChild.type === ELEMENT_RESOURCE || prevChild.type === ELEMENT_MENTION)
          ) {
            // 前一个节点是 void 元素，删除它
            const voidElementPath = [...paragraphPath, prevChildIndex];
            Transforms.removeNodes(editor, { at: voidElementPath });

            // 设置光标位置：放在 void 元素前一个节点的末尾，如果 void 元素是第一个节点，则放在段落开始位置
            if (prevChildIndex > 0) {
              // void 元素前有节点，光标放在前一个节点之后
              const prevNodePath = [...paragraphPath, prevChildIndex - 1];
              try {
                const prevNodeEnd = Editor.end(editor, prevNodePath);
                Transforms.select(editor, prevNodeEnd);
              } catch (e) {
                // 如果前一个节点也是 void 元素，光标放在该位置
                Transforms.select(editor, Editor.start(editor, prevNodePath));
              }
            } else {
              // void 元素是第一个节点，光标放在段落开始位置
              Transforms.select(editor, Editor.start(editor, paragraphPath));
            }

            return;
          }
        }
      }

      // 3. 处理可编辑元素的导航
      const elementEntry = Editor.above(editor, {
        at: start,
        match: (n) => Element.isElement(n) && n.type === ELEMENT_EDITABLE,
      });

      if (elementEntry) {
        const [, path] = elementEntry;
        // 如果光标在可编辑元素的开始位置，跳出元素
        if (Editor.isStart(editor, start, path)) {
          return;
        }
      }
    }

    deleteBackward(unit);
  };

  editor.deleteForward = (unit) => {
    const { selection } = editor;

    if (selection && Range.isCollapsed(selection)) {
      const [start] = Range.edges(selection);
      const elementEntry = Editor.above(editor, {
        at: start,
        match: (n) => Element.isElement(n) && n.type === ELEMENT_EDITABLE,
      });

      if (elementEntry) {
        const [, path] = elementEntry;
        // 如果光标在可编辑元素的结束位置，跳出元素
        if (Editor.isEnd(editor, start, path)) {
          return;
        }
      }
    }

    deleteForward(unit);
  };

  return editor;
};
