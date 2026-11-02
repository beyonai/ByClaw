package com.iwhalecloud.byai.gateway.sandbox.shared;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

/** Login preparation snapshots the authenticated tenant before entering the executor. */
@Service
public class SharedUserStoragePreparation {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(SharedUserStoragePreparation.class);
    private final SharedSandboxPolicy policy;
    private final SharedSandboxGateway gateway;
    private final SandboxService sandboxes;
    private final Executor executor;
    private final Set<String> pending = ConcurrentHashMap.newKeySet();

    public SharedUserStoragePreparation(SharedSandboxPolicy policy, SharedSandboxGateway gateway,
        SandboxService sandboxes, @Qualifier("defaultAsyncExecutor") Executor executor) {
        this.policy = policy; this.gateway = gateway; this.sandboxes = sandboxes; this.executor = executor;
    }

    public Map<String, Object> status(String user) {
        if (!policy.userNasEnabled(user, SharedSandboxGateway.DSH_SERVICE)
            || !SharedSandboxGateway.DSH_SERVICE.equals(sandboxes.getPreferredServiceKey(user))) {
            return Map.of("enabled", false, "ready", true, "state", "LOGICAL");
        }
        return gateway.userStorageStatus(user);
    }

    public void trigger(LoginInfo login) {
        if (login == null || login.getUserId() == null || login.getEnterpriseId() == null || login.getUserCode() == null) return;
        String user = login.getUserCode();
        // No NAS reads, reservations, or async jobs in legacy mode.
        if (!policy.userNasEnabled(user, SharedSandboxGateway.DSH_SERVICE)) return;
        Map<String, Object> identity = Map.of("userCode", user, "userId", login.getUserId(),
            "enterpriseId", login.getEnterpriseId(), "requestedServiceKey", SharedSandboxGateway.DSH_SERVICE);
        String key = login.getEnterpriseId() + ":" + login.getUserId();
        if (!pending.add(key)) return;
        try {
            executor.execute(() -> {
                try {
                    // Personal NAS is shared by execution modes. First login often has no preference yet;
                    // persist the intent now so the scheduled provisioner can work before the first chat.
                    if (policy.userNasEnabled(user, SharedSandboxGateway.DSH_SERVICE)) {
                        gateway.call("prepareUserStorage", identity);
                    }
                } catch (RuntimeException failure) {
                    // Durable reservations are reconciled by Platform; admission also retries a missed submission.
                    LOG.warn("User NAS login preparation failed, userCode={}, failureType={}", user, failure.getClass().getSimpleName());
                } finally { pending.remove(key); }
            });
        } catch (RuntimeException failure) {
            pending.remove(key);
            LOG.warn("User NAS preparation executor unavailable, userCode={}", user);
        }
    }
}
