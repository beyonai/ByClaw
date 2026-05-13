import { SSEMessageType } from '@/constants/message';
import { get, set } from 'lodash';
import type { IMessageListItem } from '@/typescript/message';
import type { TreeNode } from './typescript';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

const ROOT_ORDER_ID = '-1';

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

const coverExistedNodeHandlers: {
  [key in SSEMessageType]?: (existingNode: TreeNode, item: IMessageListItem) => void;
} = {
  [SSEMessageType.thinkStatusTitle]: (existingNode: TreeNode, item: IMessageListItem) => {
    set(existingNode, 'content.substance.status', get(item, 'content.substance.status'));
  },
};

export const transformList = (flatList: IMessageListItem[], isStreamEnd: boolean, messageId?: string): TreeNode[] => {
  const result: TreeNode[] = [];
  let currentRoot: TreeNode | null = null;
  let currentParent: TreeNode | null = null;

  const groupNodes = new Map<string, TreeNode>();
  flatList.forEach((item, messageIdx) => {
    const newNode: TreeNode = {
      messageIdx,
      ...item,
      isCollapsed: false,
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
          currentRoot.isCollapsed = true;
          currentRoot.messageLoadingStatus = 1;
        }
        // 如果前一个父节点存在，也需要折叠
        if (currentParent) {
          currentParent.isCollapsed = true;
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
            existingNode.isCollapsed = true;
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
            prevSibling.isCollapsed = true;
          }
        }

        currentParent = newNode;
        groupNodes.set(newNodeOrderId, newNode);
        break;
      }

      default: {
        if (currentParent) {
          if (item?.objectType === 'function_response' && !currentParent.shouldOpen) {
            // 工具类回答主动折叠
            currentParent.isCollapsed = true;
          }

          let myShouldOpen = true;
          switch (`${newNode.contentType}`) {
            case `${SSEMessageType.text}`:
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
              myShouldOpen = false;
              break;
            case `${SSEMessageType.thinkTaskUserInput}`: {
              const formStatus = get(newNode, 'content.substance.formStatus');
              if (formStatus !== IFormStatus.INIT) {
                myShouldOpen = false;
              }
              break;
            }
            default:
              myShouldOpen = true;
              break;
          }

          if (myShouldOpen) {
            if (currentRoot && !currentRoot.shouldOpen) {
              currentRoot.shouldOpen = true;
              currentRoot.isCollapsed = false;
            }
            if (currentParent && !currentParent.shouldOpen) {
              currentParent.shouldOpen = true;
              currentParent.isCollapsed = false;
            }
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
        } else {
          result.push(newNode);
        }
        break;
      }
    }
  });

  // 更新所有非最后一个根节点的图标状态
  for (let i = result.length - 1; i >= 0; i -= 1) {
    if (i !== result.length - 1 || isStreamEnd) {
      const item = result[i];
      if (!item.shouldOpen) {
        result[i].messageLoadingStatus = 1;
        result[i].isCollapsed = true;
      }
    }
  }

  groupNodes.clear();
  return result;
};
