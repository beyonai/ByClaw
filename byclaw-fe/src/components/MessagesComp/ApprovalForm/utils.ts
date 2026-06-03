export const splitKey = '|';

export function buildFormItemPath(lidx: number, idx: number, parentPath?: string) {
  const currentPath = `${lidx}.${idx}`;

  if (!parentPath) {
    return currentPath;
  }

  return `${parentPath}.children.${currentPath}`;
}

export function buildFormFieldName(fieldCode: string, path: string) {
  return `${fieldCode}${splitKey}${path}`;
}

type TermOptionRecord = Record<string, any>;
export type TermOption = {
  label: string;
  value: string | number;
};

function pickTermList(data: any): TermOptionRecord[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.list)) {
    return data.list;
  }

  if (Array.isArray(data?.rows)) {
    return data.rows;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.data?.list)) {
    return data.data.list;
  }

  if (Array.isArray(data?.data?.rows)) {
    return data.data.rows;
  }

  if (Array.isArray(data?.data?.items)) {
    return data.data.items;
  }

  return [];
}

export function normalizeTermOptions(data: any): TermOption[] {
  return pickTermList(data).map((item) => {
    const label = item.label ?? item.name;
    const value = item.code ?? item.value;

    return {
      label,
      value,
    };
  });
}

export function mergeTermOptions(prevOptions: TermOption[] = [], nextOptions: TermOption[] = []) {
  const optionsMap = new Map<string | number, TermOption>();

  prevOptions.forEach((option) => {
    optionsMap.set(option.value, option);
  });
  nextOptions.forEach((option) => {
    optionsMap.set(option.value, option);
  });

  return Array.from(optionsMap.values());
}
