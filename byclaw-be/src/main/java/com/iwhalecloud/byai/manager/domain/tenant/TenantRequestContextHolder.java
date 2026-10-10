package com.iwhalecloud.byai.manager.domain.tenant;

/** Request-scoped tenant identity. Async jobs must copy the identity explicitly. */
public final class TenantRequestContextHolder {

    private static final ThreadLocal<TenantRequestContext> CURRENT = new ThreadLocal<>();

    private TenantRequestContextHolder() {
    }

    public static TenantRequestContext get() {
        return CURRENT.get();
    }

    public static void set(TenantRequestContext context) {
        CURRENT.set(context);
    }

    public static void clear() {
        CURRENT.remove();
    }
}
