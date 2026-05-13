import React, { useCallback, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef } from 'react';
import { createEditor, Descendant, Transforms, Editor, Element, Range } from 'slate';
import { Slate, Editable, withReact, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import { useIntl } from '@umijs/max';
import { chatModeMap } from '@/constants/query';
import MentionPopover from './mentionPopover';
import styles from './index.module.less';
import { getDropData } from './utils/drag';
import { ResourceType, ELEMENT_MENTION, ELEMENT_RESOURCE } from './utils/constants';
import {
  getInputText,
  getDefaultAgentByValue,
  getNodesByTemplate,
  getResourceList,
  createCheckMentionTrigger,
  setSelectionAfterInsert,
  getAgentPlaceholder,
  getNodeResourceData,
  getCurrentTriggerText,
  getDescendantValueByDefaultValue,
  handleMentionCompositionStart,
} from './utils';
import { updateEditorContent } from './utils/editorContentUpdater';
import { elementRender } from './renderers/elementRender';
import getElementData, { getElementDisplayText } from './utils/getElementData';
import { withMention, withEditableNavigation } from './plugins';
import { Props, ParagraphElementType, PayloadType, IResourceType, MentionTriggerInfo, Resource } from './types';
import { createKeyboardHandler } from './utils/keyboardHandler';
import useDefaultAgentPlaceholder from './useDefaultAgentPlaceholder';
import { setAgentCache } from './agentCache';
import useDefaultAgentElement from './useDefaultAgentElement';
import useOnPaste from './useOnPaste';
import useGlobal from '@/hooks/useGlobal';

type SetTextParams = string | Parameters<typeof getDescendantValueByDefaultValue>[0];

/** 带 aria-label 的 Editable 根元素，用于无障碍与测试定位（slate-react 未将 aria-label 透传到 DOM） */
const EditableRootWithAria = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div {...props} ref={ref} aria-label="byai-input" />
));
EditableRootWithAria.displayName = 'EditableRootWithAria';

export interface RichInputRef {
  setText: (val: SetTextParams) => void;
  appendText: (text: string) => void;
  insertItem: (item: any, type: IResourceType) => any;
  getPayload: () => PayloadType;
}

type RichInputResourceList = Resource[];

export { RichInputResourceList };

