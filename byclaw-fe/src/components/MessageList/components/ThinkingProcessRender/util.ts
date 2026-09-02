import { SSEMessageType } from '@/constants/message';
import { get, isPlainObject, set } from 'lodash';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import type { TreeNode } from './typescript';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import { isPendingEasyConfirmListItem } from '@/components/MessagesComp/easyConfirm';

const ROOT_ORDER_ID = '-1';
const TERMINAL_THINK_STATUS_TITLE_STATUSES = new Set(['_DONE_', '_ERROR_']);

/** 状态标题在执行期间保持展开，仅在收到终态事件后折叠。 */
const isTerminalThinkStatusTitle = (item: IMessageListItem) =>
  `${item.contentType}` === `${SSEMessageType.thinkStatusTitle}` &&
  TERMINAL_THINK_STATUS_TITLE_STATUSES.has(`${get(item, 'content.substance.status', '')}`);

/** 通用树规则不能提前收起仍在执行的状态标题。 */
const collapseTreeNode = (node: TreeNode) => {
  if (`${node.contentType}` === `${SSEMessageType.thinkStatusTitle}` && !isTerminalThinkStatusTitle(node)) return;
  node.isCollapsed = true;
};

const findParentTreeNode = (result: TreeNode[], parentOrderId: string): TreeNode | null => {
  for (const node of result) {
    const orderId = get(node, 'content.orderId');
    if (`${orderId}` === `${parentOrderId}`) {
      return node;
    }

    if (node.children?.length) {
      const matchedNode = findParentTreeNode(node.children as TreeNode[], parentOrderId);
      if (matchedNode) {
        return matchedNode;
      }
    }
  }

  return null;
};

/**
 * 保留流中兄弟节点的先后顺序，仅在子节点早于显式父节点到达时把父节点前置。
 * 旧的 contentType 排序会把所有 3009 提到文本和 JSON 之前，导致嵌套树失去真实执行顺序。
 */
const sortParentsBeforeChildren = (flatList: IMessageListItem[]) => {
  const pending = [...flatList];
  const result: IMessageListItem[] = [];
  const emittedOrderIds = new Set<string>();
  const allOrderIds = new Set(flatList.map((item) => `${get(item, 'content.orderId', '')}`).filter(Boolean));

  while (pending.length > 0) {
    let emittedInPass = false;

    for (let index = 0; index < pending.length; ) {
      const item = pending[index];
      const parentOrderId = `${get(item, 'content.parentOrderId', '')}`;
      const waitsForKnownParent =
        parentOrderId &&
        parentOrderId !== ROOT_ORDER_ID &&
        allOrderIds.has(parentOrderId) &&
        !emittedOrderIds.has(parentOrderId);

      if (waitsForKnownParent) {
        index += 1;
        continue;
      }

      result.push(item);
      const orderId = `${get(item, 'content.orderId', '')}`;
      if (orderId) {
        emittedOrderIds.add(orderId);
      }
      pending.splice(index, 1);
      emittedInPass = true;
    }

    if (!emittedInPass) {
      // 非法循环引用不应阻断整棵思考树，按原始剩余顺序降级展示。
      result.push(...pending);
      break;
    }
  }

  return result;
};

const coverExistedNodeHandlers: {
  [key in SSEMessageType]?: (existingNode: TreeNode, item: IMessageListItem) => void;
} = {
  [SSEMessageType.thinkStatusTitle]: (existingNode: TreeNode, item: IMessageListItem) => {
    const existingSubstance = get(existingNode, 'content.substance');
    const incomingSubstance = get(item, 'content.substance');
    set(
      existingNode,
      'content.substance',
      isPlainObject(existingSubstance) && isPlainObject(incomingSubstance)
        ? { ...existingSubstance, ...incomingSubstance }
        : incomingSubstance
    );
    existingNode.isCollapsed = isTerminalThinkStatusTitle(item);
  },
};

const markPendingEasyConfirmBranchesOpen = (nodes: TreeNode[], message?: IMessage): boolean => {
  if (!message) return false;

  return nodes.reduce((hasPendingItem, node) => {
    const childHasPendingItem = markPendingEasyConfirmBranchesOpen(node.children || [], message);
    const currentNodeIsPending = isPendingEasyConfirmListItem(message, node);
    if (childHasPendingItem) {
      node.shouldOpen = true;
      node.isCollapsed = false;
    }
    return hasPendingItem || currentNodeIsPending || childHasPendingItem;
  }, false);
};

