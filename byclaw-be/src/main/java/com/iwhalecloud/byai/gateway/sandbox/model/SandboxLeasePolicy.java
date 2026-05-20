package com.iwhalecloud.byai.gateway.sandbox.model;

/**
 * Controls who is responsible for ending a sandbox lifecycle.
 */
public enum SandboxLeasePolicy {

    /**
     * OpenSandbox owns expiration. ByClaw only renews while the sandbox remains active.
     */
    REMOTE_AUTO_EXPIRE,

    /**
     * The sandbox is kept alive locally and only released by explicit user/admin action.
     */
    MANUAL;

    public static SandboxLeasePolicy fromDbValue(String value) {
        if (value == null || value.isBlank()) {
            return REMOTE_AUTO_EXPIRE;
        }
        try {
            return SandboxLeasePolicy.valueOf(value.trim());
        }
        catch (IllegalArgumentException ignored) {
            return REMOTE_AUTO_EXPIRE;
        }
    }
}
