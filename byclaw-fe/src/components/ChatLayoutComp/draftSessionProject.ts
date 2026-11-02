export const shouldPersistDraftSessionProject = ({
  preserveNewSessionView,
  isBottom,
  sessionId,
}: {
  preserveNewSessionView: boolean;
  isBottom: boolean;
  sessionId?: string;
}) => Boolean(preserveNewSessionView && !isBottom && sessionId);

export type DraftSessionProject = {
  projectId: string;
  projectName: string;
  cloudResourceId?: string | number;
};

export const buildDraftSessionProjectPatch = (sessionId: string, project: DraftSessionProject) => ({
  sessionId,
  projectId: Number(project.projectId),
  projectName: project.projectName,
  cloudResourceId: project.cloudResourceId,
});

export const resolvePendingSessionProjectId = (
  existingProjectId: string | number | undefined,
  selectedProjectId: string | number | undefined
) => selectedProjectId ?? existingProjectId;
