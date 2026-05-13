import { IText, ITextObj } from '@/components/MessagesComp/Text';
import { isNil, set, get, compact } from 'lodash';
import type { IMessageListItem } from '@/typescript/message';
import { isTextContentType } from '@/utils/messgae';

function isTextObject(item: IText): item is ITextObj {
  return typeof item === 'object' && item !== null;
}

function findNodeByOrderId(nodes: IText[], orderId: string | number): ITextObj | undefined {
  for (const node of nodes) {
    if (isTextObject(node) && node.orderId === orderId) {
      return node;
    }
    if (isTextObject(node) && node.children?.length) {
      const found = findNodeByOrderId(node.children, orderId);
      if (found) return found;
    }
  }
  return undefined;
}

/** 在目标数组中查找 orderId 对应的节点，存在则追加文本，否则插入新节点 */
function upsertNode(target: ITextObj[], orderId: string | number, substance: unknown, newItem: ITextObj) {
  const existing = findNodeByOrderId(target, orderId);
  if (existing) {
    existing.text += String(substance);
  } else {
    target.push(newItem);
  }
}

export const ROOT_ORDER_ID = '-1';
export function buildSubstance(
  lastSubstance: unknown,
  substance: unknown,
  rootOrderId: string | number,
  parentOrderId?: string | number,
  orderId?: string | number
): IText[] | string {
  // 无 orderId：简单拼接模式
  if (!orderId) {
    if (Array.isArray(lastSubstance)) {
      return [...lastSubstance, substance as IText];
    }

    return parentOrderId ? compact([lastSubstance, substance] as IText[]) : `${lastSubstance ?? ''}${substance}`;
  }

  const newItem: ITextObj = { text: String(substance), parentOrderId, orderId };

  // lastSubstance 不是数组：初始化为数组
  if (!Array.isArray(lastSubstance)) {
    return !isNil(lastSubstance) && lastSubstance !== '' ? [lastSubstance as IText, newItem] : [newItem];
  }

  const result: IText[] = [...lastSubstance];
  const shouldInsertToParent = parentOrderId && `${rootOrderId}` !== `${parentOrderId}`;

  // 插入到父节点的 children 或顶层
  if (shouldInsertToParent) {
    const parent = findNodeByOrderId(result, parentOrderId);
    if (parent) {
      parent.children = parent.children || [];
      upsertNode(parent.children as ITextObj[], orderId, substance, newItem);
      return result;
    }
  }

  upsertNode(result, orderId, substance, newItem);
  return result;
}

export const substanceHandler = (
  newMessageItem: Partial<IMessageListItem>,
  lastMessageItem?: Partial<IMessageListItem>,
  rootOrderId: string | number = ROOT_ORDER_ID
) => {
  let myLastMessageItem: undefined | Partial<IMessageListItem> = lastMessageItem;

  if (!isTextContentType(myLastMessageItem?.contentType)) {
    myLastMessageItem = undefined;
  }

  const lastSubstance = get(myLastMessageItem, 'content.substance');
  const { substance, parentOrderId, orderId } = get(newMessageItem, 'content') || {};

  const newSubstance = buildSubstance(lastSubstance, substance, rootOrderId, parentOrderId, orderId);

  if (myLastMessageItem) {
    set(myLastMessageItem, 'content', {
      ...myLastMessageItem.content,
      ...newMessageItem.content,
      substance: newSubstance,
    });
  } else {
    set(newMessageItem, 'content.substance', newSubstance);
    return newMessageItem;
  }
};
