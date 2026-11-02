package com.iwhalecloud.byai.manager.domain.tenant.integration;

/** Stable public error code; provider diagnostics and credentials never enter the API error body. */
public class TenantCommandException extends RuntimeException {
    private final int status;
    public TenantCommandException(int status, String code) { super(code); this.status = status; }
    public int status() { return status; }
}
