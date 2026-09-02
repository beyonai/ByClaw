import type React from 'react';

export interface ChatResourceTab {
  key: string;
  title: React.ReactNode;
  content: React.ReactNode;
}

export const upsertChatResourceTab = (tabs: ChatResourceTab[], nextTab: ChatResourceTab) => {
  const index = tabs.findIndex((tab) => tab.key === nextTab.key);
  if (index < 0) return [...tabs, nextTab];

  return tabs.map((tab, currentIndex) => (currentIndex === index ? nextTab : tab));
};

export const closeChatResourceTab = (tabs: ChatResourceTab[], activeKey: string, closingKey: string) => {
  const closingIndex = tabs.findIndex((tab) => tab.key === closingKey);
  const nextTabs = tabs.filter((tab) => tab.key !== closingKey);

  if (activeKey !== closingKey) {
    return { tabs: nextTabs, activeKey };
  }

  const neighborIndex = Math.min(Math.max(closingIndex, 0), nextTabs.length - 1);
  return {
    tabs: nextTabs,
    activeKey: nextTabs[neighborIndex]?.key || '',
  };
};
