// @ts-ignore
export const chatModeMap = {
  base: 'basic',
  expert: 'expert',
  searchQuery: 'search_query',
  functionCloud: 'function_cloud',
} as const;

export type IChatModeType = (typeof chatModeMap)[keyof typeof chatModeMap];

export const chatModeIconMap = {
  [chatModeMap.base]: 'icon-jichuwenda',
  [chatModeMap.expert]: 'icon-zhuanjiaxietong',
} as {
  [key in IChatModeType]: string;
};
