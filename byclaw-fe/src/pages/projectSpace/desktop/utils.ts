import type { DevloopProjectLocalDirectoryPayload } from '@/service/devloop';

const normalizeDirectoryPath = (path: string) => {
  const trimmedPath = path.trim();
  // 文件系统根目录不能去掉末尾分隔符，否则 Windows 的 C:\\ 会变成相对驱动器路径 C:。
  if (/^\/+$/u.test(trimmedPath)) return '/';
  if (/^[A-Za-z]:[\\/]+$/u.test(trimmedPath)) return trimmedPath.slice(0, 3);
  return trimmedPath.replace(/[\\/]+$/, '');
};

export const getDirectoryName = (path: string) => {
  const normalizedPath = normalizeDirectoryPath(path);
  return normalizedPath.split(/[\\/]/).pop() || normalizedPath;
};

const getPathKey = (path: string, platform?: string) => {
  const normalizedPath = normalizeDirectoryPath(path);
  return platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
};

export const mergeLocalDirectories = (
  current: DevloopProjectLocalDirectoryPayload[],
  selectedPaths: string[],
  platform?: string
) => {
  const existingPaths = new Set(current.map((directory) => getPathKey(directory.path, platform)));
  const additions = selectedPaths.reduce<DevloopProjectLocalDirectoryPayload[]>((directories, path) => {
    const normalizedPath = normalizeDirectoryPath(path);
    const key = getPathKey(normalizedPath, platform);
    if (!normalizedPath || existingPaths.has(key)) return directories;

    existingPaths.add(key);
    directories.push({
      name: getDirectoryName(normalizedPath),
      path: normalizedPath,
      primary: current.length === 0 && directories.length === 0,
    });
    return directories;
  }, []);
  return [...current, ...additions];
};

export const removeLocalDirectory = (directories: DevloopProjectLocalDirectoryPayload[], path: string) => {
  const remaining = directories.filter((directory) => directory.path !== path);
  if (remaining.length && !remaining.some((directory) => directory.primary)) {
    return remaining.map((directory, index) => ({ ...directory, primary: index === 0 }));
  }
  return remaining;
};

export const setPrimaryLocalDirectory = (directories: DevloopProjectLocalDirectoryPayload[], path: string) =>
  directories.map((directory) => ({ ...directory, primary: directory.path === path }));
