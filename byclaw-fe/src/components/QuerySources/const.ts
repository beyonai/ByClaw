import type { SourceRootId, SourceTreeNodeType } from './types';
import StarOutlined from '@ant-design/icons/StarOutlined';

type SourceRootIdKey = SourceRootId;

export const SourceRootIdMap: Record<SourceRootIdKey, SourceRootId> = {
  userImported: 'userImported',
  knowledgeBases: 'knowledgeBases',
  enterpriseKnowledgeBases: 'enterpriseKnowledgeBases',
  skills: 'skills',
  favorites: 'favorites',
};

type SourceTreeNodeTypeKey = SourceTreeNodeType;

export const SourceTreeNodeTypeMap: Record<SourceTreeNodeTypeKey, SourceTreeNodeType> = {
  folder: 'folder',
  file: 'file',
  webSearch: 'webSearch',
  knowledgeBase: 'knowledgeBase',
  enterpriseKnowledgeBase: 'enterpriseKnowledgeBase',
  skill: 'skill',
  favorite: 'favorite',
  more: 'more',
};

export const rootInfoMap = {
  [SourceRootIdMap.userImported]: {
    icon: 'icon-a-Uploadshangchuan',
    title: '用户导入来源',
  },
  [SourceRootIdMap.knowledgeBases]: {
    icon: 'icon-a-Book-oneshuji1',
    title: '个人知识库',
  },
  [SourceRootIdMap.enterpriseKnowledgeBases]: {
    icon: 'icon-cebianlan-zhishizhongxin',
    title: '企业知识库',
  },
  [SourceRootIdMap.skills]: {
    icon: 'icon-mob-faxian02',
    title: '技能',
  },
  [SourceRootIdMap.favorites]: {
    icon: StarOutlined,
    title: '收藏夹',
  },
};
