import path from "node:path";

const pendingWorkspaceReloadHints = new Set<string>();

export function markWorkspaceReloadHint(workspaceDir: string): void {
  pendingWorkspaceReloadHints.add(path.resolve(workspaceDir));
}

/** Consume one-shot USER.md reload hint for prompt injection snapshot. */
export function consumeWorkspaceReloadHint(workspaceDir: string | undefined): boolean {
  if (!workspaceDir) {
    return false;
  }
  const normalized = path.resolve(workspaceDir);
  if (!pendingWorkspaceReloadHints.has(normalized)) {
    return false;
  }
  pendingWorkspaceReloadHints.delete(normalized);
  return true;
}

export function resetWorkspaceReloadHintsForTest(): void {
  pendingWorkspaceReloadHints.clear();
}
