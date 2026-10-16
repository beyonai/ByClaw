package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.Objects;
import java.util.function.Supplier;

/** Only the authenticated enterprise sync entry establishes this context; ordinary imports keep their own checks. */
public final class EnterpriseResourceSyncContext {
    private static final ThreadLocal<Long> TENANT = new ThreadLocal<>();
    private EnterpriseResourceSyncContext() { }

    public static <T> T execute(boolean trusted, Supplier<T> action) {
        if (!trusted) return action.get();
        Long previous = TENANT.get();
        TENANT.set(CurrentUserHolder.getEnterpriseId());
        try { return action.get(); }
        finally { if (previous == null) TENANT.remove(); else TENANT.set(previous); }
    }

    public static boolean canUpdate(SsResource resource) {
        return TENANT.get() != null && resource != null && "enterprise".equals(resource.getOwnerType())
            && Objects.equals(TENANT.get(), resource.getComAcctId())
            && EnterpriseResourceSyncRequest.TYPES.contains(resource.getResourceBizType());
    }
}
