export interface MoveSource {
  path: string;
  isDirectory: boolean;
}

export function normalizeMovePath(path?: string) {
  const normalized = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized === '/') return '/';
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

export function collapseNestedMoveSources(sources: MoveSource[]) {
  const uniqueSources = Array.from(
    new Map(
      sources
        .map((source) => ({ ...source, path: normalizeMovePath(source.path) }))
        .filter((source) => source.path !== '/')
        .map((source) => [source.path, source])
    ).values()
  );
  const directoryPaths = uniqueSources.filter((source) => source.isDirectory).map((source) => source.path);

  return uniqueSources.filter(
    (source) =>
      !directoryPaths.some(
        (directoryPath) => source.path !== directoryPath && source.path.startsWith(`${directoryPath}/`)
      )
  );
}

export function isInvalidMoveTarget(targetPath: string, sourceDirectoryPaths: string[]) {
  const normalizedTarget = normalizeMovePath(targetPath);
  return sourceDirectoryPaths.some((sourcePath) => {
    const normalizedSource = normalizeMovePath(sourcePath);
    return normalizedTarget === normalizedSource || normalizedTarget.startsWith(`${normalizedSource}/`);
  });
}
