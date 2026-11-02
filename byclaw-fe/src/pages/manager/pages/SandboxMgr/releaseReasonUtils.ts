type ReasonIntl = {
  formatMessage: (
    descriptor: { id: string; defaultMessage?: string },
    values?: Record<string, string | number>
  ) => string;
};

export const formatReleaseReason = (intl: ReasonIntl, reason?: string | null): string => {
  if (!reason?.trim()) return '-';
  if (reason.startsWith('release.manual:')) {
    return intl.formatMessage(
      { id: 'sandboxMgr.releaseReason.manualDetail' },
      { detail: reason.slice('release.manual:'.length) }
    );
  }
  const orphan = /^orphan:([^:]+):(.+)$/.exec(reason);
  if (orphan) {
    return intl.formatMessage(
      { id: 'sandboxMgr.releaseReason.orphan' },
      {
        status: intl.formatMessage({ id: `sandboxMgr.status.${orphan[1].toLowerCase()}`, defaultMessage: orphan[1] }),
        reason: formatReleaseReason(intl, orphan[2]),
      }
    );
  }
  const timeout = /^timeout-(\d+)m$/.exec(reason);
  if (timeout) {
    return intl.formatMessage({ id: 'sandboxMgr.releaseReason.timeoutMinutes' }, { minutes: timeout[1] });
  }
  return intl.formatMessage({ id: `sandboxMgr.releaseReason.${reason}`, defaultMessage: reason });
};
