import { IKnowledgeDetailTreeItem } from './types';

export const updateTreeNode = (
  list: IKnowledgeDetailTreeItem[],
  key: React.Key,
  data: Partial<IKnowledgeDetailTreeItem>
): IKnowledgeDetailTreeItem[] =>
  list.map((node) => {
    if (node.key === key) {
      return {
        ...node,
        ...data,
      };
    }
    if (node.children) {
      return {
        ...node,
        children: updateTreeNode(node.children, key, data),
      };
    }
    return node;
  });

export const deleteTreeNode = (list: IKnowledgeDetailTreeItem[], key: React.Key): IKnowledgeDetailTreeItem[] =>
  list
    .map((node) => {
      if (node.key === key) {
        return null;
      }
      if (node.children) {
        return {
          ...node,
          children: deleteTreeNode(node.children, key),
        };
      }
      return node;
    })
    .filter((item) => item !== null);
