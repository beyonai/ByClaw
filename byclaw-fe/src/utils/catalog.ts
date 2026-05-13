export type FlattenedCatalog = {
  catalogId: string | number;
  catalogName: string;
  level: number;
};

const getParentCatalogId = (item: any) =>
  item?.pcatalogId ?? item?.pCatalogId ?? item?.parentCatalogId ?? item?.parentDirId;

const getCatalogName = (item: any) => item?.catalogName ?? item?.dirName ?? item?.name ?? '';

const hasChildren = (list: any[] = []) =>
  list.some((item) => Array.isArray(item?.children) && item.children.length > 0);

export const normalizeCatalogTree = (list: any[] = []): any[] => {
  if (!Array.isArray(list)) return [];

  return list.map((item) => {
    const normalized = {
      ...item,
      pcatalogId: getParentCatalogId(item),
    };

    if (Array.isArray(item?.children)) {
      normalized.children = normalizeCatalogTree(item.children);
    }

    return normalized;
  });
};

export const flattenCatalogTree = (list: any[] = []): FlattenedCatalog[] => {
  if (!Array.isArray(list) || list.length === 0) return [];

  const result: FlattenedCatalog[] = [];

  const walk = (nodes: any[], level = 0) => {
    nodes.forEach((item) => {
      if (item?.catalogId === undefined || item?.catalogId === null) return;

      result.push({
        catalogId: item.catalogId,
        catalogName: getCatalogName(item),
        level,
      });

      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children, level + 1);
      }
    });
  };

  if (hasChildren(list)) {
    walk(list);
    return result;
  }

  const idSet = new Set(list.map((item) => `${item?.catalogId}`));
  const childrenMap = new Map<string, any[]>();
  const roots: any[] = [];

  list.forEach((item) => {
    const parentId = getParentCatalogId(item);

    if (parentId !== undefined && parentId !== null && idSet.has(`${parentId}`)) {
      const key = `${parentId}`;
      childrenMap.set(key, [...(childrenMap.get(key) || []), item]);
      return;
    }

    roots.push(item);
  });

  const walkFlat = (nodes: any[], level = 0) => {
    nodes.forEach((item) => {
      if (item?.catalogId === undefined || item?.catalogId === null) return;

      result.push({
        catalogId: item.catalogId,
        catalogName: getCatalogName(item),
        level,
      });

      const children = childrenMap.get(`${item.catalogId}`) || [];
      if (children.length > 0) {
        walkFlat(children, level + 1);
      }
    });
  };

  walkFlat(roots);
  return result;
};

export const getTopLevelCatalogs = (list: any[] = []): FlattenedCatalog[] => {
  if (!Array.isArray(list) || list.length === 0) return [];

  const mapItem = (item: any): FlattenedCatalog | null => {
    if (item?.catalogId === undefined || item?.catalogId === null) return null;

    return {
      catalogId: item.catalogId,
      catalogName: getCatalogName(item),
      level: 0,
    };
  };

  if (hasChildren(list)) {
    return list.map(mapItem).filter(Boolean) as FlattenedCatalog[];
  }

  const idSet = new Set(list.map((item) => `${item?.catalogId}`));

  return list
    .filter((item) => {
      const parentId = getParentCatalogId(item);
      return parentId === undefined || parentId === null || !idSet.has(`${parentId}`);
    })
    .map(mapItem)
    .filter(Boolean) as FlattenedCatalog[];
};
