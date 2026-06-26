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
