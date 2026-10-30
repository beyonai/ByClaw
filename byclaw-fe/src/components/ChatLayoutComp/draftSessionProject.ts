export const shouldPersistDraftSessionProject = ({
  preserveNewSessionView,
  isBottom,
  sessionId,
}: {
  preserveNewSessionView: boolean;
  isBottom: boolean;
  sessionId?: string;
}) => Boolean(preserveNewSessionView && !isBottom && sessionId);
