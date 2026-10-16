package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.Objects;
import java.util.function.Supplier;

/** Only authenticated synchronization establishes these exceptions, each bound to a specific resource. */
public final class EnterpriseResourceSyncContext {
    private static final ThreadLocal<ImportIdentity> IMPORT = new ThreadLocal<>();
    private static final ThreadLocal<Long> USE_RESOURCE = new ThreadLocal<>();
    private EnterpriseResourceSyncContext() { }

    public static <T> T execute(boolean trusted, String systemCode, String resourceBizType, String resourceCode,
                                Supplier<T> action) {
        ImportIdentity previous = IMPORT.get();
        IMPORT.set(new ImportIdentity(trusted, systemCode, resourceBizType, resourceCode));
        try { return action.get(); }
        finally { if (previous == null) IMPORT.remove(); else IMPORT.set(previous); }
    }

    public static boolean canUpdate(SsResource resource) {
        return skipsImportEnterpriseCheck(resource);
    }

    public static boolean skipsImportEnterpriseCheck(SsResource resource) {
        ImportIdentity identity = IMPORT.get();
        return identity != null && identity.trusted() && resource != null && "enterprise".equals(resource.getOwnerType())
            && EnterpriseResourceSyncRequest.TYPES.contains(resource.getResourceBizType())
            && Objects.equals(identity.systemCode(), resource.getSystemCode())
            && Objects.equals(identity.resourceBizType(), resource.getResourceBizType())
            && Objects.equals(identity.resourceCode(), resource.getResourceCode());
    }

    /** Keep the real grant checks; only the selected resource's enterprise comparison is omitted. */
    public static <T> T checkUsePermission(SsResource resource, Supplier<T> action) {
        Long previous = USE_RESOURCE.get();
        USE_RESOURCE.set(resource.getResourceId());
        try { return action.get(); }
        finally { if (previous == null) USE_RESOURCE.remove(); else USE_RESOURCE.set(previous); }
    }

    public static boolean skipsUseEnterpriseCheck(SsResource resource) {
        return resource != null && USE_RESOURCE.get() != null
            && Objects.equals(USE_RESOURCE.get(), resource.getResourceId());
    }

    private record ImportIdentity(boolean trusted, String systemCode, String resourceBizType, String resourceCode) { }
}
