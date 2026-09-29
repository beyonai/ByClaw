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

/** Only the required preflight stage is eligible for replay, never a tool-loop failure. */
export function isRequiredCompactionFailure(err: unknown): boolean {
  return /^Preflight compaction required but failed:/i.test(formatDispatchError(err));
}

export function isRecoverableContextPreflightError(err: unknown): boolean {
  const text = formatDispatchError(err);
  return isOpenClawContextOverflowPrecheckError(err) ||
    (isRequiredCompactionFailure(err) && /(?:timed?\s*out|timeout|context.*(?:large|exceed)|overflow)/i.test(text) &&
      !/unauthori[sz]ed|forbidden|(?:401|403)|invalid.*(?:key|credential)/i.test(text));
}
