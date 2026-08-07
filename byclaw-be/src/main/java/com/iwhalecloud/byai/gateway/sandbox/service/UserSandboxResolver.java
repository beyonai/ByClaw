package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.OffsetDateTime;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimePage;

/** Resolves the existing user-level OpenClaw sandbox or starts it once. */
@Component
public class UserSandboxResolver {

    private static final Logger log = LoggerFactory.getLogger(UserSandboxResolver.class);

    private final SandboxLifecycleFacade lifecycleFacade;
    private final SandboxService sandboxService;

    public UserSandboxResolver(SandboxLifecycleFacade lifecycleFacade, SandboxService sandboxService) {
        this.lifecycleFacade = lifecycleFacade;
        this.sandboxService = sandboxService;
    }

    public UserSandboxContext resolve(String userCode) {
        return resolve(userCode, "openclaw");
    }

    public UserSandboxContext resolve(String userCode, String serviceKey) {
        if (userCode == null || userCode.isBlank()) {
            throw new IllegalArgumentException("userCode is required");
        }
        if (serviceKey == null || serviceKey.isBlank()) {
            throw new IllegalArgumentException("serviceKey is required");
        }
        log.debug("Resolving user sandbox: userCode={}, serviceKey={}", userCode, serviceKey);
        SandboxResponse<SandboxRuntimePage<SandboxRuntimeInstance>> listed = lifecycleFacade
            .listSandboxesByMetadata(Map.of("userCode", userCode, "serviceKey", serviceKey), 1, 100);
        if (listed != null && listed.isSuccess() && listed.getData() != null) {
            for (SandboxRuntimeInstance instance : listed.getData().safeItems()) {
                if (instance != null && Boolean.TRUE.equals(instance.getReusable())
                        && userCode.equals(instance.getMetadata() == null ? null : instance.getMetadata().get("userCode"))) {
                    log.info("Reusing user sandbox: userCode={}, serviceKey={}, sandboxId={}",
                        userCode, serviceKey, instance.getSandboxId());
                    return context(instance, userCode);
                }
            }
        }

        SandboxLaunchData launched = sandboxService.launchSandboxWithServiceKey(userCode, serviceKey);
        if (launched == null || launched.getSandboxId() == null || launched.getSandboxId().isBlank()) {
            throw new IllegalStateException("Unable to start user OpenClaw sandbox");
        }
        log.info("Started user sandbox: userCode={}, serviceKey={}, sandboxId={}",
            userCode, serviceKey, launched.getSandboxId());
        return new UserSandboxContext(launched.getSandboxId(), userCode, null, launched.getRemoteExpiresAt());
    }

    private UserSandboxContext context(SandboxRuntimeInstance instance, String userCode) {
        OffsetDateTime createdAt = instance.getCreatedAt();
        return new UserSandboxContext(
            instance.getSandboxId(),
            userCode,
            createdAt == null ? null : createdAt.toString(),
            instance.getExpiresAt() == null ? null : java.util.Date.from(instance.getExpiresAt().toInstant()));
    }

    public record UserSandboxContext(String sandboxId, String userCode, String generation,
                                     java.util.Date expiresAt) {
    }
}
