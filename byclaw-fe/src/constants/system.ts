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
    paramValue: 'false',
    paramDesc: '视图',
    paramSeq: 5,
  },
  {
    paramId: 10001670,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '对象',
    paramEnName: 'Object',
    paramValue: 'false',
    paramDesc: '对象',
    paramSeq: 6,
  },
  {
    paramId: 10001673,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '本体',
    paramEnName: 'Ontology',
    paramValue: 'true',
    paramDesc: '本体',
    paramSeq: 6,
  },
  {
    paramId: 10001671,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '技能',
    paramEnName: 'Skill',
    paramValue: 'true',
    paramDesc: '技能',
    paramSeq: 7,
  },
  {
    paramId: 10001672,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '文件',
    paramEnName: 'File',
    paramValue: 'true',
    paramDesc: '文件',
    paramSeq: 8,
  },
  {
    paramId: 10001673,
    paramGroupCode: 'MENU_ICON_SHOW_TAB',
    paramName: '模型',
    paramEnName: 'Model',
    paramValue: 'true',
    paramDesc: '模型',
    paramSeq: 9,
  },
];

export const MENU_NAME_TO_KEY_MAP: Record<string, string> = {
  会话: 'sessions',
  员工: 'agent',
  知识: 'knowledge',
  工具: 'tool',
  视图: 'view',
  对象: 'object',
  本体: 'ontology',
  技能: 'skill',
  文件: 'file',
  模型: 'model',
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
