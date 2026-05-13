import type { ITreeData } from './index';

export type CatalogItem = {
  catalogId: number;
  catalogName: string;
  pcatalogId: number;
  catalogPath: string;
};

/**
 * 字段映射配置
 */
export type FieldMapping<T = any> = {

  /** 节点ID字段名 */
  idField: keyof T;

  /** 父节点ID字段名 */
  parentIdField: keyof T;

  /** 显示标签字段名 */
  labelField: keyof T;

  /** 根节点的父ID值（当父ID等于此值时，视为根节点） */
  rootParentId?: any;

  /** 自定义key转换函数，默认使用 String(id) */
  keyTransform?: (id: any) => string;

  /** 自定义label转换函数，默认直接使用 labelField 的值 */
  labelTransform?: (label: any) => string;
};

/**
 * 将平铺的数据转换为 TreeFilter 需要的 ITreeData 树结构（通用方法）
 * @param list 平铺的数据列表
 * @param fieldMapping 字段映射配置
 */
export function buildTreeData<T = any>(list: T[], fieldMapping: FieldMapping<T>): ITreeData[] {
  const {
    idField,
    parentIdField,
    labelField,
    rootParentId = -1,
    keyTransform = (id) => String(id),
    labelTransform = (label) => String(label),
  } = fieldMapping;

  const nodeMap = new Map<any, ITreeData>();

  // 第一步：创建所有节点
  list.forEach((item) => {
    const id = item[idField];
    const label = item[labelField];

    nodeMap.set(id, {
      label: labelTransform(label) || keyTransform(id),
      key: keyTransform(id),
      keypath: '',
      children: [],
    });
  });

  const roots: ITreeData[] = [];

  // 第二步：构建父子关系
  list.forEach((item) => {
    const id = item[idField];
    const current = nodeMap.get(id);
    if (!current) return;

    const parentId = item[parentIdField];

    // 判断是否为根节点
    if (parentId === rootParentId || parentId === null || parentId === undefined) {
      roots.push(current);
      return;
    }

    const parent = nodeMap.get(parentId);
    if (!parent) {
      // 如果找不到父节点，也视为根节点
      roots.push(current);
      return;
    }

    if (!parent.children) {
      parent.children = [];
    }
    parent.children.push(current);
  });

  // 第三步：填充 keypath
  const fillKeypath = (nodes: ITreeData[], parentPath?: string) => {
    nodes.forEach((node) => {
      node.keypath = parentPath ? `${parentPath},${node.key}` : node.key;
      if (node.children && node.children.length > 0) {
        fillKeypath(node.children, node.keypath);
      } else {
        delete node.children;
      }
    });
  };

  fillKeypath(roots);
  return roots;
}

/**
 * 将平铺的目录数据转换为 TreeFilter 需要的 ITreeData 树结构（便捷方法，向后兼容）
 */
export const buildCatalogTreeData = (list: CatalogItem[]): ITreeData[] => {
  return buildTreeData<CatalogItem>(list, {
    idField: 'catalogId',
    parentIdField: 'pcatalogId',
    labelField: 'catalogName',
    rootParentId: -1,
  });
};
