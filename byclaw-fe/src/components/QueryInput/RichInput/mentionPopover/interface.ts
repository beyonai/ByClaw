import { IAgent } from '@/typescript/agent';

export interface IResource {
  id: string;
  name: string;
  intro: string;
}

export type IMentionItem = IAgent & IResource;
