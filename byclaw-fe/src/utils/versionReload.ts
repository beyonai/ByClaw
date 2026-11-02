export type VersionReloadOptions = {
  buildTime: string | number;
  intervalMs?: number;
  fetcher?: typeof fetch;
  location?: Pick<Location, 'reload'>;
  logger?: Pick<Console, 'warn'>;
};

type VersionFile = {
  buildDate?: string;
};

const DEFAULT_INTERVAL_MS = 60 * 1000;
const VERSION_FILE_URL = '/beyond/version.txt';

let versionReloadTimer: ReturnType<typeof setInterval> | null = null;

const normalizeBuildTime = (value: string | number | undefined): string => {
  if (value === undefined || value === null) {
    return '';
  }
  const rawValue = String(value).trim();
  if (!rawValue) {
    return '';
  }
  const numericValue = Number(rawValue);
  if (Number.isFinite(numericValue)) {
    return new Date(numericValue).getTime().toString();
  }
  const parsedValue = new Date(rawValue.replace(' ', 'T')).getTime();
  return Number.isFinite(parsedValue) ? parsedValue.toString() : rawValue;
};

export const stopVersionReloadWatcher = () => {
  if (versionReloadTimer) {
    clearInterval(versionReloadTimer);
    versionReloadTimer = null;
  }
};

export const startVersionReloadWatcher = ({
  buildTime,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetcher,
  location,
  logger = console,
}: VersionReloadOptions) => {
  const actualFetcher = fetcher || (typeof fetch === 'function' ? fetch : undefined);
  if (typeof window === 'undefined' || typeof actualFetcher !== 'function') {
    return;
  }
  const actualLocation = location || window.location;

  const currentBuildTime = normalizeBuildTime(buildTime);
  if (!currentBuildTime) {
    return;
  }

  stopVersionReloadWatcher();

  const checkVersion = async () => {
    try {
      const response = await actualFetcher(`${VERSION_FILE_URL}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        return;
      }
      const versionInfo = (await response.json()) as VersionFile;
      const latestBuildTime = normalizeBuildTime(versionInfo.buildDate);
      if (latestBuildTime && latestBuildTime !== currentBuildTime) {
        actualLocation.reload();
      }
    } catch (error) {
      logger.warn('版本信息检查失败:', error);
    }
  };

  versionReloadTimer = setInterval(checkVersion, intervalMs);
  checkVersion();
};
