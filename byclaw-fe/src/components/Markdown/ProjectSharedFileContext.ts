import { createContext } from 'react';

import type { ProjectSharedFileScope } from '@/service/chatFileArtifact';

/** 仅同一会话的正文链接可使用其所属项目的共享目录。 */
const ProjectSharedFileContext = createContext<(ProjectSharedFileScope & { sessionId: string }) | undefined>(undefined);

export default ProjectSharedFileContext;