export const transformList = (
  flatList: IMessageListItem[],
  isStreamEnd: boolean,
  messageId?: string,
  message?: IMessage
): TreeNode[] => {
  const result: TreeNode[] = [];
  let currentRoot: TreeNode | null = null;
  let currentParent: TreeNode | null = null;

  const groupNodes = new Map<string, TreeNode>();

  sortParentsBeforeChildren(flatList).forEach((item, messageIdx) => {
    const newNode: TreeNode = {
      messageIdx,
      ...item,
      isCollapsed:
        `${item.contentType}` === `${SSEMessageType.thinkStatusTitle}` ? isTerminalThinkStatusTitle(item) : true,
      messageLoadingStatus: 2, // 进行中 - 2(默认); 已完成 - 1
      children: [], // 显式初始化 children 为 TreeNode[] 类型
    };

    const newNodeOrderId = get(newNode, 'content.orderId');

    // 处理不同类型节点
    switch (`${item.contentType}`) {
      case `${SSEMessageType.thinkRootTitle}`: {
        // 遇到新根节点
        newNode.children = [];

        // 标记前一个根节点为已完成
        if (currentRoot) {
          collapseTreeNode(currentRoot);
          currentRoot.messageLoadingStatus = 1;
        }
        // 如果前一个父节点存在，也需要折叠
        if (currentParent) {
          collapseTreeNode(currentParent);
        }

        result.push(newNode);
        currentRoot = newNode;
        currentParent = null;
        groupNodes.set(newNodeOrderId, newNode);
        break;
      }
      case `${SSEMessageType.thinkTitle}`:
      case `${SSEMessageType.thinkStatusTitle}`: {
        // duplicate think title, ignore it
        if (groupNodes.has(newNodeOrderId)) {
          const existingNode = groupNodes.get(newNodeOrderId);
          if (existingNode) {
            const coverHandler = coverExistedNodeHandlers[`${existingNode.contentType}`];
            if (typeof coverHandler === 'function') {
              coverHandler(existingNode, item);
            } else {
              set(existingNode, 'content.substance', item.content.substance);
            }
            break;
          }
        }

        const parentOrderId = `${get(newNode, 'content.parentOrderId', '')}`;
        const hasExplicitParent = parentOrderId && ![messageId, ROOT_ORDER_ID].filter(Boolean).includes(parentOrderId);
        if (hasExplicitParent) {
          const explicitParent = groupNodes.get(parentOrderId) || findParentTreeNode(result, parentOrderId);
          if (explicitParent) {
            explicitParent.children = explicitParent.children || [];
            explicitParent.children.push(newNode);
            currentParent = newNode;
            groupNodes.set(newNodeOrderId, newNode);
            break;
          }
        }

        if (!currentRoot) {
          // 没有根节点时作为顶级节点
          newNode.children = [];
          result.push(newNode);
          currentParent = newNode;
          groupNodes.set(newNodeOrderId, newNode);
          break;
        }

        // 添加到当前根节点
        newNode.children = [];
        currentRoot.children = currentRoot.children || [];
        currentRoot.children.push(newNode);

        // 折叠前一个同级节点
        if (currentRoot.children.length > 1) {
          const prevSibling = currentRoot.children[currentRoot.children.length - 2];
          if (
            `${prevSibling.contentType}` === `${SSEMessageType.thinkTitle}` ||
            `${prevSibling.contentType}` === `${SSEMessageType.thinkStatusTitle}`
          ) {
            collapseTreeNode(prevSibling);
          }
        }

        currentParent = newNode;
        groupNodes.set(newNodeOrderId, newNode);
        break;
      }

      default: {
        let myShouldOpen = false;

        if (currentParent) {
          if (item?.objectType === 'function_response' && !currentParent.shouldOpen) {
            // 工具类回答主动折叠
            collapseTreeNode(currentParent);
          }

          switch (`${newNode.contentType}`) {
            case `${SSEMessageType.text}`:
            case `${SSEMessageType.thinkText}`:
            case `${SSEMessageType.slientHandler}`:
            case `${SSEMessageType.thinkTitle}`:
            case `${SSEMessageType.thinkSubTitle}`:
            case `${SSEMessageType.thinkStatusTitle}`:
            case `${SSEMessageType.thinkRootTitle}`:
            case `${SSEMessageType.thinkResource}`:
            case `${SSEMessageType.thinkResourceFile}`:
            case `${SSEMessageType.thinkTaskPrepare}`:
            case `${SSEMessageType.thinkTaskExecute}`:
            case `${SSEMessageType.thinkTaskResult}`:
            case `${SSEMessageType.jsonBlock}`:
              myShouldOpen = false;
              break;
            case `${SSEMessageType.thinkTaskUserInput}`: {
              const formStatus = get(newNode, 'content.substance.formStatus');
              if (formStatus !== IFormStatus.INIT) {
                myShouldOpen = false;
              }
              break;
            }
            case `${SSEMessageType.approvalForm}`: {
              const substance = get(newNode, 'content.substance') || [];
              const hasNotconfirmed = substance.find((item: { confirmed?: boolean }) => !item.confirmed);
              myShouldOpen = hasNotconfirmed;
              break;
            }
            default:
              myShouldOpen = false;
              break;
          }
        }

        // 叶子节点
        let targetParent = currentParent || currentRoot;
        const newNodeOrderParentOrderId = get(newNode, 'content.parentOrderId');
        if (newNodeOrderParentOrderId) {
          if ([messageId, ROOT_ORDER_ID].includes(newNodeOrderParentOrderId)) {
            targetParent = null;
          } else {
            targetParent = findParentTreeNode(result, newNodeOrderParentOrderId) || targetParent;
          }
        }

        if (targetParent) {
          targetParent.children = targetParent.children || [];
          targetParent.children.push(newNode);

          if (myShouldOpen) {
            if (currentRoot && !currentRoot.shouldOpen) {
              currentRoot.shouldOpen = true;
              currentRoot.isCollapsed = false;
            }
            if (targetParent && !targetParent.shouldOpen) {
              targetParent.shouldOpen = true;
              targetParent.isCollapsed = false;
            }
          }
        } else {
          result.push(newNode);
        }

        break;
      }
    }
  });

  markPendingEasyConfirmBranchesOpen(result, message);

  // 更新所有非最后一个根节点的图标状态
  for (let i = result.length - 1; i >= 0; i -= 1) {
    if (i !== result.length - 1 || isStreamEnd) {
      const item = result[i];
      if (!item.shouldOpen) {
        result[i].messageLoadingStatus = 1;
        collapseTreeNode(result[i]);
      }
    }
  }

  groupNodes.clear();
  return result;
};
