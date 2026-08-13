package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.time.Duration;
import java.util.Date;
import java.util.Locale;

/** Central lifecycle mapping for refresh-aware CLI credential status. */
public final class CredentialLifecycleEvaluator {

    private static final Duration EXPIRING_WARNING_WINDOW = Duration.ofDays(7);

    private CredentialLifecycleEvaluator() {
    }

    public static CredentialState evaluate(
            String tokenStatus,
            Boolean refreshTokenValid,
            Date refreshExpiresAt,
            Date now) {
        Date comparisonTime = now == null ? new Date() : now;
        String normalizedTokenStatus = tokenStatus == null
            ? ""
            : tokenStatus.trim().toLowerCase(Locale.ROOT).replace('-', '_');
        boolean accessValid = "valid".equals(normalizedTokenStatus);
        boolean accessInvalid = "invalid".equals(normalizedTokenStatus)
            || "expired".equals(normalizedTokenStatus);
        boolean accessRefreshNeeded = "needs_refresh".equals(normalizedTokenStatus)
            || "refresh_needed".equals(normalizedTokenStatus);
        boolean refreshExpired = Boolean.FALSE.equals(refreshTokenValid)
            || refreshExpiresAt != null && !refreshExpiresAt.after(comparisonTime);
        boolean refreshUsable = Boolean.TRUE.equals(refreshTokenValid)
            || refreshExpiresAt != null && refreshExpiresAt.after(comparisonTime);

        if (refreshExpired) {
            return CredentialState.REAUTH_REQUIRED;
        }
        if (accessRefreshNeeded) {
            return refreshUsable ? CredentialState.REFRESH_NEEDED : CredentialState.UNKNOWN;
        }
        if (accessInvalid) {
            return refreshUsable
                ? CredentialState.REFRESH_NEEDED
                : CredentialState.REAUTH_REQUIRED;
        }
        if (!accessValid) {
            return CredentialState.UNKNOWN;
        }
        if (refreshExpiresAt != null
                && refreshExpiresAt.getTime() - comparisonTime.getTime() <= EXPIRING_WARNING_WINDOW.toMillis()) {
            return CredentialState.EXPIRING;
        }
        return CredentialState.READY;
    }
}
