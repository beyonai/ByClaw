export const SYSTEM_CONFIG_STORAGE_KEY = '_BYAI_SYSTEM_CONFIG_';

export const LayoutMode = {
  common: 'common',
  debug: 'debug',
  preview: 'preview',
} as const;

export const DEFAULT_MENU_CONFIG = [
  {
    paramId: 10001665,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '会话',
    paramEnName: 'Session',
    paramValue: 'true',
    paramDesc: '会话',
    paramSeq: 1,
  },
  {
    paramId: 10001666,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '员工',
    paramEnName: 'Employee',
    paramValue: 'true',
    paramDesc: '员工',
    paramSeq: 2,
  },
  {
    paramId: 10001667,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '知识',
    paramEnName: 'Knowledge',
    paramValue: 'true',
    paramDesc: '知识',
    paramSeq: 3,
  },
  {
    paramId: 10001668,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '工具',
    paramEnName: 'Tool',
    paramValue: 'true',
    paramDesc: '工具',
    paramSeq: 4,
  },
  {
    paramId: 10001669,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '视图',
    paramEnName: 'View',
    paramValue: 'true',
    paramDesc: '视图',
    paramSeq: 5,
  },
  {
    paramId: 10001670,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '对象',
    paramEnName: 'Object',
    paramValue: 'true',
    paramDesc: '对象',
    paramSeq: 6,
  },
];

export const MENU_NAME_TO_KEY_MAP: Record<string, string> = {
  会话: 'sessions',
  员工: 'agent',
  知识: 'knowledge',
  工具: 'tool',
  视图: 'view',
  对象: 'object',
};

export const getVisibleMenuKeysFromConfig = (config: any[] = []) => {
  const visibleKeys = new Set<string>();

  return [...config]
    .filter((item) => item.paramValue === 'true')
    .sort((a, b) => (a.paramSeq || 0) - (b.paramSeq || 0))
    .reduce<string[]>((keys, item) => {
      const key = MENU_NAME_TO_KEY_MAP[item.paramName];

      if (key && !visibleKeys.has(key)) {
        visibleKeys.add(key);
        keys.push(key);
      }

      return keys;
    }, []);
};
