package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.regex.Pattern;

/** Provider-qualified ACS IDs must never be interpreted as missing OpenSandbox IDs. */
public final class SandboxRuntimeOwnership {
    private static final Pattern ACS_ID = Pattern.compile(
        "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?--byclaw-(?:[0-9a-f]{32}|[0-9a-f]{40})");

    private SandboxRuntimeOwnership() { }

    public static boolean isForeign(String provider, String sandboxId) {
        // STARTING records may not have an ID yet. Preserve their existing handling.
        if (sandboxId == null || sandboxId.trim().isEmpty()) return false;
        boolean acs = ACS_ID.matcher(sandboxId).matches();
        return "aliyunAgentSandbox".equals(provider) ? !acs : acs;
    }
}
