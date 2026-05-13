/**
 * QuerySources 组件 Mock 数据服务
 */

import type { KnowledgeBaseSource, DingTalkSource, FavoriteSource, WebSearchResult, KnowledgeSource } from './types';

/** 模拟延迟 */
const mockDelay = (ms: number = 1000) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 生成唯一ID */
const generateId = (prefix: string = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Web搜索模拟
 * @param query 搜索关键词
 */
export const fetchWebSearch = async (query: string): Promise<WebSearchResult[]> => {
  await mockDelay(2000);

  const mockResults: WebSearchResult[] = [
    {
      id: generateId('web'),
      title: `${query} Explained Simply 2026 (Beginner's Guide)`,
      summary: `这是对 ${query} 项目核心玩法的详细解释，涵盖了基础概念、架构设计和最佳实践。`,
      url: `https://example.com/${query}-guide`,
      favicon: 'https://www.youtube.com/favicon.ico',
      source: 'YouTube',
      type: 'web',
      checked: false,
    },
    {
      id: generateId('web'),
      title: `${query} (software) - Wikipedia`,
      summary: `维基百科提供的关于 ${query} 软件的历史、架构背景和核心功能的系统性介绍。`,
      url: `https://en.wikipedia.org/wiki/${query}`,
      favicon: 'https://en.wikipedia.org/favicon.ico',
      source: 'Wikipedia',
      type: 'web',
      checked: false,
    },
    {
      id: generateId('web'),
      title: `What is ${query}? Your Open-Source AI Assistant`,
      summary: `深入浅出地解释了 ${query} AI 助手的演变历程、核心特性以及应用场景。`,
      url: `https://example.com/what-is-${query}`,
      favicon: 'https://www.google.com/favicon.ico',
      source: 'Google',
      type: 'web',
      checked: false,
    },
    {
      id: generateId('web'),
      title: `${query} Tutorial: Getting Started`,
      summary: `从零开始学习 ${query} 的完整教程，包含安装、配置和基础使用示例。`,
      url: `https://example.com/${query}-tutorial`,
      favicon: 'https://github.com/favicon.ico',
      source: 'GitHub',
      type: 'web',
      checked: false,
    },
    {
      id: generateId('web'),
      title: `${query} Best Practices 2026`,
      summary: `2026年最新 ${query} 最佳实践指南，涵盖性能优化、安全性和可维护性建议。`,
      url: `https://example.com/${query}-best-practices`,
      favicon: 'https://medium.com/favicon.ico',
      source: 'Medium',
      type: 'web',
      checked: false,
    },
    {
      id: generateId('web'),
      title: `${query} vs Alternatives: Complete Comparison`,
      summary: `${query} 与其他主流解决方案的全面对比分析，帮助您做出技术选型决策。`,
      url: `https://example.com/${query}-comparison`,
      favicon: 'https://stackoverflow.com/favicon.ico',
      source: 'Stack Overflow',
      type: 'web',
      checked: false,
    },
    {
      id: generateId('web'),
      title: `${query} Architecture Deep Dive`,
      summary: `深入探讨 ${query} 的底层架构设计、核心模块实现原理和扩展机制。`,
      url: `https://example.com/${query}-architecture`,
      favicon: 'https://docs.example.com/favicon.ico',
      source: 'Documentation',
      type: 'web',
      checked: false,
    },
  ];

  return mockResults;
};

/**
 * 获取知识库列表
 */
export const fetchKnowledgeBases = async (): Promise<KnowledgeBaseSource[]> => {
  await mockDelay(800);

  return [
    {
      id: generateId('kb'),
      title: '产品知识库',
      type: 'knowledgeBase',
      checked: false,
      summary: '包含产品文档、用户手册和常见问题解答',
    },
    {
      id: generateId('kb'),
      title: '技术文档库',
      type: 'knowledgeBase',
      checked: false,
      summary: '技术规范、API文档和开发指南',
    },
    {
      id: generateId('kb'),
      title: '销售话术库',
      type: 'knowledgeBase',
      checked: false,
      summary: '销售培训资料和客户沟通技巧',
    },
  ];
};

/**
 * 获取钉钉聊天记录
 */
export const fetchDingTalkRecords = async (): Promise<DingTalkSource[]> => {
  await mockDelay(600);

  return [
    {
      id: generateId('ding'),
      title: '产品研发群（2025年1月）',
      type: 'dingTalk',
      checked: false,
      summary: '产品研发团队1月份的技术讨论记录',
    },
    {
      id: generateId('ding'),
      title: '客户需求反馈群',
      type: 'dingTalk',
      checked: false,
      summary: '收集和讨论客户需求的群聊记录',
    },
    {
      id: generateId('ding'),
      title: '项目周会纪要',
      type: 'dingTalk',
      checked: false,
      summary: '各项目周会的讨论要点和决策记录',
    },
  ];
};

/**
 * 获取收藏夹
 */
export const fetchFavorites = async (): Promise<FavoriteSource[]> => {
  await mockDelay(500);

  return [
    {
      id: generateId('fav'),
      title: '重要文档合集',
      type: 'favorite',
      checked: false,
      summary: '日常工作中经常参考的重要文档',
    },
    {
      id: generateId('fav'),
      title: '学习资料',
      type: 'favorite',
      checked: false,
      summary: '技术学习和培训相关的收藏内容',
    },
    {
      id: generateId('fav'),
      title: '竞品分析',
      type: 'favorite',
      checked: false,
      summary: '竞争对手产品分析和市场调研资料',
    },
  ];
};

/**
 * 导入知识来源
 * @param sources 要导入的知识来源
 */
export const importSources = async (sources: KnowledgeSource[]): Promise<boolean> => {
  await mockDelay(500);
  console.log('Importing sources:', sources);
  return true;
};

/**
 * 获取用户导入的来源
 */
export const fetchUserImportedSources = async (): Promise<KnowledgeSource[]> => {
  await mockDelay(300);
  return [];
};
