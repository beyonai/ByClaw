package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.function.Predicate;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleFacade;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;

/**
 * The BE-managed shared DSH host's lifecycle, kept in this process even when the rest of the sandbox
 * work is delegated to the platform service.
 *
 * <p>In platform-remote mode {@code SandboxService} hands every sandbox operation to the platform,
 * which does not know the shared host. The decisions here let it keep the host's users local: a new
 * {@code byclaw-dsh} sandbox of a listed user becomes a host context through {@link #facade()}, and a
 * record whose sandbox id is the host's ({@code byclaw-dsh-<userCode>}) is released, renewed and
 * listed locally. Everything else still goes to the platform. In local mode the regular facade
 * already contains the host provider and this class is not consulted.</p>
 */
public final class SharedDshHostLifecycle {

    private final SandboxLifecycleFacade facade;
    private final Predicate<String> sharedUsers;

    /**
     * @param facade      lifecycle over {@link SharedDshHostRuntimeProvider}, never routed to the platform
     * @param sharedUsers which user codes run on the host (see {@link SharedDshHostRuntimeProvider#userFilter})
     */
    public SharedDshHostLifecycle(SandboxLifecycleFacade facade, Predicate<String> sharedUsers) {
        this.facade = facade;
        this.sharedUsers = sharedUsers;
    }

    public SandboxLifecycleFacade facade() {
        return facade;
    }

    /** A new sandbox of this type for this user becomes a context on the shared host. */
    public boolean routes(String userCode, String sandboxType) {
        String user = StringUtils.trimToEmpty(userCode);
        return SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE.equals(sandboxType) && !user.isEmpty()
            && sharedUsers.test(user);
    }

    /** The record is a context on the shared host, whatever the current user list says. */
    public boolean owns(SsSandboxRecord record) {
        if (record == null || !SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE.equals(record.getSandboxType())) {
            return false;
        }
        String userCode = StringUtils.trimToEmpty(record.getUserCode());
        return !userCode.isEmpty()
            && SharedDshHostRuntimeProvider.sharedSandboxId(userCode).equals(record.getSandboxId());
    }
}
