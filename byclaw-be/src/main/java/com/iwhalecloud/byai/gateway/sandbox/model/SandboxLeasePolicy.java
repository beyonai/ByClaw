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
     * OpenSandbox should not expire the sandbox automatically. ByClaw releases it after idle timeout.
     */
    LOCAL_IDLE_RELEASE,

    /**
     * The sandbox is only released by explicit user/admin action.
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
