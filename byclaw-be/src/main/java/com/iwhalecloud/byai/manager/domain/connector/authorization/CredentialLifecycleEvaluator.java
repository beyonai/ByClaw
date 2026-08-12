package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.time.Duration;
import java.util.Date;

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
        boolean accessValid = "valid".equalsIgnoreCase(tokenStatus);
        boolean accessInvalid = "invalid".equalsIgnoreCase(tokenStatus)
            || "expired".equalsIgnoreCase(tokenStatus);
        boolean refreshExpired = Boolean.FALSE.equals(refreshTokenValid)
            || refreshExpiresAt != null && !refreshExpiresAt.after(comparisonTime);

        if (refreshExpired) {
            return CredentialState.REAUTH_REQUIRED;
        }
        if (accessInvalid) {
            return Boolean.TRUE.equals(refreshTokenValid) || refreshExpiresAt != null
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
