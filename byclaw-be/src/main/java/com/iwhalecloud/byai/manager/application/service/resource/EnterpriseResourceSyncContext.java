package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.Objects;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import java.util.function.Supplier;
import org.apache.commons.lang3.StringUtils;

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
        return identity != null && identity.trusted() && resource != null
            && Objects.equals(CurrentUserHolder.getEnterpriseId(), resource.getComAcctId()) && "enterprise".equals(resource.getOwnerType())
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
        return resource != null && Objects.equals(CurrentUserHolder.getEnterpriseId(), resource.getComAcctId())
            && USE_RESOURCE.get() != null
            && Objects.equals(USE_RESOURCE.get(), resource.getResourceId());
    }

    /** Persisted sync revisions are assigned by completeImport, never inferred from client-supplied ownership. */
    public static boolean isSynchronizedSkill(SsResource resource) {
        return isSynchronizedCapability(resource) && "SKILL".equals(resource.getResourceBizType());
    }

    /** Only imported callable capabilities use source-system grants across bookkeeping enterprise IDs. */
    public static boolean isSynchronizedCapability(SsResource resource) {
        return resource != null && resource.getResourceId() != null
            && Objects.equals(CurrentUserHolder.getEnterpriseId(), resource.getComAcctId())
            && "enterprise".equals(resource.getOwnerType())
            && StringUtils.equalsAny(resource.getResourceBizType(), "SKILL", "AGENT", "TOOLKIT", "MCP")
            && resource.getThirdSyncRevision() != null && resource.getThirdSyncRevision() > 0
            && StringUtils.isNotBlank(resource.getSystemCode()) && StringUtils.isNotBlank(resource.getResourceCode());
    }

    private record ImportIdentity(boolean trusted, String systemCode, String resourceBizType, String resourceCode) { }
}
