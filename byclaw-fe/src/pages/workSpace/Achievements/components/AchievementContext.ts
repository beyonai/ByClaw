import { createContext } from 'react';
import { SharedState } from '@/utils/SharedState';

export type AchievementState = {
  sessionId: string | number;
  currentFile?: {
    url?: string;
    type?: string;
    name?: string;
    fileId?: string;
    content?: string;
    fileName?: string;
  };
  task?: {
    title: string;
    content: string;
    taskId?: string;
    resPage?: string;
    resPageJson?: any;
  };
};

export type AchievementEffects = {
  toPreviewFile: (file: AchievementState['currentFile']) => void;
};

const defaultState = new SharedState<AchievementState, AchievementEffects>({ sessionId: '' });

export const AchievementContext = createContext(defaultState);

export const AchievementProvider = AchievementContext.Provider;

export const AchievementConsumer = AchievementContext.Consumer;
