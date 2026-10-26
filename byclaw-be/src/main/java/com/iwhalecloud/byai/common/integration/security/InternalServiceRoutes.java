package com.iwhalecloud.byai.common.integration.security;

/** Exact commercial endpoints; existing Node internal routes retain their authentication. */
public final class InternalServiceRoutes {
    private InternalServiceRoutes() { }
    public static boolean matches(String method, String path) {
        return scope(method, path) != null;
    }
    public static String scope(String method, String path) {
        if (path.matches("/internal/v1/tenants/[1-9][0-9]*/(?:enterprise|members)")) {
            if ("GET".equals(method)) return "tenant:read";
            if (("PUT".equals(method) && path.endsWith("/enterprise"))
                || ("POST".equals(method) && path.endsWith("/members"))) return "tenant:manage";
        }
        if ("POST".equals(method) && "/internal/v1/tenant-provisionings".equals(path)) return "tenant:provision";
        if ("GET".equals(method) && (path.matches("/internal/v1/commands/(?:[1-9][0-9]*|by-request)")
            || path.matches("/internal/v1/tenants/[1-9][0-9]*/runtime"))) return "tenant:read";
        if ("PUT".equals(method) && path.matches("/internal/v1/tenants/[1-9][0-9]*/execution-policy")) return "tenant:policy:write";
        if ("POST".equals(method) && path.matches("/internal/v1/tenants/[1-9][0-9]*/operations")) return "sandbox:operate";
        return null;
    }
}