// 主组件
const RichInput = forwardRef<RichInputRef, Props>((props, ref) => {
  const { style, chatMode, agentType, onChange, onSend, inAgentRoute, agentId, defaultPlaceholder, canSend, canQuote } =
    props;
  const intl = useIntl();
  const [mentionPopoverData, setMentionPopoverData] = useState<Partial<MentionTriggerInfo>>({});
  const mentionType = mentionPopoverData.type;
  const editor = useMemo<Editor>(() => withEditableNavigation(withMention(withHistory(withReact(createEditor())))), []);
  const isFirstAutoOnChange = useRef(true);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const lastChatModeRef = useRef(chatMode);
  const { EventEmitter } = useGlobal();

  /**
   * 在专家模式下，通过@切换某个agent后，需要显示一个默认的agent在输入框的最左侧
   */
  const defaultAgentElement = useDefaultAgentElement({ agentType, agentId });

  const [value, setValue] = useState<Descendant[]>([
    {
      children: [{ text: '' }],
      type: 'paragraph',
    },
  ]);

  useEffect(() => {
    // 更新输入框的内容
    updateEditorContent(editor, defaultAgentElement, !!inAgentRoute);
    // 更新lastChatModeRef
    lastChatModeRef.current = chatMode;
  }, [inAgentRoute, defaultAgentElement, chatMode, editor]);

  const placeholder = useMemo(() => {
    if (defaultPlaceholder) return defaultPlaceholder;

    if (defaultAgentElement?.agentType) {
      // 当前切到了慧笔｜问数，inAgentRoute为true，则展示各自的placeholder
      return getAgentPlaceholder(intl, defaultAgentElement.agentType);
    }
    // 其余情况根据chatMode来显示
    if (chatMode === chatModeMap.expert) {
      return intl.formatMessage({ id: 'chat.expert.placeholder' });
    }
    return intl.formatMessage({ id: 'chat.placeholder' });
  }, [chatMode, defaultAgentElement, defaultPlaceholder]);

  /**
   * agentPlaceholder 不同于传入给slate的placeholder。传入slate的placeholder是指在输入框没有任何内容的时候显示的内容，
   * 而agentPlaceholder是指，在选择了某个agent后（如慧笔、问数），在后面展示的placeholder内容
   * 但是一旦展示了某个agent在输入框最前面，那就意味着输入框不为空，placeholder也就失效了。因此，这里自己实现了一个
   */
  const { agentPlaceholder, isComposing } = useDefaultAgentPlaceholder(value, editorWrapRef, placeholder);

  useEffect(() => {
    // 确保编辑器已经渲染完成后再设置光标位置
    setTimeout(() => {
      try {
        // 将光标移动到编辑器的最后位置
        Transforms.select(editor, Editor.end(editor, []));
        ReactEditor.focus(editor);
      } catch (e) {
        //
      }
    }, 0);
  }, []);

  const checkIfCanAt = (isInputting: boolean) => {
    if (inAgentRoute) {
      return false;
    }
    if (chatMode === chatModeMap.expert) {
      const text = Editor.string(editor, []);
      const atNodes = Editor.nodes(editor, {
        at: [],
        mode: 'lowest',
        match: (ele) => Element.isElement(ele) && ele.type === ELEMENT_MENTION,
      });
      // 专家模式只允许@一次
      if (!atNodes.next().done) return false;
      if (isInputting) {
        // 输入中，必须有输入个@在前面
        return !!text && text.startsWith('@');
      }
      // drop进来的，必须是没有内容
      return !text;
    }

    return false;
  };

  const checkIfCanQuote = useCallback(() => !!canQuote, [canQuote]);

  const checkMentionTrigger = createCheckMentionTrigger(editor, checkIfCanAt, checkIfCanQuote);

  const setText = (val: SetTextParams) => {
    // 保留 isDefaultAgent=true 的 mention 节点，清空其后内容
    const paragraph = editor.children[0];
    if (Element.isElement(paragraph) && paragraph.children) {
      // 找到所有需要保留的节点（isDefaultAgent=true 的 mention 节点）
      const nodesToKeep = paragraph.children.filter(
        (child: any) => child.type === ELEMENT_MENTION && child.isDefaultAgent
      );

      let newNodes: Descendant[] = [];
      if (typeof val === 'string') {
        newNodes = getNodesByTemplate(val);
      } else {
        newNodes = getDescendantValueByDefaultValue(val);
      }

      // 构建新的段落内容：保留的节点 + 新文本
      const newChildren = [...nodesToKeep, ...newNodes];

      // 新的段落内容
      const newParagraph: ParagraphElementType = {
        type: 'paragraph' as const,
        children: newChildren,
      };

      // 先清空
      for (let i = value.length - 1; i >= 0; i -= 1) {
        editor.removeNodes({ at: [i] });
      }
      // 设置新的段落内容
      Transforms.insertNodes(editor, newParagraph, { at: [0] });

      // 将光标移到最后
      Transforms.select(editor, Editor.end(editor, []));
      ReactEditor.focus(editor); // 聚焦
    }
  };

  const getPayload = (): PayloadType => {
    const text = getInputText(value);
    // resourceList是指此次输入包含了哪些引用的数字员工、文件、知识库等
    const resourceList = getResourceList(value);
    if (!resourceList.length && defaultAgentElement) {
      // 场景是：从【发现】点击任意数字员工，切换路由，此时输入框最前面并不会展示这个数字员工，从value获取到的resourceList自然就是空的(defaultAgentElement有值)
      // 但是，这种情况下，依然表示引用了这个数字员工，因此resourceList要传入
      resourceList.push(getNodeResourceData(defaultAgentElement));
    }
    let payload: PayloadType = {
      ...text,
      agentType,
      resourceList,
    };
    // !inAgentRoute（也就是【不处于】慧笔｜问数的路由下）
    if (!inAgentRoute) {
      const defaultAgent = getDefaultAgentByValue(value);
      // 看一下有没有把默认的agent删掉了，没有删掉才带着agentInfo
      if (defaultAgent) {
        payload = {
          ...payload,
          ...defaultAgent,
        };
      }
    }
    return payload;
  };

  // 监听@/#触发弹窗和编辑器状态变化
  const onKeyDown = createKeyboardHandler({
    editor,
    isComposing,
    onSend,
    getPayload,
    setText,
    canSend,
  });

  const handleCloseMention = useCallback(() => {
    setMentionPopoverData({});
  }, []);

  // 这个onchange不仅仅包括输入，光标的变化也会触发
  const myOnChange = (value: Descendant[]) => {
    setValue(value);
    // 组合输入阶段（中文输入法等），只同步 Slate 内部 value，不做额外副作用，
    // 避免在 IME 尚未结束时频繁依赖 selection / DOM 导致光标错乱和字符丢失。
    if (isComposing.current) {
      return;
    }
    checkMentionTrigger().then((triggerInfo) => {
      if (triggerInfo) {
        if (triggerInfo.type === '#' && !checkIfCanQuote()) {
          return;
        }
        setMentionPopoverData(triggerInfo);
      } else if (mentionType) {
        handleCloseMention();
      }
    });
  };

  useEffect(() => {
    // 处于组合输入阶段时，不对外触发 onChange，等 composition 结束后再根据最终内容出 payload，
    // 可以避免在连续输入拼音时多次外部渲染打断 IME 的内部状态。
    // 这里加个setTimeout，因为ios手机端的onCompositionEnd事件会晚于onChange事件，导致onChange事件触发时，isComposing.current为false
    setTimeout(() => {
      if (isComposing.current) {
        return;
      }
      if (isFirstAutoOnChange.current) {
        // mounted之后的第一次不触发onchange
        isFirstAutoOnChange.current = false;
        return;
      }
      const payload = getPayload();
      if (onChange) {
        onChange(payload);
      }
    });
  }, [value]);

  const checkIsDefaultAgent = useCallback(
    (data: any, strict?: boolean) => {
      const currentText = Editor.string(editor, []);
      // 专家模式下第一个@的智能体
      return (
        chatMode === chatModeMap.expert &&
        !!data.agentType &&
        (!currentText || (strict ? currentText === '@' : currentText.startsWith('@')))
      );
    },
    [editor, chatMode]
  );

  // 插入popover节点
  const insertItem = (item: any, type: IResourceType) => {
    let node = getElementData(type, item);

    // 如果选择的是数字员工类型，那就用一个map来缓存。这样，专家模式时，就可以直接利用这个map来渲染输入框最前面默认的agent了
    if (type === ResourceType.digitalEmployee) {
      setAgentCache(node);
      node = {
        ...node,
        // @ts-ignore
        isDefaultAgent: checkIsDefaultAgent(item),
      };
    } else if (type === ResourceType.agentTool) {
      if (chatMode === chatModeMap.expert && !agentId) {
        // 当前没有@任何数字员工，但是直接选择了某个数字员工的技能，那么拆分成两步：
        // 1. 先@这个数字员工
        // 2. 再选择技能
        const resourceList = getResourceList([node]);
        const { text } = getInputText([node]);
        EventEmitter.emit('queryInput-set-schema', {
          agentId: node.agentId,
          agentType: node.agentType,
          queryQuestion: '',
          inputSchema: {
            text,
            resourceList,
          },
        });
        return;
      }
      if (agentId && `${agentId}` === `${node.agentId}`) {
        // 当前模式是专家模式，并且选择了当前数字员工的技能，那么就不需要展示数字员工的名称，直接展示技能名称就好
        node.name = node.resourceName;
        delete node.chatAvatar;
        node.children = [{ text: getElementDisplayText({ resourceType: type, data: { name: node.resourceName } }) }];
      }
    }
    const willReRenderInput =
      // @ts-ignore
      !!node.isDefaultAgent && checkIfCanAt(true) && node.agentType !== agentType;
    ReactEditor.focus(editor);
    // 删掉输入的@/#及其后面的连续字符
    const beforeText = getCurrentTriggerText(editor);
    if (beforeText && (beforeText.startsWith('@') || beforeText.startsWith('#'))) {
      const { selection } = editor;
      if (selection && Range.isCollapsed(selection)) {
        const endPoint = selection.anchor;
        let startPoint = endPoint;

        for (let i = 0; i < beforeText.length; i += 1) {
          const prev = Editor.before(editor, startPoint, { unit: 'character' });
          if (!prev) break;
          startPoint = prev;
        }

        Transforms.delete(editor, { at: { anchor: startPoint, focus: endPoint } });
      }
    }
    if (willReRenderInput) {
      // 不需要insertNodes，这里触发onChange之后，defaultAgentElement会更新，从useEffect中插入即可
      onChange?.({
        text: '',
        displayText: '',
        agentId: node.agentId,
        agentType: node.agentType,
        resourceList: getResourceList([
          {
            type: 'paragraph',
            children: [node],
          },
        ]),
      });
      handleCloseMention();
      return;
    }
    const originalPoint = editor.selection?.anchor;
    Transforms.insertNodes(editor, node);
    setTimeout(() => {
      setSelectionAfterInsert(editor, node, originalPoint);
    });
    handleCloseMention();
  };

  const onDrop = (e: React.DragEvent) => {
    // 原有的内部数据拖拽逻辑
    const node = getDropData(e);
    if (!node) return;
    if (node.resourceType === ResourceType.digitalEmployee) {
      setAgentCache(node);
    }
    let insertNode = node;
    if (node.type === ELEMENT_MENTION) {
      const isSuperAssistant = node.resourceType === ResourceType.superAssistant;
      if (chatMode === chatModeMap.expert && isSuperAssistant) {
        // 专家模式不允许@企业员工的超级助手
        return;
      }
      if (!checkIfCanAt(false)) {
        // 基础问答模式，没有输入过内容，拖拽agent过来，直接切换为专家模式
        const isBaseMode2ExpertMode =
          chatMode === chatModeMap.base && node.agentType && !isSuperAssistant && !Editor.string(editor, []);
        if (isBaseMode2ExpertMode) {
          const payload: PayloadType = {
            text: '',
            displayText: '',
            agentId: node.agentId,
            agentType: node.agentType,
            resourceList: [],
          };
          onChange?.(payload);
        }
        return;
      }
      insertNode = {
        ...node,
        isDefaultAgent: checkIsDefaultAgent(node, true),
      };
    }
    if (node.type === ELEMENT_RESOURCE) {
      if (!checkIfCanQuote()) return;
    }
    const insertionPoint = editor.selection?.anchor;
    Transforms.insertNodes(editor, insertNode);
    // 这里必须加setTimeout，不然后面要执行的函数可能还拿不到最新的内容
    setTimeout(() => {
      setSelectionAfterInsert(editor, insertNode, insertionPoint);
    });
  };

  useImperativeHandle(ref, () => ({
    setText,
    insertItem,
    appendText: (text: string) => {
      Transforms.insertText(editor, text);
    },
    getPayload,
  }));

  const onPaste = useOnPaste({
    editor,
    chatMode,
    agentId,
    onPasteFiles: props.onPasteFiles,
  });

  return (
    <div className={styles.wrap} style={style}>
      <Slate editor={editor} initialValue={value} onValueChange={setValue} onChange={myOnChange}>
        <div className={styles.editorWrap} ref={editorWrapRef}>
          <Editable
            as={EditableRootWithAria}
            autoComplete="off"
            onDragOver={(e) => {
              e.preventDefault();
            }}
            renderElement={elementRender}
            placeholder={placeholder}
            onKeyDown={onKeyDown}
            className={styles.slate}
            onDrop={onDrop}
            onPaste={onPaste}
            onCompositionStart={() => {
              handleMentionCompositionStart(editor, isComposing);
            }}
            onCompositionEnd={() => {
              isComposing.current = false;
            }}
          />
          {agentPlaceholder}
        </div>
      </Slate>
      <MentionPopover
        key={agentId}
        agentId={agentId}
        type={mentionType as '@' | '#'}
        onSelect={insertItem}
        popoverPos={mentionPopoverData.position}
        inputText={mentionPopoverData.inputText}
        onClose={handleCloseMention}
        chatMode={chatMode}
        resourceAgentIds={props.resourceAgentIds}
      />
    </div>
  );
});

export default RichInput;
