package com.iwhalecloud.byai.common.integration.security;

/** Stable transport error; never includes credentials or caller-supplied values. */
public class InternalServiceSecurityException extends RuntimeException {
    private final int status;
    private final DiagnosticReason diagnosticReason;
    public InternalServiceSecurityException(int status, String errorCode) { this(status, errorCode, null); }
    public InternalServiceSecurityException(int status, String errorCode, DiagnosticReason diagnosticReason) {
        super(errorCode);
        this.status = status;
        this.diagnosticReason = diagnosticReason;
    }
    public int status() { return status; }
    public DiagnosticReason diagnosticReason() { return diagnosticReason; }

    /** Server-only classifications; never include values supplied by callers or credential configuration. */
    public enum DiagnosticReason {
        INTEGRATION_DISABLED, HEADER_MISSING, HEADER_INVALID, CLOCK_SKEW_INVALID, TIMESTAMP_OUT_OF_WINDOW,
        CLIENT_NOT_CONFIGURED, CLIENT_SECRET_INVALID, SIGNATURE_MISMATCH, ROUTE_NOT_ALLOWED,
        NONCE_REPLAYED, NONCE_STORE_UNAVAILABLE, AUTHENTICATION_ERROR, BODY_TOO_LARGE, REQUEST_REJECTED
    }
}
