export function formatDispatchError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  return String(err);
}

export function isOpenClawContextOverflowDispatchError(err: unknown): boolean {
  const text = formatDispatchError(err);
  return /context overflow/i.test(text) && /prompt too large|context size exceeds/i.test(text);
}

export function isOpenClawContextOverflowPrecheckError(err: unknown): boolean {
  return /Context overflow: prompt too large for the model \(precheck\)\.?/i.test(formatDispatchError(err));
}
